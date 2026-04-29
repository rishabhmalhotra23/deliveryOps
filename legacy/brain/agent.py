"""Core Claude agent — takes a message + customer context → response.

Handles the tool-use loop: sends the message to Claude, executes any tool
calls, feeds results back, and repeats until Claude produces a final text
response.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import anthropic

from curator.config import ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS
from curator.brain.prompts import build_system_prompt
from curator.brain.tools import CURATOR_TOOLS
from curator.customers import get_customer

logger = logging.getLogger(__name__)

# ── Anthropic client (singleton) ──────────────────────────────────────────────

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


# ── Attachment resolution ──────────────────────────────────────────────────────


async def _resolve_attachments(
    customer_key: str,
    file_specs: list[dict[str, str]],
) -> list:
    """Resolve file-path specs to ``EmailAttachment`` objects.

    Each *file_spec* has a ``file_path`` key relative to the customer cache
    (e.g. ``original_docs/contracts/sow.pdf``).

    Reads the bytes from local cache and resolves the Google Drive
    ``webViewLink`` for the Slack preview.
    """
    if not file_specs:
        return []

    import mimetypes
    from pathlib import Path
    from curator.approvals.email_approval import EmailAttachment
    from curator.storage import gdrive
    from curator.customers import ensure_customer_drive_folder

    customer = get_customer(customer_key)
    cache_root = Path(customer["cache_path"])
    results: list[EmailAttachment] = []

    # Get Drive folder ID once (for link resolution)
    drive_folder_id: str | None = None
    try:
        drive_folder_id = await ensure_customer_drive_folder(customer_key)
    except Exception:
        logger.warning("Could not get Drive folder for %s — links will be empty", customer_key)

    for spec in file_specs:
        file_path = spec.get("file_path", "")
        if not file_path:
            continue

        local_path = cache_root / file_path
        if not local_path.is_file():
            logger.warning(
                "[%s] Attachment file not found: %s", customer_key, local_path,
            )
            continue

        # Ensure the path doesn't escape the customer cache
        try:
            local_path.resolve().relative_to(cache_root.resolve())
        except ValueError:
            logger.error(
                "[%s] Attachment path escapes cache: %s", customer_key, file_path,
            )
            continue

        data = local_path.read_bytes()
        mime, _ = mimetypes.guess_type(local_path.name)
        filename = local_path.name

        # Resolve Google Drive webViewLink
        drive_link = ""
        if drive_folder_id:
            try:
                meta = await gdrive.resolve_file_by_path(drive_folder_id, file_path)
                if meta:
                    drive_link = meta.get("webViewLink", "")
            except Exception:
                logger.warning(
                    "[%s] Could not resolve Drive link for %s", customer_key, file_path,
                )

        results.append(EmailAttachment(
            filename=filename,
            data=data,
            mime_type=mime or "application/octet-stream",
            drive_link=drive_link,
        ))
        logger.info(
            "[%s] Resolved attachment: %s (%d bytes, link=%s)",
            customer_key, filename, len(data), bool(drive_link),
        )

    return results


# ── Tool execution dispatch ───────────────────────────────────────────────────


async def _execute_tool_call(
    tool_name: str, tool_input: dict[str, Any], customer_key: str,
    *, source: str = "slack",
) -> str:
    """Execute a single tool call and return the result as a string.

    Args:
        source: Where this agent run originated — ``"email"``, ``"slack"``,
                ``"web"``, or ``"approved"`` (post-approval execution).
                When *source* is ``"email"`` and the tool is gated,
                execution is deferred to the Slack approval flow.
    """
    # ── Gate certain tools when triggered by an inbound email ─────────
    from curator.approvals.action_approval import GATED_TOOLS_EMAIL, queue_action

    if source == "email" and tool_name in GATED_TOOLS_EMAIL:
        return await queue_action(customer_key, tool_name, tool_input)

    # ── Block direct execution if there's already a pending approval ──
    if tool_name in GATED_TOOLS_EMAIL and source != "approved":
        from curator.approvals.action_approval import get_pending_ids_for_customer, _pending
        pending_ids = get_pending_ids_for_customer(customer_key)
        for pid in pending_ids:
            pa = _pending.get(pid)
            if pa and pa.tool_name == tool_name:
                return (
                    f"There is already a pending {tool_name} action awaiting approval "
                    f"(approval_id: {pid}). Use revise_pending_action with "
                    f"approval_id '{pid}' to update it, or wait for it to be "
                    f"approved/rejected in Slack first."
                )

    match tool_name:
        case "search_customer_docs":
            from curator.search.search import search_customer_docs

            return await search_customer_docs(
                customer_key,
                tool_input["query"],
                scope=tool_input.get("scope", "all"),
            )

        case "log_event":
            from curator.storage.event_log import append

            event = await append(
                customer_key,
                tool_input["event_type"],
                details=tool_input.get("details"),
                summary=tool_input.get("summary", ""),
                tags=tool_input.get("tags"),
            )
            return f"Event logged: {event['event_type']} — {event['summary']}"

        case "get_customer_profile":
            from curator.storage.profile import get_profile

            profile = await get_profile(customer_key)
            return json.dumps(profile, indent=2, default=str)

        case "update_customer_profile":
            from curator.storage.profile import update_profile

            updates = tool_input.get("updates", {})
            if not updates:
                return "No updates provided."
            profile = await update_profile(customer_key, updates, updated_by="agent")
            changed = list(updates.keys())
            return f"Profile updated — fields changed: {', '.join(changed)}"

        case "get_credit_usage":
            from curator.slidebot.metrics_collector import get_credits

            usage = await get_credits(customer_key)
            return json.dumps(usage, indent=2, default=str)

        case "send_slack_message":
            from curator.listeners.slack_listener import post_message

            customer = get_customer(customer_key)
            channel = customer["slack_channel"]
            internal = tool_input.get("internal_only", False)
            if internal:
                channel = f"int-{channel}"
            await post_message(channel, tool_input["message"])
            return f"Message sent to #{channel}"

        case "send_email":
            from curator.approvals.email_approval import queue_email

            customer = get_customer(customer_key)
            channel = customer.get("slack_channel", "unknown")

            # Resolve file-path attachments → EmailAttachment objects
            att_list = await _resolve_attachments(
                customer_key, tool_input.get("attachments") or [],
            )

            approval_id = await queue_email(
                customer_key,
                from_addr=customer["email_alias"],
                to=tool_input["to"],
                subject=tool_input["subject"],
                body=tool_input["body"],
                attachments=att_list or None,
            )

            att_note = ""
            if att_list:
                att_names = ", ".join(a.filename for a in att_list)
                att_note = f" with attachments: {att_names}"

            return (
                f"Email draft posted to #{channel} for approval "
                f"(id: {approval_id}){att_note}. Awaiting human review — "
                f"the email will only be sent after someone approves it in Slack."
            )

        case "revise_email_draft":
            from curator.approvals.email_approval import update_draft

            # Resolve any new attachments to add
            add_atts = await _resolve_attachments(
                customer_key, tool_input.get("add_attachments") or [],
            )

            return await update_draft(
                tool_input["approval_id"],
                to=tool_input.get("to"),
                subject=tool_input.get("subject"),
                body=tool_input.get("body"),
                add_attachments=add_atts or None,
                remove_attachments=tool_input.get("remove_attachments"),
            )

        case "revise_pending_action":
            from curator.approvals.action_approval import update_action

            return await update_action(
                tool_input["approval_id"],
                tool_input.get("updates", {}),
            )

        case "escalate_to_human":
            from curator.listeners.slack_listener import post_message
            from curator.storage.event_log import append

            urgency = tool_input["urgency"]
            reason = tool_input["reason"]
            suggested = tool_input.get("suggested_action", "")
            emoji = {"low": "🔵", "medium": "🟡", "high": "🔴"}.get(urgency, "⚪")

            msg = (
                f"{emoji} **Escalation ({urgency.upper()})** — {customer_key}\n"
                f"**Reason:** {reason}\n"
            )
            if suggested:
                msg += f"**Suggested action:** {suggested}\n"

            await post_message("cs-escalations", msg)
            await append(
                customer_key,
                "ESCALATION",
                {"urgency": urgency, "reason": reason, "suggested_action": suggested},
                summary=f"Escalation ({urgency}): {reason}",
            )
            return f"Escalation posted to #cs-escalations ({urgency})"

        case "create_task":
            from curator.scheduler.task_store import create_task

            task = await create_task(
                customer_key,
                description=tool_input["description"],
                schedule=tool_input["schedule"],
                action=tool_input["action"],
                tags=tool_input.get("tags", []),
            )
            return f"Task created: {task['id']} — {task['description']}"

        case "list_tasks":
            from curator.scheduler.task_store import get_tasks

            include_completed = tool_input.get("include_completed", False)
            tasks = await get_tasks(customer_key, include_completed=include_completed)
            if not tasks:
                return "No active tasks found."
            lines = []
            for t in tasks:
                status = t.get("status", "active")
                sched = t.get("schedule", {})
                sched_str = sched.get("at") or sched.get("cron") or sched.get("every", "?")
                lines.append(
                    f"- **{t['id']}** [{status}] {t['description']} "
                    f"(schedule: {sched.get('type', '?')} {sched_str})"
                )
            return "\n".join(lines)

        case "cancel_task":
            from curator.scheduler.task_store import cancel_task

            success = await cancel_task(customer_key, tool_input["task_id"])
            if success:
                return f"Task {tool_input['task_id']} cancelled."
            return f"Task {tool_input['task_id']} not found or already cancelled."

        case "get_slack_history":
            from curator.listeners.slack_listener import get_channel_history

            customer = get_customer(customer_key)
            channel = customer.get("slack_channel", "")
            if not channel:
                return "No Slack channel configured for this customer."
            limit = tool_input.get("limit", 25)
            return await get_channel_history(channel, limit=limit)

        case "get_customer_rules":
            from curator.storage.rules import get_rules as _get_rules

            return await _get_rules(customer_key)

        case "update_customer_rules":
            from curator.storage.rules import update_rules

            content = tool_input.get("rules", "")
            if not content.strip():
                return "Error: rules content cannot be empty."
            await update_rules(customer_key, content, updated_by="agent")
            return f"Customer rules updated ({len(content)} chars)."

        case _:
            return f"Unknown tool: {tool_name}"


async def execute_tool_calls(
    response, customer_key: str, *, source: str = "slack",
) -> list[dict[str, Any]]:
    """Execute all tool calls from a Claude response.

    Returns a list of tool_result content blocks.
    """
    results: list[dict[str, Any]] = []
    for block in response.content:
        if block.type == "tool_use":
            logger.info(
                "[%s] Tool call: %s(%s)",
                customer_key,
                block.name,
                json.dumps(block.input)[:200],
            )
            try:
                result_text = await _execute_tool_call(
                    block.name, block.input, customer_key,
                    source=source,
                )
            except Exception as exc:
                logger.error(
                    "Tool %s failed: %s", block.name, exc, exc_info=True
                )
                result_text = f"Tool error: {exc}"

            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                }
            )
    return results


def _extract_text(response) -> str:
    """Extract the final text content from a Claude response."""
    parts: list[str] = []
    for block in response.content:
        if hasattr(block, "text"):
            parts.append(block.text)
    return "\n".join(parts) if parts else "(No text response)"


# ── Main agent entry point ────────────────────────────────────────────────────


async def run(
    customer_key: str,
    user_message: str,
    thread_id: str | None = None,
    source: str = "slack",
) -> str:
    """Run the curator agent for a customer query.

    Handles the full tool-use loop until Claude produces a final text response.

    Args:
        customer_key: The customer this query is for.
        user_message: The new user message.
        thread_id: Optional conversation thread key (e.g. "slack:acme:#channel").
                   When provided, recent conversation history is prepended so
                   the agent can understand follow-up messages in context.
        source: Where the request originated — ``"email"``, ``"slack"``, or
                ``"web"``.  When ``"email"``, certain mutating tool calls
                require Slack approval before execution.
    """
    # ── Isolation guard: validate customer exists ─────────────────────────
    from curator.customers import CUSTOMERS
    if customer_key not in CUSTOMERS:
        raise ValueError(f"Unknown customer_key: {customer_key!r} — refusing to proceed")

    customer = get_customer(customer_key)

    # Load customer-specific rules so they're injected into the system prompt
    from curator.storage.rules import get_rules
    rules = await get_rules(customer_key)

    system_prompt = build_system_prompt(customer_key, customer, rules=rules)
    client = _get_client()

    # ── Build messages with conversation history ──────────────────────────
    from curator.brain.memory import get_history, add_exchange

    history: list[dict[str, Any]] = []
    if thread_id:
        history = get_history(thread_id)

    messages: list[dict[str, Any]] = history + [
        {"role": "user", "content": user_message},
    ]

    logger.info(
        "[%s] Agent run (thread=%s, history=%d msgs): %s",
        customer_key,
        thread_id or "none",
        len(history),
        user_message[:200],
    )

    # Tool-use loop (max 10 iterations to prevent infinite loops)
    for iteration in range(10):
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=CLAUDE_MAX_TOKENS,
            system=system_prompt,
            tools=CURATOR_TOOLS,
            messages=messages,
        )

        if response.stop_reason != "tool_use":
            break

        # Execute tool calls
        tool_results = await execute_tool_calls(response, customer_key, source=source)

        # Append assistant response + tool results to conversation
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

        logger.info(
            "[%s] Tool loop iteration %d — %d tool calls",
            customer_key,
            iteration + 1,
            len(tool_results),
        )

    result = _extract_text(response)
    logger.info("[%s] Agent done: %s", customer_key, result[:200])

    # ── Save exchange to conversation memory ──────────────────────────────
    if thread_id:
        add_exchange(thread_id, user_message, result)

    return result
