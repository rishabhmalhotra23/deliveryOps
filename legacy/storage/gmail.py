"""Gmail operations via OAuth2 user credentials.

Uses the shared credential loader from ``google_auth`` and calls the
Gmail v1 API directly.  Synchronous client calls are wrapped with
``asyncio.to_thread`` so the rest of the codebase stays async.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from dataclasses import dataclass, field
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from curator.storage.google_auth import get_gmail_service

logger = logging.getLogger(__name__)


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class EmailAttachment:
    filename: str
    mime_type: str
    data: bytes
    size: int = 0


@dataclass
class Email:
    id: str
    thread_id: str
    from_addr: str
    to_addr: str
    subject: str
    body: str
    snippet: str = ""
    attachments: list[EmailAttachment] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


# ── Internal helpers ──────────────────────────────────────────────────────────


def _get_header(headers: list[dict], name: str) -> str:
    """Extract a header value from the Gmail message headers list."""
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _extract_body(payload: dict) -> str:
    """Recursively extract the plain text body from a Gmail message payload."""
    mime = payload.get("mimeType", "")

    # Simple text part
    if mime == "text/plain" and "body" in payload:
        data = payload["body"].get("data", "")
        if data:
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

    # Multipart — recurse
    for part in payload.get("parts", []):
        text = _extract_body(part)
        if text:
            return text

    return ""


def _extract_attachments_metadata(payload: dict) -> list[dict]:
    """Extract attachment metadata (no data yet) from the payload."""
    attachments = []
    for part in payload.get("parts", []):
        filename = part.get("filename", "")
        if filename and part.get("body", {}).get("attachmentId"):
            attachments.append({
                "filename": filename,
                "mimeType": part.get("mimeType", "application/octet-stream"),
                "attachmentId": part["body"]["attachmentId"],
                "size": part["body"].get("size", 0),
            })
        # Recurse into nested multipart
        attachments.extend(_extract_attachments_metadata(part))
    return attachments


# ── Send-As alias verification ────────────────────────────────────────────────


def _list_send_as_sync() -> list[dict]:
    """Return the list of send-as aliases configured in Gmail."""
    service = get_gmail_service()
    resp = service.users().settings().sendAs().list(userId="me").execute()
    return resp.get("sendAs", [])


async def list_send_as_aliases() -> list[str]:
    """Return all email addresses this Gmail account can send from."""
    entries = await asyncio.to_thread(_list_send_as_sync)
    return [e.get("sendAsEmail", "").lower() for e in entries]


async def verify_send_as_aliases(required_aliases: list[str]) -> list[str]:
    """Check that each *required_alias* is a verified send-as address.

    Returns the list of aliases that are **missing** (not configured in Gmail).
    If the list is empty, all aliases are good.
    """
    configured = set(await list_send_as_aliases())
    missing = [a for a in required_aliases if a.lower() not in configured]
    if missing:
        logger.error(
            "⚠️  MISSING Gmail send-as aliases — emails from these addresses "
            "will be sent from the primary account instead:\n  %s\n"
            "Fix: In Gmail → Settings → Accounts → 'Send mail as' → add each alias.",
            "\n  ".join(missing),
        )
    else:
        logger.info(
            "✓ All %d customer email aliases verified as Gmail send-as addresses",
            len(required_aliases),
        )
    return missing


# ── Read helpers ──────────────────────────────────────────────────────────────


def _get_unread_sync(user_email: str, max_results: int) -> list[Email]:
    """Fetch unread messages addressed to *user_email*."""
    service = get_gmail_service()

    query = f"is:unread to:{user_email}"
    results = service.users().messages().list(
        userId="me", q=query, maxResults=max_results
    ).execute()

    message_ids = results.get("messages", [])
    emails: list[Email] = []

    for msg_ref in message_ids:
        msg = service.users().messages().get(
            userId="me", id=msg_ref["id"], format="full"
        ).execute()

        payload = msg.get("payload", {})
        headers = payload.get("headers", [])

        # Get attachments with data
        att_meta = _extract_attachments_metadata(payload)
        attachments: list[EmailAttachment] = []
        for att in att_meta:
            try:
                att_data = service.users().messages().attachments().get(
                    userId="me", messageId=msg["id"], id=att["attachmentId"]
                ).execute()
                raw_bytes = base64.urlsafe_b64decode(att_data.get("data", ""))
                attachments.append(EmailAttachment(
                    filename=att["filename"],
                    mime_type=att["mimeType"],
                    data=raw_bytes,
                    size=att.get("size", len(raw_bytes)),
                ))
            except Exception:
                logger.warning("Failed to fetch attachment %s", att["filename"], exc_info=True)

        emails.append(Email(
            id=msg["id"],
            thread_id=msg.get("threadId", ""),
            from_addr=_get_header(headers, "From"),
            to_addr=_get_header(headers, "To"),
            subject=_get_header(headers, "Subject"),
            body=_extract_body(payload),
            snippet=msg.get("snippet", ""),
            attachments=attachments,
            labels=msg.get("labelIds", []),
            raw=msg,
        ))

    return emails


async def get_unread(user_email: str, max_results: int = 20) -> list[Email]:
    """Fetch unread messages for *user_email* alias."""
    return await asyncio.to_thread(_get_unread_sync, user_email, max_results)


def _mark_read_sync(message_id: str) -> None:
    """Mark a message as read by removing the UNREAD label."""
    service = get_gmail_service()
    service.users().messages().modify(
        userId="me",
        id=message_id,
        body={"removeLabelIds": ["UNREAD"]},
    ).execute()


async def mark_read(user_email: str, email: Email) -> None:
    """Mark a message as read."""
    await asyncio.to_thread(_mark_read_sync, email.id)
    logger.info("Marked %s as read", email.id)


# ── Send / Reply ──────────────────────────────────────────────────────────────


def _md_to_html(md_body: str) -> str:
    """Convert a markdown string to styled HTML for email."""
    import markdown2

    html_body = markdown2.markdown(
        md_body,
        extras=["tables", "fenced-code-blocks", "cuddled-lists", "break-on-newline"],
    )
    return (
        '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', '
        "Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; "
        'color: #1a1a1a;">'
        "<style>"
        "table { border-collapse: collapse; margin: 12px 0; }"
        "th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }"
        "th { background-color: #f5f5f5; font-weight: 600; }"
        "tr:nth-child(even) { background-color: #fafafa; }"
        "code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 13px; }"
        "pre { background: #f6f6f6; padding: 12px; border-radius: 6px; overflow-x: auto; }"
        "ol, ul { padding-left: 24px; }"
        "li { margin-bottom: 4px; }"
        "hr { border: none; border-top: 1px solid #e0e0e0; margin: 16px 0; }"
        "</style>"
        f"{html_body}"
        "</div>"
    )


def _build_message(
    from_addr: str,
    to: list[str],
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes, str]] | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    thread_id: str | None = None,
) -> dict:
    """Build a Gmail API message dict with HTML-rendered markdown body."""
    html_body = _md_to_html(body)

    # Always send multipart/alternative with plain + HTML
    msg = MIMEMultipart("mixed")
    alt_part = MIMEMultipart("alternative")
    alt_part.attach(MIMEText(body, "plain"))
    alt_part.attach(MIMEText(html_body, "html"))
    msg.attach(alt_part)

    if attachments:
        for filename, data, mime in attachments:
            main_type, _, sub_type = mime.partition("/")
            part = MIMEBase(main_type, sub_type or "octet-stream")
            part.set_payload(data)
            from email import encoders
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=filename)
            msg.attach(part)

    msg["From"] = from_addr
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject

    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")

    result: dict[str, Any] = {"raw": raw}
    if thread_id:
        result["threadId"] = thread_id
    return result


def _send_sync(
    from_addr: str,
    to: list[str],
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes, str]] | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    thread_id: str | None = None,
) -> str:
    """Send an email and return the message ID."""
    service = get_gmail_service()
    message = _build_message(
        from_addr, to, subject, body, attachments,
        in_reply_to=in_reply_to, references=references, thread_id=thread_id,
    )
    sent = service.users().messages().send(userId="me", body=message).execute()
    return sent.get("id", "")


async def send(
    from_addr: str,
    to: str | list[str],
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes, str]] | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    thread_id: str | None = None,
) -> str:
    """Send an email.

    *attachments* is a list of ``(filename, data, mime_type)`` tuples.
    *in_reply_to*, *references*, and *thread_id* are for reply threading.
    Returns the sent message ID.
    """
    if isinstance(to, str):
        to = [to]
    msg_id = await asyncio.to_thread(
        _send_sync, from_addr, to, subject, body, attachments,
        in_reply_to, references, thread_id,
    )
    logger.info("Sent email %s → %s (id: %s)", from_addr, to, msg_id)
    return msg_id


def _reply_sync(
    from_addr: str,
    original: Email,
    body: str,
) -> str:
    """Reply to a thread."""
    service = get_gmail_service()

    # Get the Message-ID header from the original for threading
    original_headers = original.raw.get("payload", {}).get("headers", [])
    message_id_header = _get_header(original_headers, "Message-ID")

    subject = original.subject
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    message = _build_message(
        from_addr=from_addr,
        to=[original.from_addr],
        subject=subject,
        body=body,
        in_reply_to=message_id_header,
        references=message_id_header,
        thread_id=original.thread_id,
    )
    sent = service.users().messages().send(userId="me", body=message).execute()
    return sent.get("id", "")


async def reply(
    from_addr: str,
    original: Email,
    body: str,
) -> str:
    """Reply to an existing email thread."""
    msg_id = await asyncio.to_thread(_reply_sync, from_addr, original, body)
    logger.info("Replied to %s in thread %s (id: %s)", original.id, original.thread_id, msg_id)
    return msg_id
