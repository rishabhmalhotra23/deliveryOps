"""Conversation memory — rolling history per thread with TTL expiry.

Gives the agent continuity within a session so follow-up messages
("Meeting artifact") are understood in context of the preceding exchange.

Key design choices:
  - Keyed by *thread_id* (e.g. "slack:acme:#customer_acme" or "email:acme:bob@x.com")
  - Stores only the final user text + assistant text (no tool traces — keeps tokens low)
  - Rolling window of MAX_TURNS most recent exchanges
  - Auto-expires after TTL_SECONDS of inactivity
  - Thread-safe via a simple lock
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

MAX_TURNS: int = 10          # Keep last 10 user/assistant pairs (20 messages)
TTL_SECONDS: float = 900.0   # 15 minutes of inactivity → clear thread


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class _Thread:
    """A single conversation thread's memory."""
    messages: list[dict[str, Any]] = field(default_factory=list)
    last_active: float = field(default_factory=time.time)


_threads: dict[str, _Thread] = {}
_lock = threading.Lock()


# ── Public API ────────────────────────────────────────────────────────────────


def get_history(thread_id: str) -> list[dict[str, Any]]:
    """Return the recent message history for a thread.

    Returns a list of {"role": "user"/"assistant", "content": "..."} dicts
    suitable for prepending to a Claude messages array.
    Expired threads are silently pruned.
    """
    with _lock:
        _prune_expired()
        thread = _threads.get(thread_id)
        if not thread:
            return []
        # Touch the thread (read = activity)
        thread.last_active = time.time()
        # Return a copy so callers can't mutate our state
        return list(thread.messages)


def add_exchange(thread_id: str, user_message: str, assistant_response: str) -> None:
    """Record a completed user→assistant exchange.

    Trims to MAX_TURNS most recent exchanges.
    """
    with _lock:
        thread = _threads.get(thread_id)
        if thread is None:
            thread = _Thread()
            _threads[thread_id] = thread

        thread.messages.append({"role": "user", "content": user_message})
        thread.messages.append({"role": "assistant", "content": assistant_response})
        thread.last_active = time.time()

        # Trim: keep last MAX_TURNS exchanges (each exchange = 2 messages)
        max_msgs = MAX_TURNS * 2
        if len(thread.messages) > max_msgs:
            thread.messages = thread.messages[-max_msgs:]

    logger.debug(
        "Memory [%s]: %d messages stored",
        thread_id,
        len(thread.messages),
    )


def clear_thread(thread_id: str) -> None:
    """Explicitly clear a thread's history."""
    with _lock:
        _threads.pop(thread_id, None)


def clear_all() -> None:
    """Clear all conversation memory (e.g. on restart)."""
    with _lock:
        _threads.clear()


# ── Internal ──────────────────────────────────────────────────────────────────


def _prune_expired() -> None:
    """Remove threads that have been inactive longer than TTL_SECONDS.

    Must be called while holding _lock.
    """
    now = time.time()
    expired = [
        tid for tid, t in _threads.items()
        if (now - t.last_active) > TTL_SECONDS
    ]
    for tid in expired:
        del _threads[tid]
    if expired:
        logger.debug("Memory pruned %d expired threads", len(expired))
