"""Shared Google OAuth2 credential loader.

Loads user OAuth2 credentials from ``token.json``, auto-refreshes when
expired, and provides pre-built ``googleapiclient`` service objects for
Drive, Gmail, and Slides.

IMPORTANT: ``googleapiclient`` service objects are **not thread-safe**.
Since we use ``asyncio.to_thread`` extensively, each thread gets its own
service object via ``threading.local()``.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from curator.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_PATH

logger = logging.getLogger(__name__)

# All scopes the curator needs
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/presentations",
]

# ── Singleton credentials (thread-safe: only written once at load) ────────────

_creds: Credentials | None = None
_creds_lock = threading.Lock()


def get_credentials() -> Credentials:
    """Return valid OAuth2 credentials, refreshing if necessary.

    Credentials are shared across threads (the token string is immutable
    once loaded), but refresh is protected by a lock.
    """
    global _creds

    # Fast path — already loaded and valid
    if _creds and _creds.valid:
        return _creds

    with _creds_lock:
        # Double-check after acquiring lock
        if _creds and _creds.valid:
            return _creds

        token_path = Path(GOOGLE_TOKEN_PATH)

        if _creds and _creds.expired and _creds.refresh_token:
            logger.info("Access token expired — refreshing…")
            _creds.refresh(Request())
            _save_token(_creds, token_path)
            return _creds

        if token_path.exists():
            logger.info("Loading Google credentials from %s", token_path)
            _creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

            if _creds.expired and _creds.refresh_token:
                logger.info("Token expired on load — refreshing…")
                _creds.refresh(Request())
                _save_token(_creds, token_path)

            return _creds

        raise RuntimeError(
            f"No Google token found at {token_path}. "
            "Run `python setup_oauth.py` to authorize."
        )


def _save_token(creds: Credentials, path: Path) -> None:
    """Persist credentials to disk so they survive restarts."""
    path.write_text(creds.to_json())
    logger.info("Token saved to %s", path)


# ── Thread-local service builders ─────────────────────────────────────────────
#
# googleapiclient service objects are NOT thread-safe.  Since asyncio.to_thread
# dispatches work to a thread-pool, we must give each thread its own service.

_thread_local = threading.local()


def get_drive_service():
    """Return a thread-local Google Drive v3 service object."""
    svc = getattr(_thread_local, "drive", None)
    if svc is None:
        creds = get_credentials()
        svc = build("drive", "v3", credentials=creds, cache_discovery=False)
        _thread_local.drive = svc
    return svc


def get_gmail_service():
    """Return a thread-local Gmail v1 service object."""
    svc = getattr(_thread_local, "gmail", None)
    if svc is None:
        creds = get_credentials()
        svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
        _thread_local.gmail = svc
    return svc


def get_slides_service():
    """Return a thread-local Google Slides v1 service object."""
    svc = getattr(_thread_local, "slides", None)
    if svc is None:
        creds = get_credentials()
        svc = build("slides", "v1", credentials=creds, cache_discovery=False)
        _thread_local.slides = svc
    return svc
