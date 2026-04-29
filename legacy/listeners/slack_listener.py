"""Slack Bolt app — listens to messages, file uploads, and mentions.

Handles three event types:
1. Messages in customer channels (questions / instructions)
2. File uploads to customer channels (ingest them)
3. Direct mentions anywhere (@curator ...)
"""

from __future__ import annotations

import io
import logging
import re
from typing import Any

from slack_bolt.async_app import AsyncApp
from slack_sdk.web.async_client import AsyncWebClient

from curator.config import SLACK_BOT_TOKEN, SLACK_APP_TOKEN
from curator.customers import (
    resolve_customer_from_channel,
    CUSTOMERS,
)

logger = logging.getLogger(__name__)


# ── Markdown → Slack Block Kit ────────────────────────────────────────────────


def _md_to_mrkdwn(text: str) -> str:
    """Convert standard markdown to Slack mrkdwn syntax."""
    # Headers: ## Heading → *Heading*
    text = re.sub(r"^#{1,3}\s+(.+)$", r"*\1*", text, flags=re.MULTILINE)
    # Bold: **text** → *text*
    text = re.sub(r"\*\*(.+?)\*\*", r"*\1*", text)
    # Inline code stays the same: `code`
    # Links: [text](url) → <url|text>
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"<\2|\1>", text)
    return text


def _md_to_blocks(markdown: str) -> list[dict]:
    """Convert a markdown response into Slack Block Kit blocks.

    Handles headings, tables, horizontal rules, and regular text.
    """
    blocks: list[dict] = []
    lines = markdown.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]

        # ── Horizontal rule ───────────────────────────────────────────
        if re.match(r"^-{3,}$", line.strip()):
            blocks.append({"type": "divider"})
            i += 1
            continue

        # ── Markdown table ────────────────────────────────────────────
        # Detect table: line with | ... | followed by |---|---|
        if "|" in line and i + 1 < len(lines) and re.match(
            r"^\|[\s\-:|]+\|$", lines[i + 1].strip()
        ):
            table_lines = []
            # Collect header
            table_lines.append(line)
            i += 1  # skip to separator
            i += 1  # skip separator
            # Collect data rows
            while i < len(lines) and "|" in lines[i] and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1

            # Parse into fields
            fields: list[dict] = []
            header_cells = [c.strip() for c in table_lines[0].split("|") if c.strip()]
            for row_line in table_lines[1:]:
                cells = [c.strip() for c in row_line.split("|") if c.strip()]
                for col_idx, cell in enumerate(cells):
                    label = header_cells[col_idx] if col_idx < len(header_cells) else ""
                    # Convert **bold** to *bold* for mrkdwn
                    label = re.sub(r"\*\*(.+?)\*\*", r"*\1*", label)
                    cell = re.sub(r"\*\*(.+?)\*\*", r"*\1*", cell)
                    fields.append({
                        "type": "mrkdwn",
                        "text": f"*{label}*\n{cell}" if label else cell,
                    })

            # Slack allows max 10 fields per section — chunk them
            for chunk_start in range(0, len(fields), 10):
                chunk = fields[chunk_start : chunk_start + 10]
                blocks.append({"type": "section", "fields": chunk})
            continue

        # ── Header lines ──────────────────────────────────────────────
        header_match = re.match(r"^(#{1,3})\s+(.+)$", line)
        if header_match:
            level = len(header_match.group(1))
            header_text = header_match.group(2).strip()
            header_text = re.sub(r"\*\*(.+?)\*\*", r"\1", header_text)
            block_type = "header" if level <= 2 else "section"
            if block_type == "header":
                blocks.append({
                    "type": "header",
                    "text": {"type": "plain_text", "text": header_text, "emoji": True},
                })
            else:
                blocks.append({
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f"*{header_text}*"},
                })
            i += 1
            continue

        # ── Regular text — collect consecutive non-special lines ──────
        text_lines: list[str] = []
        while i < len(lines):
            l = lines[i]
            if re.match(r"^-{3,}$", l.strip()):
                break
            if re.match(r"^#{1,3}\s+", l):
                break
            # Check if this starts a table
            if "|" in l and i + 1 < len(lines) and re.match(
                r"^\|[\s\-:|]+\|$", lines[i + 1].strip()
            ):
                break
            text_lines.append(l)
            i += 1

        text_block = "\n".join(text_lines).strip()
        if text_block:
            text_block = _md_to_mrkdwn(text_block)
            # Slack section text max is 3000 chars — split if needed
            while text_block:
                chunk = text_block[:3000]
                text_block = text_block[3000:]
                blocks.append({
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": chunk},
                })

    return blocks if blocks else [{"type": "section", "text": {"type": "mrkdwn", "text": markdown}}]


async def _say_rich(say, text: str) -> None:
    """Send a message using Block Kit blocks with a plain-text fallback."""
    blocks = _md_to_blocks(text)
    fallback = _md_to_mrkdwn(text)
    await say(text=fallback, blocks=blocks)


# ── User name resolution ─────────────────────────────────────────────────────

_user_cache: dict[str, str] = {}  # user_id → display_name


async def _resolve_user_name(user_id: str) -> str:
    """Resolve a Slack user ID to a display name (cached)."""
    if user_id in _user_cache:
        return _user_cache[user_id]
    if not _client or user_id == "unknown":
        return user_id
    try:
        resp = await _client.users_info(user=user_id)
        user = resp.get("user", {})
        name = (
            user.get("real_name")
            or user.get("profile", {}).get("display_name")
            or user.get("name")
            or user_id
        )
        _user_cache[user_id] = name
        return name
    except Exception:
        logger.debug("Could not resolve user %s", user_id, exc_info=True)
        return user_id


import re

_USER_MENTION_RE = re.compile(r"<@(U[A-Z0-9]+)>")
_CHANNEL_MENTION_RE = re.compile(r"<#(C[A-Z0-9]+)\|([^>]+)>")


async def resolve_mentions(text: str) -> str:
    """Replace raw Slack mentions with human-readable names.

    - ``<@U0887C0PLG3>`` → ``@Jimmy Salame``
    - ``<#C12345|general>`` → ``#general``
    """
    # Resolve channel mentions (no async needed — name is in the match)
    text = _CHANNEL_MENTION_RE.sub(r"#\2", text)

    # Resolve user mentions
    user_ids = set(_USER_MENTION_RE.findall(text))
    for uid in user_ids:
        display = await _resolve_user_name(uid)
        text = text.replace(f"<@{uid}>", f"@{display}")

    return text


# ── Slack app singleton ───────────────────────────────────────────────────────

_app: AsyncApp | None = None
_client: AsyncWebClient | None = None


def create_slack_app() -> AsyncApp:
    """Create and configure the Slack Bolt async app."""
    global _app, _client

    _app = AsyncApp(token=SLACK_BOT_TOKEN)
    _client = _app.client

    # ── 1. Message in a customer channel ──────────────────────────────────

    @_app.event("message")
    async def handle_message(event: dict[str, Any], say) -> None:
        """Handle messages in customer channels."""
        # Ignore bot messages and message edits
        if event.get("subtype") in ("bot_message", "message_changed", "message_deleted"):
            return
        if event.get("bot_id"):
            return

        channel_id = event.get("channel", "")
        text = event.get("text", "").strip()

        # Check for file attachments in the message
        files = event.get("files", [])
        file_names = [f.get("name", "unknown") for f in files]

        if not text and not files:
            return

        # ── Check if this is a reply in an approval thread ─────────
        thread_ts = event.get("thread_ts")
        if thread_ts and text:
            from curator.approvals.email_approval import get_draft_by_thread
            from curator.approvals.action_approval import get_action_by_thread

            draft = get_draft_by_thread(channel_id, thread_ts)
            if draft:
                await _handle_approval_thread_reply(
                    event, say, draft, channel_id, text, thread_ts,
                )
                return

            action = get_action_by_thread(channel_id, thread_ts)
            if action:
                await _handle_action_approval_thread_reply(
                    event, say, action, channel_id, text, thread_ts,
                )
                return

        # Resolve channel name → customer key
        channel_info = await _client.conversations_info(channel=channel_id)
        channel_name = channel_info["channel"]["name"]

        customer_key = resolve_customer_from_channel(channel_name)
        if not customer_key:
            return  # Not a customer channel — ignore

        # ── Isolation guard ───────────────────────────────────────────
        assert customer_key in CUSTOMERS, (
            f"Isolation violation: resolved key {customer_key!r} not in registry"
        )

        user_id = event.get("user", "unknown")
        user_name = await _resolve_user_name(user_id)
        logger.info("[%s] Slack message from %s (%s): %s", customer_key, user_name, user_id, text[:100])

        # Enrich agent context with pending action info
        agent_text = text
        from curator.approvals.action_approval import (
            get_pending_ids_for_customer as _get_pending_action_ids,
            _pending as _action_pending,
            _TOOL_LABELS,
            _summarize_action,
        )
        pending_action_ids = _get_pending_action_ids(customer_key)
        if pending_action_ids:
            pending_notes: list[str] = []
            for pid in pending_action_ids:
                pa = _action_pending.get(pid)
                if pa:
                    label = _TOOL_LABELS.get(pa.tool_name, pa.tool_name)
                    summary = _summarize_action(pa)
                    pending_notes.append(
                        f"- {label} (approval_id: {pid}): {summary}"
                    )
            if pending_notes:
                agent_text += (
                    "\n\n[System note: There are pending actions awaiting approval "
                    "for this customer. If the user's message relates to one of "
                    "these, use revise_pending_action to update it. Do NOT call "
                    "the underlying tool directly.\n"
                    + "\n".join(pending_notes) + "]"
                )

        # Enrich agent context with file attachment info
        if file_names:
            attachment_note = (
                f"\n\n[Attached files: {', '.join(file_names)}. "
                "These are being ingested separately — acknowledge them in your response.]"
            )
            agent_text = (text or "(file upload)") + attachment_note

        if not agent_text.strip():
            return

        # Run through the agent (with conversation memory keyed by channel)
        from curator.brain.agent import run as agent_run

        thread_id = f"slack:{customer_key}:{channel_name}"
        try:
            response = await agent_run(customer_key, agent_text, thread_id=thread_id)
            await _say_rich(say, response)

            # Persist conversation to Drive + event log
            from curator.storage.conversations import save_slack_conversation
            try:
                clean_text = await resolve_mentions(text)
                await save_slack_conversation(
                    customer_key,
                    user_id=user_id,
                    user_name=user_name,
                    channel_name=channel_name,
                    user_message=clean_text,
                    bot_response=response,
                )
            except Exception:
                logger.warning("Failed to persist Slack conversation", exc_info=True)

        except Exception:
            logger.error("Agent failed for %s", customer_key, exc_info=True)
            await say("⚠️ Sorry, I encountered an error processing that. Please try again.")

    # ── 2. File uploaded to a customer channel ────────────────────────────

    @_app.event("file_shared")
    async def handle_file_shared(event: dict[str, Any]) -> None:
        """Handle file uploads in customer channels."""
        file_id = event.get("file_id") or event.get("file", {}).get("id")
        channel_id = event.get("channel_id", "")

        if not file_id or not channel_id:
            return

        # Resolve channel
        try:
            channel_info = await _client.conversations_info(channel=channel_id)
            channel_name = channel_info["channel"]["name"]
        except Exception:
            return

        customer_key = resolve_customer_from_channel(channel_name)
        if not customer_key:
            return

        logger.info("[%s] File shared: %s", customer_key, file_id)

        # Get file info
        try:
            file_resp = await _client.files_info(file=file_id)
            file_info = file_resp["file"]
        except Exception:
            logger.error("Failed to get file info for %s", file_id, exc_info=True)
            return

        # Download the file
        try:
            url = file_info.get("url_private_download") or file_info.get("url_private")
            if not url:
                logger.warning("No download URL for file %s", file_id)
                return

            import aiohttp

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url, headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"}
                ) as resp:
                    if resp.status != 200:
                        logger.error("Failed to download file %s: %s", file_id, resp.status)
                        return
                    content = await resp.read()
        except Exception:
            logger.error("Failed to download file %s", file_id, exc_info=True)
            return

        # Ingest
        from curator.ingestion.pipeline import IngestFile, ingest

        ingest_file = IngestFile(
            filename=file_info.get("name", "unknown"),
            content=content,
            mime_type=file_info.get("mimetype", "application/octet-stream"),
            source="slack",
            source_detail=f"#{channel_name} by <@{event.get('user_id', 'unknown')}>",
        )

        try:
            status = await ingest(customer_key, ingest_file)
            # Post confirmation to the channel
            await _client.chat_postMessage(channel=channel_id, text=status)
        except Exception:
            logger.error("Ingestion failed for %s", file_id, exc_info=True)
            await _client.chat_postMessage(
                channel=channel_id,
                text=f"⚠️ Failed to ingest {ingest_file.filename}. Please try again.",
            )

    # ── 3. Direct mention (@curator ...) ──────────────────────────────────

    @_app.event("app_mention")
    async def handle_mention(event: dict[str, Any], say) -> None:
        """Handle @curator mentions in any channel."""
        text = event.get("text", "").strip()
        channel_id = event.get("channel", "")

        # Strip the bot mention from the text
        text = re.sub(r"<@[A-Z0-9]+>\s*", "", text).strip()
        if not text:
            await say("Hi! How can I help? Mention me with a question about a customer.")
            return

        # Try to resolve customer from channel first
        customer_key = None
        channel_name = channel_id  # fallback to ID
        try:
            channel_info = await _client.conversations_info(channel=channel_id)
            channel_name = channel_info["channel"]["name"]
            customer_key = resolve_customer_from_channel(channel_name)
        except Exception:
            pass

        # If not in a customer channel, try to parse customer from message
        if not customer_key:
            customer_key = _guess_customer_from_text(text)

        if not customer_key:
            await say(
                "I couldn't determine which customer you're asking about. "
                "Please mention me in a customer channel or include the customer name."
            )
            return

        # ── Isolation guard ───────────────────────────────────────────
        assert customer_key in CUSTOMERS, (
            f"Isolation violation: resolved key {customer_key!r} not in registry"
        )

        user_id = event.get("user", "unknown")
        user_name = await _resolve_user_name(user_id)
        logger.info("[%s] Mention from %s (%s): %s", customer_key, user_name, user_id, text[:100])

        from curator.brain.agent import run as agent_run

        thread_id = f"slack:{customer_key}:{channel_name}"
        try:
            response = await agent_run(customer_key, text, thread_id=thread_id)
            await _say_rich(say, response)

            # Persist conversation to Drive + event log
            from curator.storage.conversations import save_slack_conversation
            try:
                clean_text = await resolve_mentions(text)
                await save_slack_conversation(
                    customer_key,
                    user_id=user_id,
                    user_name=user_name,
                    channel_name=channel_name,
                    user_message=clean_text,
                    bot_response=response,
                )
            except Exception:
                logger.warning("Failed to persist mention conversation", exc_info=True)

        except Exception:
            logger.error("Agent failed for mention", exc_info=True)
            await say("⚠️ Sorry, I encountered an error. Please try again.")

    # ── 4. Email approval actions ─────────────────────────────────────

    @_app.action("approve_email")
    async def handle_approve_email(ack, body) -> None:
        """Handle the Approve button on an email draft."""
        await ack()
        from curator.approvals.email_approval import approve

        action = body.get("actions", [{}])[0]
        approval_id = action.get("value", "")
        user = body.get("user", {})
        user_name = user.get("real_name") or user.get("username") or user.get("id", "unknown")

        result = await approve(approval_id, user_name)
        logger.info("Email approval: %s — %s", approval_id, result)

    @_app.action("reject_email")
    async def handle_reject_email(ack, body) -> None:
        """Handle the Reject button on an email draft."""
        await ack()
        from curator.approvals.email_approval import reject

        action = body.get("actions", [{}])[0]
        approval_id = action.get("value", "")
        user = body.get("user", {})
        user_name = user.get("real_name") or user.get("username") or user.get("id", "unknown")

        result = await reject(approval_id, user_name)
        logger.info("Email rejection: %s — %s", approval_id, result)

    @_app.action("discuss_email")
    async def handle_discuss_email(ack, body) -> None:
        """Handle the Discuss button on an email draft — opens the thread."""
        await ack()
        from curator.approvals.email_approval import get_draft

        action = body.get("actions", [{}])[0]
        approval_id = action.get("value", "")
        user = body.get("user", {})
        user_name = user.get("real_name") or user.get("username") or user.get("id", "unknown")

        draft = get_draft(approval_id)
        if not draft:
            return

        await _client.chat_postMessage(
            channel=draft.channel_id,
            text=(
                f"💬 *Discussion opened by {user_name}*\n"
                f"Reply in this thread to suggest changes to the email draft. "
                f"I'll revise it based on your feedback."
            ),
            thread_ts=draft.thread_ts,
        )

    # ── 5. Action approval buttons (profile/rules updates from email) ──

    @_app.action("approve_action")
    async def handle_approve_action(ack, body) -> None:
        """Handle the Approve button on a gated action."""
        await ack()
        from curator.approvals.action_approval import approve

        action = body.get("actions", [{}])[0]
        approval_id = action.get("value", "")
        user = body.get("user", {})
        user_name = user.get("real_name") or user.get("username") or user.get("id", "unknown")

        result = await approve(approval_id, user_name)
        logger.info("Action approval: %s — %s", approval_id, result)

    @_app.action("reject_action")
    async def handle_reject_action(ack, body) -> None:
        """Handle the Reject button on a gated action."""
        await ack()
        from curator.approvals.action_approval import reject

        action = body.get("actions", [{}])[0]
        approval_id = action.get("value", "")
        user = body.get("user", {})
        user_name = user.get("real_name") or user.get("username") or user.get("id", "unknown")

        result = await reject(approval_id, user_name)
        logger.info("Action rejection: %s — %s", approval_id, result)

    @_app.action("discuss_action")
    async def handle_discuss_action(ack, body) -> None:
        """Handle the Discuss button on a gated action — opens the thread."""
        await ack()
        from curator.approvals.action_approval import _pending

        action_btn = body.get("actions", [{}])[0]
        approval_id = action_btn.get("value", "")
        user = body.get("user", {})
        user_name = user.get("real_name") or user.get("username") or user.get("id", "unknown")

        pending_action = _pending.get(approval_id)
        if not pending_action:
            return

        await _client.chat_postMessage(
            channel=pending_action.channel_id,
            text=(
                f"💬 *Discussion opened by {user_name}*\n"
                f"Reply in this thread to suggest changes to the proposed action. "
                f"I'll revise it based on your feedback."
            ),
            thread_ts=pending_action.thread_ts,
        )

    return _app


async def _handle_approval_thread_reply(
    event: dict[str, Any],
    say,
    draft,
    channel_id: str,
    text: str,
    thread_ts: str,
) -> None:
    """Route a thread reply on an email approval to the agent for editing."""
    from curator.brain.agent import run as agent_run

    user_id = event.get("user", "unknown")
    user_name = await _resolve_user_name(user_id)

    logger.info(
        "[%s] Email draft edit request from %s: %s",
        draft.customer_key, user_name, text[:100],
    )

    # Build context for the agent so it knows this is a draft edit request
    att_summary = ""
    if draft.attachments:
        att_names = ", ".join(a.filename for a in draft.attachments)
        att_summary = f"  Attachments: {att_names}\n"

    agent_text = (
        f"[Email draft edit request — approval_id: {draft.approval_id}]\n"
        f"Current draft:\n"
        f"  To: {', '.join(draft.to)}\n"
        f"  Subject: {draft.subject}\n"
        f"{att_summary}"
        f"  Body:\n{draft.body}\n\n"
        f"User request: {text}\n\n"
        f"Use the revise_email_draft tool with approval_id '{draft.approval_id}' "
        f"to update the draft. Only include fields that need to change. "
        f"To add attachments, use add_attachments with file paths from the "
        f"customer's knowledge base (e.g. 'original_docs/contracts/file.pdf'). "
        f"To remove attachments, use remove_attachments with filenames."
    )

    thread_id = f"email_edit:{draft.customer_key}:{draft.approval_id}"

    try:
        response = await agent_run(draft.customer_key, agent_text, thread_id=thread_id)
        # Reply in the thread
        blocks = _md_to_blocks(response)
        fallback = _md_to_mrkdwn(response)
        await _client.chat_postMessage(
            channel=channel_id,
            text=fallback,
            blocks=blocks,
            thread_ts=thread_ts,
        )
    except Exception:
        logger.error("Agent failed for email draft edit", exc_info=True)
        await _client.chat_postMessage(
            channel=channel_id,
            text="⚠️ Sorry, I encountered an error processing that edit request.",
            thread_ts=thread_ts,
        )


async def _handle_action_approval_thread_reply(
    event: dict[str, Any],
    say,
    action,
    channel_id: str,
    text: str,
    thread_ts: str,
) -> None:
    """Route a thread reply on an action approval to the agent for editing."""
    from curator.brain.agent import run as agent_run
    from curator.approvals.action_approval import _summarize_action, _TOOL_LABELS

    user_id = event.get("user", "unknown")
    user_name = await _resolve_user_name(user_id)

    label = _TOOL_LABELS.get(action.tool_name, action.tool_name)
    logger.info(
        "[%s] Action edit request from %s: %s",
        action.customer_key, user_name, text[:100],
    )

    summary = _summarize_action(action)

    agent_text = (
        f"[Action approval edit request — approval_id: {action.approval_id}]\n"
        f"Action type: {label}\n"
        f"Current proposed changes:\n{summary}\n\n"
        f"User request: {text}\n\n"
        f"Use the revise_pending_action tool with approval_id "
        f"'{action.approval_id}' to update the proposed changes. "
        f"Provide only the fields that need to change in the 'updates' object. "
        f"If the user is just asking a question, answer conversationally."
    )

    thread_id = f"action_edit:{action.customer_key}:{action.approval_id}"

    try:
        response = await agent_run(action.customer_key, agent_text, thread_id=thread_id)
        blocks = _md_to_blocks(response)
        fallback = _md_to_mrkdwn(response)
        await _client.chat_postMessage(
            channel=channel_id,
            text=fallback,
            blocks=blocks,
            thread_ts=thread_ts,
        )
    except Exception:
        logger.error("Agent failed for action approval edit", exc_info=True)
        await _client.chat_postMessage(
            channel=channel_id,
            text="⚠️ Sorry, I encountered an error processing that edit request.",
            thread_ts=thread_ts,
        )


def _guess_customer_from_text(text: str) -> str | None:
    """Try to identify a customer key from free-form text."""
    text_lower = text.lower()
    for key, cfg in CUSTOMERS.items():
        # Check customer key
        if key in text_lower:
            return key
        # Check display name
        display = cfg.get("display_name", "").lower()
        if display and display in text_lower:
            return key
    return None


# ── Public helpers (used by agent tool calls) ─────────────────────────────────


_channel_id_cache: dict[str, str] = {}  # channel_name → channel_id


async def _resolve_channel_id(channel: str) -> str:
    """Resolve a channel name to its ID, with caching."""
    if channel.startswith("C") or channel.startswith("D"):
        return channel  # Already an ID

    if channel in _channel_id_cache:
        return _channel_id_cache[channel]

    if not _client:
        return channel

    # Paginate through all channels the bot can see
    cursor = None
    while True:
        kwargs: dict[str, Any] = {
            "types": "public_channel,private_channel",
            "limit": 200,
            "exclude_archived": True,
        }
        if cursor:
            kwargs["cursor"] = cursor

        resp = await _client.conversations_list(**kwargs)
        for ch in resp.get("channels", []):
            # Cache every channel we see
            _channel_id_cache[ch["name"]] = ch["id"]
            if ch["name"] == channel:
                return ch["id"]

        cursor = resp.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break

    logger.warning("Could not resolve channel name '%s' to an ID", channel)
    return channel  # Return as-is; will fail at API call with a clear error


async def create_channel(name: str) -> str:
    """Create a Slack channel and join it. Returns the channel ID.

    If the channel already exists, joins it and returns its ID.
    """
    if not _client:
        raise RuntimeError("Slack client not initialized — cannot create channel")

    # Normalize: Slack channel names must be lowercase, no spaces
    name = name.lower().replace(" ", "-")

    try:
        resp = await _client.conversations_create(name=name)
        channel_id = resp["channel"]["id"]
        _channel_id_cache[name] = channel_id
        logger.info("Created Slack channel #%s → %s", name, channel_id)
        return channel_id
    except Exception as exc:
        error_str = str(exc)
        # "name_taken" means it already exists — find and join it
        if "name_taken" in error_str:
            logger.info("Channel #%s already exists — resolving and joining", name)
            channel_id = await _resolve_channel_id(name)
            try:
                await _client.conversations_join(channel=channel_id)
            except Exception:
                pass  # Already a member
            return channel_id
        raise RuntimeError(f"Failed to create Slack channel #{name}: {exc}") from exc


async def get_channel_history(channel: str, limit: int = 25) -> str:
    """Fetch recent messages from a Slack channel.

    Returns a formatted string of messages with timestamps and user names.
    """
    if not _client:
        return "Slack client not initialized — cannot fetch history."
    if not channel:
        return "No channel specified."

    limit = max(1, min(limit, 100))

    try:
        channel_id = await _resolve_channel_id(channel)

        result = await _client.conversations_history(
            channel=channel_id, limit=limit,
        )
        messages = result.get("messages", [])

        if not messages:
            return "No messages found in this channel."

        # Messages come newest-first; reverse for chronological order
        messages.reverse()

        lines: list[str] = []
        for msg in messages:
            user_id = msg.get("user", msg.get("bot_id", "unknown"))
            user_name = await _resolve_user_name(user_id)
            ts = msg.get("ts", "")
            # Convert Slack timestamp to readable format
            try:
                from datetime import datetime
                dt = datetime.fromtimestamp(float(ts))
                time_str = dt.strftime("%Y-%m-%d %H:%M")
            except (ValueError, TypeError):
                time_str = ts

            text = msg.get("text", "").strip()
            if not text:
                # Check for attachments/blocks
                attachments = msg.get("attachments", [])
                if attachments:
                    text = "[attachment]"
                else:
                    text = "[empty message]"

            lines.append(f"[{time_str}] {user_name}: {text}")

        return "\n".join(lines)

    except Exception as exc:
        logger.error("Failed to fetch channel history for %s: %s", channel, exc, exc_info=True)
        return f"Error fetching channel history: {exc}"


async def fetch_full_history(channel: str, oldest: float = 0) -> list[dict[str, Any]]:
    """Paginate through the entire Slack channel history.

    Returns all messages in chronological order (oldest first).
    Each message dict is the raw Slack API message object.
    """
    if not _client:
        raise RuntimeError("Slack client not initialized")

    channel_id = await _resolve_channel_id(channel)
    all_messages: list[dict[str, Any]] = []
    cursor: str | None = None

    while True:
        kwargs: dict[str, Any] = {
            "channel": channel_id,
            "limit": 200,
            "oldest": str(oldest),
        }
        if cursor:
            kwargs["cursor"] = cursor

        resp = await _client.conversations_history(**kwargs)
        messages = resp.get("messages", [])
        all_messages.extend(messages)

        cursor = resp.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break

    # Messages come newest-first; reverse for chronological order
    all_messages.reverse()
    return all_messages


async def download_slack_file(file_info: dict[str, Any]) -> bytes | None:
    """Download a file from Slack given its file_info dict.

    Returns the file content bytes, or None on failure.
    """
    url = file_info.get("url_private_download") or file_info.get("url_private")
    if not url:
        return None

    import aiohttp

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url, headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"}
            ) as resp:
                if resp.status != 200:
                    logger.warning("Failed to download Slack file: HTTP %s", resp.status)
                    return None
                return await resp.read()
    except Exception:
        logger.warning("Failed to download Slack file", exc_info=True)
        return None


async def post_message(channel: str | None, text: str) -> None:
    """Post a message to a Slack channel by name or ID."""
    if not _client:
        logger.warning("Slack client not initialized — cannot post message")
        return
    if not channel:
        logger.warning("No channel specified for message")
        return

    try:
        # If it looks like a channel name (not an ID), find the ID
        if not channel.startswith("C") and not channel.startswith("D"):
            # Try to find by name
            resp = await _client.conversations_list(types="public_channel,private_channel", limit=500)
            for ch in resp.get("channels", []):
                if ch["name"] == channel:
                    channel = ch["id"]
                    break

        blocks = _md_to_blocks(text)
        fallback = _md_to_mrkdwn(text)
        await _client.chat_postMessage(channel=channel, text=fallback, blocks=blocks)
    except Exception:
        logger.error("Failed to post message to %s", channel, exc_info=True)


async def start() -> None:
    """Start the Slack app in socket mode."""
    from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

    if not _app:
        raise RuntimeError("Slack app not created — call create_slack_app() first")

    handler = AsyncSocketModeHandler(_app, SLACK_APP_TOKEN)
    logger.info("Starting Slack socket mode listener…")
    await handler.start_async()
