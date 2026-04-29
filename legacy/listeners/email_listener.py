"""Email listener — polls Gmail aliases for new messages.

Watches all customer email aliases, ingests attachments, and responds to
questions via the Claude agent.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from curator.config import EMAIL_POLL_INTERVAL_SECONDS
from curator.customers import CUSTOMERS, resolve_customer_from_alias
from curator.storage import gmail
from curator.storage.gmail import Email

logger = logging.getLogger(__name__)


def _email_matches_alias(email: Email, alias: str) -> bool:
    """Isolation guard: verify the email's To header contains the expected alias."""
    to_lower = email.to_addr.lower()
    return alias.lower() in to_lower


async def _process_email(customer_key: str, email: Email) -> None:
    """Process a single inbound email for a customer."""
    customer = CUSTOMERS[customer_key]
    email_alias = customer["email_alias"]

    # ── Isolation guard: ensure this email is actually for this customer ──
    if not _email_matches_alias(email, email_alias):
        logger.warning(
            "[%s] ISOLATION BLOCK: email To=%r does not contain alias %r — skipping",
            customer_key,
            email.to_addr,
            email_alias,
        )
        return

    logger.info(
        "[%s] Processing email from %s: %s",
        customer_key,
        email.from_addr,
        email.subject[:80],
    )

    # ── 1. Ingest attachments ─────────────────────────────────────────────
    if email.attachments:
        from curator.ingestion.pipeline import IngestFile, ingest

        for att in email.attachments:
            logger.info("[%s] Ingesting attachment: %s", customer_key, att.filename)
            ingest_file = IngestFile(
                filename=att.filename,
                content=att.data,
                mime_type=att.mime_type,
                source="email",
                source_detail=f"From {email.from_addr}: {email.subject}",
            )
            try:
                await ingest(customer_key, ingest_file)
            except Exception:
                logger.error(
                    "Failed to ingest attachment %s from email %s",
                    att.filename,
                    email.id,
                    exc_info=True,
                )

    # ── 2. Run message body through agent ─────────────────────────────────
    body = email.body.strip()
    if body and len(body) > 10:  # Skip near-empty bodies
        from curator.brain.agent import run as agent_run
        from curator.approvals.action_approval import (
            get_pending_ids_for_customer,
            attach_email_context,
            EmailReplyContext,
        )

        try:
            context = (
                f"[Inbound email from {email.from_addr}, subject: {email.subject}]\n\n"
                f"{body}\n\n"
                f"---\n"
                f"Write your reply to this email directly as your response text. "
                f"Do NOT call the send_email tool — your response will be "
                f"automatically queued as a threaded reply for Slack approval."
            )
            thread_id = f"email:{customer_key}:{email.from_addr}"

            # Snapshot pending actions *before* the agent run
            pending_before = get_pending_ids_for_customer(customer_key)

            response = await agent_run(customer_key, context, thread_id=thread_id, source="email")

            # Check if the agent triggered any new gated actions
            pending_after = get_pending_ids_for_customer(customer_key)
            new_actions = pending_after - pending_before

            if new_actions:
                # ── Gated actions exist → defer the email reply ──────────
                email_ctx = EmailReplyContext(
                    from_addr=email_alias,
                    original_email=email,
                    thread_id=thread_id,
                )
                for action_id in new_actions:
                    attach_email_context(action_id, email_ctx)

                logger.info(
                    "[%s] Email reply deferred — %d gated action(s) pending approval: %s",
                    customer_key, len(new_actions), new_actions,
                )

                # Log the deferred state
                from curator.storage.conversations import save_email_conversation
                try:
                    await save_email_conversation(
                        customer_key,
                        from_addr=email.from_addr,
                        to_addr=email.to_addr,
                        subject=email.subject,
                        email_body=body,
                        bot_response="(reply deferred — awaiting action approval)",
                        response_status="deferred_pending_action",
                    )
                except Exception:
                    logger.warning("Failed to persist deferred email conversation", exc_info=True)

            else:
                # ── No gated actions → queue reply immediately ───────────
                from curator.approvals.email_approval import queue_email_reply

                approval_id = await queue_email_reply(
                    customer_key, email_alias, email, response,
                )
                logger.info(
                    "[%s] Email reply queued for approval (id=%s, email=%s)",
                    customer_key, approval_id, email.id,
                )

                # Persist conversation to Drive + event log
                from curator.storage.conversations import save_email_conversation
                try:
                    await save_email_conversation(
                        customer_key,
                        from_addr=email.from_addr,
                        to_addr=email.to_addr,
                        subject=email.subject,
                        email_body=body,
                        bot_response=response,
                        response_status="pending_approval",
                        approval_id=approval_id,
                    )
                except Exception:
                    logger.warning("Failed to persist email conversation", exc_info=True)

        except Exception:
            logger.error(
                "Agent failed for email %s", email.id, exc_info=True
            )

    # ── 3. Mark as read ───────────────────────────────────────────────────
    try:
        await gmail.mark_read(email_alias, email)
    except Exception:
        logger.warning("Failed to mark email %s as read", email.id, exc_info=True)


async def poll_once() -> int:
    """Poll all customer aliases once. Returns the number of emails processed."""
    processed = 0
    for customer_key, config in CUSTOMERS.items():
        alias = config.get("email_alias")
        if not alias:
            continue

        try:
            emails = await gmail.get_unread(alias)
        except Exception:
            logger.error("Failed to poll %s for %s", alias, customer_key, exc_info=True)
            continue

        for email in emails:
            try:
                await _process_email(customer_key, email)
                processed += 1
            except Exception:
                logger.error(
                    "Failed to process email %s for %s",
                    email.id,
                    customer_key,
                    exc_info=True,
                )

    return processed


async def run(interval_seconds: int | None = None) -> None:
    """Run the email polling loop forever.

    Polls all customer aliases every *interval_seconds* (default from config).
    """
    interval = interval_seconds or EMAIL_POLL_INTERVAL_SECONDS
    logger.info("Email poller started (interval: %ds)", interval)

    while True:
        try:
            count = await poll_once()
            if count > 0:
                logger.info("Processed %d email(s)", count)
        except Exception:
            logger.error("Email poll cycle failed", exc_info=True)

        await asyncio.sleep(interval)
