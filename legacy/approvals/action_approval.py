"""Action approval flow — gated tool calls are posted to Slack before execution.

When the agent is running in an email-triggered context and calls a gated tool
(``update_customer_profile`` or ``update_customer_rules``), the action is stored
here and a Block Kit preview is posted to the customer's Slack channel.  Humans
can:

- **Approve** — the tool call is executed
- **Reject** — the action is discarded
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

GATED_TOOLS_EMAIL: set[str] = {
    "update_customer_profile",
    "update_customer_rules",
}

# ── Pending action store ───────────────────────────────────────────────────────


@dataclass
class EmailReplyContext:
    """Saved email metadata so we can compose a threaded reply after approval."""
    from_addr: str        # the alias to send from (e.g. cx_acme@…)
    original_email: Any   # curator.storage.gmail.Email instance
    thread_id: str        # conversation memory key (e.g. "email:acme:jane@…")


@dataclass
class PendingAction:
    approval_id: str
    customer_key: str
    tool_name: str
    tool_input: dict[str, Any]
    channel_id: str = ""
    message_ts: str = ""       # ts of the latest preview message (buttons live here)
    thread_ts: str = ""        # thread root ts (same as first message_ts)
    created_at: float = field(default_factory=time.time)
    email_reply_ctx: EmailReplyContext | None = None


# approval_id → PendingAction
_pending: dict[str, PendingAction] = {}


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def get_pending_ids_for_customer(customer_key: str) -> set[str]:
    """Return the set of pending approval IDs for a given customer."""
    return {
        aid for aid, a in _pending.items()
        if a.customer_key == customer_key
    }


def attach_email_context(approval_id: str, ctx: EmailReplyContext) -> None:
    """Attach email reply context to a pending action.

    Called by the email listener after an agent run that produced gated
    actions, so the approval flow knows to compose and queue the reply
    once the action is resolved.
    """
    if approval_id in _pending:
        _pending[approval_id].email_reply_ctx = ctx
        logger.info("Attached email reply context to action %s", approval_id)


# ── Block Kit helpers ─────────────────────────────────────────────────────────


def _summarize_action(action: PendingAction) -> str:
    """Return a human-readable summary of what the action will do."""
    if action.tool_name == "update_customer_profile":
        updates = action.tool_input.get("updates", {})
        if updates:
            lines: list[str] = []
            for key, val in updates.items():
                lines.append(f"• *{key}*: `{json.dumps(val, default=str)}`")
            return "\n".join(lines)
        return "_No fields specified._"

    if action.tool_name == "update_customer_rules":
        rules = action.tool_input.get("rules", "")
        preview = rules[:1500]
        if len(rules) > 1500:
            preview += "\n\n_(truncated)_"
        return preview

    return f"```{json.dumps(action.tool_input, indent=2, default=str)[:1500]}```"


_TOOL_LABELS: dict[str, str] = {
    "update_customer_profile": "Update Customer Profile",
    "update_customer_rules": "Update Customer Rules",
}


def _build_preview_blocks(action: PendingAction) -> list[dict[str, Any]]:
    """Build Block Kit blocks for an action approval preview."""
    label = _TOOL_LABELS.get(action.tool_name, action.tool_name)
    summary = _summarize_action(action)

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🔒 Action Requires Approval — {label}",
                "emoji": True,
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"Triggered by an inbound email for *{action.customer_key}*",
                },
            ],
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Proposed changes:*\n{summary}"},
        },
        {"type": "divider"},
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Approve", "emoji": True},
                    "style": "primary",
                    "action_id": "approve_action",
                    "value": action.approval_id,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                    "style": "danger",
                    "action_id": "reject_action",
                    "value": action.approval_id,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "💬 Discuss", "emoji": True},
                    "action_id": "discuss_action",
                    "value": action.approval_id,
                },
            ],
        },
    ]
    return blocks


def _build_resolved_blocks(
    action: PendingAction, resolution: str, user_name: str,
) -> list[dict[str, Any]]:
    """Build blocks for a resolved (approved/rejected) action."""
    label = _TOOL_LABELS.get(action.tool_name, action.tool_name)
    if resolution == "approved":
        header = f"✅ {label} — Approved by {user_name}"
    else:
        header = f"❌ {label} — Rejected by {user_name}"

    summary = _summarize_action(action)

    return [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": header, "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": summary},
        },
    ]


# ── Public API ────────────────────────────────────────────────────────────────


async def queue_action(
    customer_key: str,
    tool_name: str,
    tool_input: dict[str, Any],
) -> str:
    """Store a pending action and post it to Slack for approval.

    Returns a human-readable message for the agent indicating the action
    is pending approval.
    """
    from curator.customers import get_customer
    from curator.listeners.slack_listener import _resolve_channel_id, _client

    if not _client:
        raise RuntimeError("Slack client not initialized — cannot queue action for approval")

    approval_id = _new_id()
    action = PendingAction(
        approval_id=approval_id,
        customer_key=customer_key,
        tool_name=tool_name,
        tool_input=tool_input,
    )

    customer = get_customer(customer_key)
    channel_name = customer.get("slack_channel", "")
    if not channel_name:
        raise ValueError(f"No Slack channel configured for customer {customer_key}")

    channel_id = await _resolve_channel_id(channel_name)
    action.channel_id = channel_id

    blocks = _build_preview_blocks(action)
    label = _TOOL_LABELS.get(tool_name, tool_name)
    fallback = f"🔒 {label} requires approval for {customer_key}"

    resp = await _client.chat_postMessage(
        channel=channel_id,
        text=fallback,
        blocks=blocks,
    )

    action.message_ts = resp["ts"]
    action.thread_ts = resp["ts"]  # Thread root is the first message
    _pending[approval_id] = action

    logger.info(
        "[%s] Action queued for approval (id=%s, tool=%s)",
        customer_key, approval_id, tool_name,
    )

    return (
        f"This action ({label}) has been queued for Slack approval (id: {approval_id}). "
        f"It will be executed once a team member approves it in #{channel_name}."
    )


async def _compose_and_queue_reply(
    action: PendingAction, resolution: str, result_text: str | None,
) -> None:
    """Re-run the agent with the action outcome and queue the email reply.

    Called after an action that was triggered by an inbound email is
    approved or rejected.
    """
    ctx = action.email_reply_ctx
    if not ctx:
        return

    label = _TOOL_LABELS.get(action.tool_name, action.tool_name)

    # Include the final tool_input so the agent knows exact values
    # (these may have been revised in Slack before approval)
    final_values = json.dumps(action.tool_input, indent=2, default=str)

    if resolution == "approved":
        outcome_msg = (
            f"[Action outcome] The {label} you requested was approved and executed.\n"
            f"Final values applied:\n{final_values}\n"
            f"Result: {result_text}\n\n"
            f"IMPORTANT: Use the exact values shown above (these may differ from "
            f"the original request if the team revised them before approving).\n\n"
            f"Please compose a brief, friendly email reply to the customer "
            f"confirming the change was made. Write your reply directly as "
            f"your response text. Do NOT call the send_email tool."
        )
    else:
        outcome_msg = (
            f"[Action outcome] The {label} you requested was reviewed but rejected "
            f"by the team.\n\n"
            f"Please compose a brief, polite email reply to the customer explaining "
            f"that we were unable to process this change at this time and they should "
            f"reach out to their account manager for further assistance. Write your "
            f"reply directly as your response text. Do NOT call the send_email tool."
        )

    try:
        from curator.brain.agent import run as agent_run

        reply_text = await agent_run(
            action.customer_key,
            outcome_msg,
            thread_id=ctx.thread_id,
            source="approved",  # prevent re-gating
        )

        from curator.approvals.email_approval import queue_email_reply

        approval_id = await queue_email_reply(
            action.customer_key,
            ctx.from_addr,
            ctx.original_email,
            reply_text,
        )

        logger.info(
            "[%s] Deferred email reply queued after %s (email_approval=%s)",
            action.customer_key, resolution, approval_id,
        )

        # Log the conversation
        from curator.storage.conversations import save_email_conversation

        await save_email_conversation(
            action.customer_key,
            from_addr=ctx.original_email.from_addr,
            to_addr=ctx.original_email.to_addr,
            subject=ctx.original_email.subject,
            email_body=ctx.original_email.body[:2000],
            bot_response=reply_text,
            response_status="pending_approval",
            approval_id=approval_id,
        )

    except Exception:
        logger.error(
            "[%s] Failed to compose deferred email reply after action %s",
            action.customer_key, resolution, exc_info=True,
        )


def get_action_by_thread(channel_id: str, thread_ts: str) -> PendingAction | None:
    """Look up a pending action by its Slack thread.

    Used to detect when a thread reply is on an action approval thread.
    """
    for action in _pending.values():
        if action.channel_id == channel_id and action.thread_ts == thread_ts:
            return action
    return None


def _build_superseded_blocks(action: PendingAction) -> list[dict[str, Any]]:
    """Build blocks for a superseded preview (buttons stripped)."""
    label = _TOOL_LABELS.get(action.tool_name, action.tool_name)
    summary = _summarize_action(action)
    return [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🔒 {label} — Revised",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": summary},
        },
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": "⬇️ _This version has been superseded — see the latest below._"},
            ],
        },
    ]


async def update_action(
    approval_id: str, updates: dict[str, Any],
) -> str:
    """Revise a pending action and re-post the preview.

    Merges *updates* into the action's ``tool_input``, strips buttons from
    the previous preview, and posts a fresh preview with Approve/Reject.

    Returns a confirmation message.
    """
    from curator.listeners.slack_listener import _client

    if approval_id not in _pending:
        return f"Action {approval_id} not found or already resolved."

    action = _pending[approval_id]
    old_message_ts = action.message_ts

    # Merge updates into tool_input based on tool type
    if action.tool_name == "update_customer_profile":
        existing_updates = action.tool_input.get("updates", {})
        existing_updates.update(updates)
        action.tool_input["updates"] = existing_updates
    elif action.tool_name == "update_customer_rules":
        if "rules" in updates:
            action.tool_input["rules"] = updates["rules"]
    else:
        action.tool_input.update(updates)

    if not _client:
        return "Slack client not initialized."

    # Strip buttons from the old message
    try:
        superseded_blocks = _build_superseded_blocks(action)
        label = _TOOL_LABELS.get(action.tool_name, action.tool_name)
        await _client.chat_update(
            channel=action.channel_id,
            ts=old_message_ts,
            text=f"🔒 {label} — Revised (see latest below)",
            blocks=superseded_blocks,
        )
    except Exception:
        logger.warning("Failed to strip buttons from old action preview", exc_info=True)

    # Post fresh preview in the thread
    blocks = _build_preview_blocks(action)
    label = _TOOL_LABELS.get(action.tool_name, action.tool_name)
    fallback = f"🔒 {label} requires approval for {action.customer_key} (revised)"

    resp = await _client.chat_postMessage(
        channel=action.channel_id,
        text=fallback,
        blocks=blocks,
        thread_ts=action.thread_ts,
    )

    action.message_ts = resp["ts"]

    logger.info("[%s] Action %s updated", action.customer_key, approval_id)
    return f"Action updated and re-posted for approval (id: {approval_id})."


async def approve(approval_id: str, user_name: str) -> str:
    """Approve and execute a pending action.

    If this action was triggered by an inbound email, the agent is re-run
    with the outcome context and the reply is queued for email approval.

    Returns a confirmation message.
    """
    from curator.listeners.slack_listener import _client

    if approval_id not in _pending:
        return f"Action {approval_id} not found or already resolved."

    action = _pending.pop(approval_id)

    # Execute the tool call
    from curator.brain.agent import _execute_tool_call

    try:
        result_text = await _execute_tool_call(
            action.tool_name, action.tool_input, action.customer_key,
            source="approved",  # prevents re-gating
        )
    except Exception as exc:
        logger.error("Failed to execute approved action %s: %s", approval_id, exc, exc_info=True)
        result_text = f"Execution failed: {exc}"

    # Update the Slack message to show resolution
    if _client:
        try:
            blocks = _build_resolved_blocks(action, "approved", user_name)
            await _client.chat_update(
                channel=action.channel_id,
                ts=action.message_ts,
                text=f"✅ {action.tool_name} approved by {user_name}",
                blocks=blocks,
            )
        except Exception:
            logger.warning("Failed to update Slack message after action approval", exc_info=True)

    # Log the approval as a structured event
    try:
        from curator.storage.event_log import append as log_event

        label = _TOOL_LABELS.get(action.tool_name, action.tool_name)
        await log_event(
            action.customer_key,
            "ACTION_APPROVED",
            details={
                "tool_name": action.tool_name,
                "tool_input": action.tool_input,
                "approved_by": user_name,
                "approval_id": approval_id,
                "result": result_text[:500],
            },
            summary=f"{label} approved by {user_name}",
            tags=["action", "approved", action.tool_name],
        )
    except Exception:
        logger.warning("Failed to log action approval event", exc_info=True)

    # ── Deferred email reply: re-run agent with outcome, then queue reply ─
    if action.email_reply_ctx:
        await _compose_and_queue_reply(action, "approved", result_text)

    logger.info(
        "[%s] Action approved by %s (id=%s, tool=%s): %s",
        action.customer_key, user_name, approval_id, action.tool_name, result_text[:200],
    )
    return f"Action approved by {user_name}. Result: {result_text}"


async def reject(approval_id: str, user_name: str) -> str:
    """Reject and discard a pending action.

    If this action was triggered by an inbound email, the agent is re-run
    with the rejection context and the reply is queued for email approval.

    Returns a confirmation message.
    """
    from curator.listeners.slack_listener import _client

    if approval_id not in _pending:
        return f"Action {approval_id} not found or already resolved."

    action = _pending.pop(approval_id)

    if _client:
        try:
            blocks = _build_resolved_blocks(action, "rejected", user_name)
            await _client.chat_update(
                channel=action.channel_id,
                ts=action.message_ts,
                text=f"❌ {action.tool_name} rejected by {user_name}",
                blocks=blocks,
            )
        except Exception:
            logger.warning("Failed to update Slack message after action rejection", exc_info=True)

    # Log the rejection as a structured event
    try:
        from curator.storage.event_log import append as log_event

        label = _TOOL_LABELS.get(action.tool_name, action.tool_name)
        await log_event(
            action.customer_key,
            "ACTION_REJECTED",
            details={
                "tool_name": action.tool_name,
                "tool_input": action.tool_input,
                "rejected_by": user_name,
                "approval_id": approval_id,
            },
            summary=f"{label} rejected by {user_name}",
            tags=["action", "rejected", action.tool_name],
        )
    except Exception:
        logger.warning("Failed to log action rejection event", exc_info=True)

    # ── Deferred email reply: re-run agent with rejection context ─────────
    if action.email_reply_ctx:
        await _compose_and_queue_reply(action, "rejected", None)

    logger.info("[%s] Action rejected by %s (id=%s)", action.customer_key, user_name, approval_id)
    return f"Action rejected by {user_name}."
