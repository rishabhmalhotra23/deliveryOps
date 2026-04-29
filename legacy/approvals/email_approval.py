"""Email approval flow — drafts are posted to Slack for review before sending.

When the agent calls ``send_email``, the draft is stored here and a Block Kit
preview is posted to the customer's Slack channel.  Humans can:

- **Approve** — sends the email via Gmail
- **Reject** — discards the draft
- **Reply in thread** — ask the agent to revise; the agent calls
  ``revise_email_draft`` and a fresh preview is posted in the thread.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ── Draft store ───────────────────────────────────────────────────────────────


@dataclass
class EmailAttachment:
    """A file to be attached to the email."""
    filename: str
    data: bytes
    mime_type: str = "application/octet-stream"
    drive_link: str = ""  # Google Drive webViewLink for the Slack preview


@dataclass
class EmailDraft:
    approval_id: str
    customer_key: str
    from_addr: str
    to: list[str]
    subject: str
    body: str
    attachments: list[EmailAttachment] = field(default_factory=list)
    channel_id: str = ""       # Slack channel where preview was posted
    message_ts: str = ""       # ts of the latest preview message (for updating)
    thread_ts: str = ""        # thread root ts (same as first message_ts)
    created_at: float = field(default_factory=time.time)
    # Gmail reply-threading fields (set when this draft is a reply)
    gmail_in_reply_to: str = ""   # Message-ID header of the original email
    gmail_references: str = ""    # References header for the thread
    gmail_thread_id: str = ""     # Gmail thread ID for grouping


# approval_id → EmailDraft
_pending: dict[str, EmailDraft] = {}


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


# ── Block Kit helpers ─────────────────────────────────────────────────────────


def _build_preview_blocks(draft: EmailDraft) -> list[dict[str, Any]]:
    """Build Block Kit blocks for an email draft preview."""
    body_preview = draft.body
    if len(body_preview) > 2000:
        body_preview = body_preview[:2000] + "\n\n_(truncated)_"

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "📧 Email Draft — Awaiting Approval", "emoji": True},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*To:*\n{', '.join(draft.to)}"},
                {"type": "mrkdwn", "text": f"*From:*\n{draft.from_addr}"},
            ],
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Subject:*\n{draft.subject}"},
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": body_preview},
        },
        {"type": "divider"},
    ]

    # ── Attachments section ──────────────────────────────────────────────
    if draft.attachments:
        att_lines: list[str] = []
        for att in draft.attachments:
            size_kb = len(att.data) / 1024
            if size_kb >= 1024:
                size_str = f"{size_kb / 1024:.1f} MB"
            else:
                size_str = f"{size_kb:.0f} KB"

            if att.drive_link:
                att_lines.append(f"• <{att.drive_link}|{att.filename}> ({size_str})")
            else:
                att_lines.append(f"• {att.filename} ({size_str})")

        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*📎 Attachments ({len(draft.attachments)}):*\n" + "\n".join(att_lines),
            },
        })
        blocks.append({"type": "divider"})

    blocks.extend([
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Approve & Send", "emoji": True},
                    "style": "primary",
                    "action_id": "approve_email",
                    "value": draft.approval_id,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                    "style": "danger",
                    "action_id": "reject_email",
                    "value": draft.approval_id,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "💬 Discuss", "emoji": True},
                    "action_id": "discuss_email",
                    "value": draft.approval_id,
                },
            ],
        },
    ])
    return blocks


def _build_resolved_blocks(draft: EmailDraft, action: str, user_name: str) -> list[dict[str, Any]]:
    """Build blocks for a resolved (approved/rejected) email."""
    if action == "approved":
        header = f"✅ Email Sent — Approved by {user_name}"
    else:
        header = f"❌ Email Rejected by {user_name}"

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": header, "emoji": True},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*To:*\n{', '.join(draft.to)}"},
                {"type": "mrkdwn", "text": f"*Subject:*\n{draft.subject}"},
            ],
        },
    ]

    if draft.attachments:
        att_names = ", ".join(a.filename for a in draft.attachments)
        blocks.append({
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"📎 {len(draft.attachments)} attachment(s): {att_names}"},
            ],
        })

    return blocks


def _build_superseded_blocks(draft: EmailDraft) -> list[dict[str, Any]]:
    """Build blocks for a superseded email preview (buttons stripped)."""
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "📧 Email Draft — Revised", "emoji": True},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*To:*\n{', '.join(draft.to)}"},
                {"type": "mrkdwn", "text": f"*Subject:*\n{draft.subject}"},
            ],
        },
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": "⬇️ _This version has been superseded — see the latest below._"},
            ],
        },
    ]
    return blocks


# ── Public API ────────────────────────────────────────────────────────────────


async def queue_email(
    customer_key: str,
    from_addr: str,
    to: list[str],
    subject: str,
    body: str,
    attachments: list[EmailAttachment] | None = None,
) -> str:
    """Store a draft and post it to the customer's Slack channel for approval.

    Returns the approval_id.
    """
    from curator.customers import get_customer
    from curator.listeners.slack_listener import _resolve_channel_id, _client

    if not _client:
        raise RuntimeError("Slack client not initialized — cannot queue email for approval")

    approval_id = _new_id()
    draft = EmailDraft(
        approval_id=approval_id,
        customer_key=customer_key,
        from_addr=from_addr,
        to=to,
        subject=subject,
        body=body,
        attachments=attachments or [],
    )

    customer = get_customer(customer_key)
    channel_name = customer.get("slack_channel", "")
    if not channel_name:
        raise ValueError(f"No Slack channel configured for customer {customer_key}")

    channel_id = await _resolve_channel_id(channel_name)
    draft.channel_id = channel_id

    blocks = _build_preview_blocks(draft)
    fallback = f"📧 Email draft to {', '.join(to)} — Subject: {subject}"

    resp = await _client.chat_postMessage(
        channel=channel_id,
        text=fallback,
        blocks=blocks,
    )

    draft.message_ts = resp["ts"]
    draft.thread_ts = resp["ts"]  # Thread root is the first message

    _pending[approval_id] = draft
    logger.info(
        "[%s] Email draft queued for approval (id=%s, to=%s, subject=%s)",
        customer_key, approval_id, to, subject,
    )

    return approval_id


async def queue_email_reply(
    customer_key: str,
    from_addr: str,
    original_email: Any,
    body: str,
) -> str:
    """Queue an email *reply* for approval.

    Like ``queue_email`` but preserves Gmail threading headers so the
    approved reply lands in the same thread as the original message.

    *original_email* is a ``curator.storage.gmail.Email`` instance.
    """
    from curator.customers import get_customer
    from curator.listeners.slack_listener import _resolve_channel_id, _client

    if not _client:
        raise RuntimeError("Slack client not initialized — cannot queue email for approval")

    # Extract threading info from the original email
    original_headers = original_email.raw.get("payload", {}).get("headers", [])
    message_id_header = ""
    for h in original_headers:
        if h.get("name", "").lower() == "message-id":
            message_id_header = h.get("value", "")
            break

    subject = original_email.subject
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    approval_id = _new_id()
    draft = EmailDraft(
        approval_id=approval_id,
        customer_key=customer_key,
        from_addr=from_addr,
        to=[original_email.from_addr],
        subject=subject,
        body=body,
        gmail_in_reply_to=message_id_header,
        gmail_references=message_id_header,
        gmail_thread_id=original_email.thread_id,
    )

    customer = get_customer(customer_key)
    channel_name = customer.get("slack_channel", "")
    if not channel_name:
        raise ValueError(f"No Slack channel configured for customer {customer_key}")

    channel_id = await _resolve_channel_id(channel_name)
    draft.channel_id = channel_id

    blocks = _build_preview_blocks(draft)
    reply_note = f"↩️ Reply to email from {original_email.from_addr}"
    fallback = f"{reply_note} — Subject: {subject}"

    resp = await _client.chat_postMessage(
        channel=channel_id,
        text=fallback,
        blocks=blocks,
    )

    draft.message_ts = resp["ts"]
    draft.thread_ts = resp["ts"]

    _pending[approval_id] = draft
    logger.info(
        "[%s] Email reply draft queued for approval (id=%s, to=%s, subject=%s)",
        customer_key, approval_id, draft.to, subject,
    )

    return approval_id


async def update_draft(
    approval_id: str,
    *,
    to: list[str] | None = None,
    subject: str | None = None,
    body: str | None = None,
    add_attachments: list[EmailAttachment] | None = None,
    remove_attachments: list[str] | None = None,
) -> str:
    """Update a pending draft and post a fresh preview in the thread.

    *add_attachments* appends new attachments.
    *remove_attachments* is a list of filenames to remove.

    Returns a confirmation message.
    """
    from curator.listeners.slack_listener import _client

    if approval_id not in _pending:
        return f"Draft {approval_id} not found or already resolved."

    draft = _pending[approval_id]

    if to is not None:
        draft.to = to
    if subject is not None:
        draft.subject = subject
    if body is not None:
        draft.body = body
    if remove_attachments:
        names_to_remove = {n.lower() for n in remove_attachments}
        draft.attachments = [
            a for a in draft.attachments if a.filename.lower() not in names_to_remove
        ]
    if add_attachments:
        draft.attachments.extend(add_attachments)

    if not _client:
        return "Slack client not initialized."

    old_message_ts = draft.message_ts

    # Strip buttons from the old preview message
    try:
        superseded_blocks = _build_superseded_blocks(draft)
        await _client.chat_update(
            channel=draft.channel_id,
            ts=old_message_ts,
            text="📧 Email Draft — Revised (see latest below)",
            blocks=superseded_blocks,
        )
    except Exception:
        logger.warning("Failed to strip buttons from old email draft preview", exc_info=True)

    # Post updated preview in the thread
    blocks = _build_preview_blocks(draft)
    fallback = f"📧 Updated draft to {', '.join(draft.to)} — Subject: {draft.subject}"

    resp = await _client.chat_postMessage(
        channel=draft.channel_id,
        text=fallback,
        blocks=blocks,
        thread_ts=draft.thread_ts,
    )

    # Track the latest message ts
    draft.message_ts = resp["ts"]

    logger.info("[%s] Draft %s updated", draft.customer_key, approval_id)
    return f"Draft updated and re-posted for approval (id: {approval_id})."


async def approve(approval_id: str, user_name: str) -> str:
    """Approve and send a pending email draft.

    Returns a confirmation message.
    """
    from curator.listeners.slack_listener import _client
    from curator.storage.gmail import send

    if approval_id not in _pending:
        return f"Draft {approval_id} not found or already resolved."

    draft = _pending.pop(approval_id)

    # Build Gmail attachment tuples: (filename, data, mime_type)
    gmail_attachments: list[tuple[str, bytes, str]] | None = None
    if draft.attachments:
        gmail_attachments = [
            (att.filename, att.data, att.mime_type)
            for att in draft.attachments
        ]

    # Send the email (with threading headers if this is a reply)
    msg_id = await send(
        from_addr=draft.from_addr,
        to=draft.to,
        subject=draft.subject,
        body=draft.body,
        attachments=gmail_attachments,
        in_reply_to=draft.gmail_in_reply_to or None,
        references=draft.gmail_references or None,
        thread_id=draft.gmail_thread_id or None,
    )

    # Update the Slack message to show resolution
    if _client:
        try:
            blocks = _build_resolved_blocks(draft, "approved", user_name)
            await _client.chat_update(
                channel=draft.channel_id,
                ts=draft.message_ts,
                text=f"✅ Email sent — approved by {user_name}",
                blocks=blocks,
            )
        except Exception:
            logger.warning("Failed to update Slack message after approval", exc_info=True)

    # Log the approval as a structured event
    try:
        from curator.storage.event_log import append as log_event

        await log_event(
            draft.customer_key,
            "EMAIL_RESPONSE_SENT",
            details={
                "to": draft.to,
                "subject": draft.subject,
                "from": draft.from_addr,
                "body": draft.body[:2000],
                "approved_by": user_name,
                "approval_id": approval_id,
                "gmail_id": msg_id,
                "attachment_count": len(draft.attachments),
                "is_reply": bool(draft.gmail_thread_id),
            },
            summary=f"Email to {', '.join(draft.to)}: {draft.subject[:80]} — approved by {user_name}",
            tags=["email", "sent", "approved"],
        )
    except Exception:
        logger.warning("Failed to log email approval event", exc_info=True)

    logger.info(
        "[%s] Email approved by %s and sent (id=%s, gmail_id=%s)",
        draft.customer_key, user_name, approval_id, msg_id,
    )
    return f"Email sent (approved by {user_name}, gmail id: {msg_id})."


async def reject(approval_id: str, user_name: str) -> str:
    """Reject and discard a pending email draft.

    Returns a confirmation message.
    """
    from curator.listeners.slack_listener import _client

    if approval_id not in _pending:
        return f"Draft {approval_id} not found or already resolved."

    draft = _pending.pop(approval_id)

    if _client:
        try:
            blocks = _build_resolved_blocks(draft, "rejected", user_name)
            await _client.chat_update(
                channel=draft.channel_id,
                ts=draft.message_ts,
                text=f"❌ Email rejected by {user_name}",
                blocks=blocks,
            )
        except Exception:
            logger.warning("Failed to update Slack message after rejection", exc_info=True)

    # Log the rejection as a structured event
    try:
        from curator.storage.event_log import append as log_event

        await log_event(
            draft.customer_key,
            "EMAIL_RESPONSE_REJECTED",
            details={
                "to": draft.to,
                "subject": draft.subject,
                "from": draft.from_addr,
                "rejected_by": user_name,
                "approval_id": approval_id,
                "is_reply": bool(draft.gmail_thread_id),
            },
            summary=f"Email to {', '.join(draft.to)}: {draft.subject[:80]} — rejected by {user_name}",
            tags=["email", "rejected"],
        )
    except Exception:
        logger.warning("Failed to log email rejection event", exc_info=True)

    logger.info("[%s] Email rejected by %s (id=%s)", draft.customer_key, user_name, approval_id)
    return f"Email draft rejected by {user_name}."


def get_draft_by_thread(channel_id: str, thread_ts: str) -> EmailDraft | None:
    """Look up a pending draft by its Slack thread.

    Used to detect when a thread reply is on an approval thread.
    """
    for draft in _pending.values():
        if draft.channel_id == channel_id and draft.thread_ts == thread_ts:
            return draft
    return None


def get_draft(approval_id: str) -> EmailDraft | None:
    """Get a pending draft by ID."""
    return _pending.get(approval_id)
