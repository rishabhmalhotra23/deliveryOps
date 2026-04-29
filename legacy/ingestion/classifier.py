"""LLM-based document classifier — determines document category."""

from __future__ import annotations

import logging

import anthropic

from curator.config import ANTHROPIC_API_KEY, CLAUDE_MODEL

logger = logging.getLogger(__name__)

CATEGORIES = [
    "contracts",
    "meeting-notes",
    "sops",
    "support",
    "onboarding",
    "invoices",
    "reports",
    "presentations",
    "correspondence",
    "other",
]

CLASSIFICATION_PROMPT = """\
You are a document classifier for a customer success team.
Given the filename and a preview of the document content, classify it into
exactly ONE of these categories:

{categories}

Respond with ONLY the category name — nothing else. No explanation, no quotes.
If you are unsure, use "other".
"""


async def classify(markdown: str, filename: str) -> str:
    """Classify a document based on its content and filename.

    Returns one of the predefined category strings.
    """
    # Take a preview (first ~2000 chars) to keep costs low
    preview = markdown[:2000] if markdown else "(empty)"

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=50,
            system=CLASSIFICATION_PROMPT.format(categories="\n".join(f"- {c}" for c in CATEGORIES)),
            messages=[
                {
                    "role": "user",
                    "content": f"Filename: {filename}\n\nContent preview:\n{preview}",
                }
            ],
        )
        category = response.content[0].text.strip().lower()

        # Validate it's one of our known categories
        if category in CATEGORIES:
            logger.info("Classified '%s' → %s", filename, category)
            return category
        else:
            logger.warning(
                "LLM returned unknown category '%s' for '%s'; defaulting to 'other'",
                category,
                filename,
            )
            return "other"
    except Exception:
        logger.warning("Classification failed for '%s'; defaulting to 'other'", filename, exc_info=True)
        return "other"
