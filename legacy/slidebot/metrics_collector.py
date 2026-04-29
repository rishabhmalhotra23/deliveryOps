"""Metrics collector — pull customer data from event logs and customer config."""

from __future__ import annotations

import logging
from typing import Any

from curator.customers import get_customer
from curator.storage import event_log

logger = logging.getLogger(__name__)


async def get_credits(customer_key: str) -> dict[str, Any]:
    """Get credit consumption and utilization for a customer.

    Returns placeholder data from the customer config.  When an external
    credits API is wired up, this function can call it instead.
    """
    customer = get_customer(customer_key)
    credit_limit = customer.get("contract", {}).get("credit_limit", 0)
    return {
        "credits_used": 0,
        "credits_remaining": credit_limit,
        "credit_limit": credit_limit,
        "utilization_pct": 0.0,
        "burn_rate": 0.0,
        "projected_exhaustion_date": None,
        "note": "Credits API not configured — showing defaults from customer config",
    }


async def get_full_snapshot(
    customer_key: str, period: str = "last_7_days"
) -> dict[str, Any]:
    """Get a combined metrics snapshot for weekly updates."""
    credits = await get_credits(customer_key)
    events = await event_log.get_recent(customer_key, limit=50)

    return {
        "period": period,
        "credits": credits,
        "recent_events_count": len(events),
    }
