"""Task executor — checks for due tasks and dispatches them.

Runs on a 60-second loop, checking each customer's task list for due items.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from curator.customers import CUSTOMERS
from curator.scheduler import task_store
from curator.storage import event_log

logger = logging.getLogger(__name__)


# ── Schedule helpers ──────────────────────────────────────────────────────────


def _parse_interval(s: str) -> timedelta | None:
    """Parse an interval string like '1h', '4h', '1d', '1w' into a timedelta."""
    m = re.match(r"^(\d+)\s*([hdwm])$", s.strip().lower())
    if not m:
        return None
    val, unit = int(m.group(1)), m.group(2)
    match unit:
        case "h":
            return timedelta(hours=val)
        case "d":
            return timedelta(days=val)
        case "w":
            return timedelta(weeks=val)
        case "m":
            return timedelta(minutes=val)
    return None


def _cron_is_due(cron_expr: str, now: datetime) -> bool:
    """Simple cron check — supports basic '0 9 * * 1' style expressions.

    Fields: minute hour day_of_month month day_of_week
    Only checks if current time matches (within the current minute).
    """
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        logger.warning("Invalid cron expression: %s", cron_expr)
        return False

    minute, hour, dom, month, dow = parts

    def matches(field: str, value: int) -> bool:
        if field == "*":
            return True
        # Handle comma-separated values
        for item in field.split(","):
            if item.isdigit() and int(item) == value:
                return True
            # Handle ranges like 1-5
            if "-" in item:
                low, high = item.split("-", 1)
                if low.isdigit() and high.isdigit() and int(low) <= value <= int(high):
                    return True
            # Handle step values like */5
            if item.startswith("*/") and item[2:].isdigit():
                step = int(item[2:])
                if step > 0 and value % step == 0:
                    return True
        return False

    return (
        matches(minute, now.minute)
        and matches(hour, now.hour)
        and matches(dom, now.day)
        and matches(month, now.month)
        and matches(dow, now.weekday())  # Monday=0
    )


def is_due(task: dict[str, Any], now: datetime) -> bool:
    """Determine if a task is due to fire right now."""
    schedule = task.get("schedule", {})
    stype = schedule.get("type")

    match stype:
        case "once":
            at = schedule.get("at")
            if not at:
                return False
            try:
                target = datetime.fromisoformat(at)
                # Make timezone-aware if needed
                if target.tzinfo is None:
                    target = target.replace(tzinfo=timezone.utc)
                return now >= target
            except ValueError:
                return False

        case "recurring":
            every = schedule.get("every")
            if not every:
                return False
            interval = _parse_interval(every)
            if not interval:
                return False
            last_run = task.get("last_run")
            if last_run:
                try:
                    last = datetime.fromisoformat(last_run)
                    if last.tzinfo is None:
                        last = last.replace(tzinfo=timezone.utc)
                    return now >= last + interval
                except ValueError:
                    return True
            else:
                return True  # Never run → due now

        case "cron":
            cron = schedule.get("cron")
            if not cron:
                return False
            # Check 'until' if specified
            until = schedule.get("until")
            if until:
                try:
                    until_dt = datetime.fromisoformat(until)
                    if until_dt.tzinfo is None:
                        until_dt = until_dt.replace(tzinfo=timezone.utc)
                    if now > until_dt:
                        return False
                except ValueError:
                    pass
            return _cron_is_due(cron, now)

    return False


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _get_primary_contact_email(customer_key: str) -> str | None:
    """Resolve the primary contact email from the dynamic profile."""
    from curator.storage.profile import get_profile

    try:
        profile = await get_profile(customer_key)
        contacts = profile.get("contacts") or []
        if contacts and isinstance(contacts, list):
            for c in contacts:
                email = c.get("email", "")
                if email:
                    return email
    except Exception:
        pass
    return None


# ── Dispatch functions ────────────────────────────────────────────────────────


async def dispatch_reminder(customer_key: str, task: dict[str, Any]) -> None:
    """Send a reminder message to the specified channel."""
    action = task.get("action", {})
    channel = action.get("channel", "slack")
    message = action.get("message", task.get("description", "Reminder"))

    match channel:
        case "slack":
            from curator.listeners.slack_listener import post_message
            from curator.customers import get_customer

            customer = get_customer(customer_key)
            await post_message(customer["slack_channel"], f"⏰ {message}")

        case "email":
            from curator.storage.gmail import send
            from curator.customers import get_customer

            customer = get_customer(customer_key)
            to_addr = await _get_primary_contact_email(customer_key)
            if not to_addr:
                logger.warning("[%s] No primary contact email — cannot send reminder", customer_key)
                return
            await send(
                from_addr=customer["email_alias"],
                to=to_addr,
                subject=f"Reminder: {task['description']}",
                body=message,
            )

        case "internal":
            from curator.listeners.slack_listener import post_message

            await post_message("cs-internal", f"⏰ [{customer_key}] {message}")


async def dispatch_check(customer_key: str, task: dict[str, Any]) -> None:
    """Run a predefined check and post results."""
    from curator.brain.agent import run as agent_run

    # Use the agent to run the check
    prompt = (
        f"Run a health check for this customer. "
        f"Check details: {task.get('description', 'general health check')}"
    )
    response = await agent_run(customer_key, prompt)
    await _post_to_channel(customer_key, task.get("action", {}).get("channel", "internal"), response)


async def _post_to_channel(customer_key: str, channel: str, message: str) -> None:
    """Post a message to the specified channel type."""
    match channel:
        case "slack":
            from curator.listeners.slack_listener import post_message
            from curator.customers import get_customer

            customer = get_customer(customer_key)
            await post_message(customer["slack_channel"], message)

        case "email":
            from curator.storage.gmail import send
            from curator.customers import get_customer

            customer = get_customer(customer_key)
            to_addr = await _get_primary_contact_email(customer_key)
            if not to_addr:
                logger.warning("[%s] No primary contact email — cannot send update", customer_key)
                return
            await send(
                from_addr=customer["email_alias"],
                to=to_addr,
                subject=f"Automated Update: {customer['display_name']}",
                body=message,
            )

        case "internal":
            from curator.listeners.slack_listener import post_message

            await post_message("cs-internal", f"[{customer_key}] {message}")


# ── Main executor loop ────────────────────────────────────────────────────────


async def run_executor(interval_seconds: int = 60) -> None:
    """Check for due tasks every *interval_seconds* and execute them.

    This runs forever — intended to be launched as a background task.
    """
    logger.info("Task executor started (interval: %ds)", interval_seconds)
    while True:
        now = datetime.now(timezone.utc)
        for customer_key in list(CUSTOMERS.keys()):
            try:
                tasks = await task_store.get_active(customer_key)
            except Exception:
                logger.error("Failed to load tasks for %s", customer_key, exc_info=True)
                continue

            for task in tasks:
                if not is_due(task, now):
                    continue

                task_id = task["id"]
                logger.info("[%s] Executing task %s: %s", customer_key, task_id, task["description"])

                try:
                    action_type = task.get("action", {}).get("type", "remind")

                    match action_type:
                        case "remind":
                            await dispatch_reminder(customer_key, task)
                        case "check":
                            await dispatch_check(customer_key, task)
                        case "run_prompt":
                            from curator.brain.agent import run as agent_run

                            prompt = task["action"].get("prompt", task["description"])
                            response = await agent_run(customer_key, prompt)
                            channel = task["action"].get("channel", "internal")
                            await _post_to_channel(customer_key, channel, response)

                    # Update task status
                    stype = task.get("schedule", {}).get("type")
                    if stype == "once":
                        await task_store.complete_task(customer_key, task_id)
                    else:
                        await task_store.update_last_run(customer_key, task_id, now)

                    # Log execution
                    await event_log.append(
                        customer_key,
                        "TASK_EXECUTED",
                        {"task_id": task_id, "description": task["description"]},
                        summary=f"Task executed: {task['description']}",
                    )

                except Exception:
                    logger.error(
                        "[%s] Task %s failed", customer_key, task_id, exc_info=True
                    )

        await asyncio.sleep(interval_seconds)
