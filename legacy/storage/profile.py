"""Customer profile storage — two separate profiles to prevent data leakage.

1. **Customer-facing profile** (``profile.json``) — safe to reference in
   outbound Slack / email messages.  The Claude agent can read and update this.
2. **Internal-only profile** (``internal_profile.json``) — health scores, churn
   risk, internal notes, etc.  The agent has **zero access**; only the dashboard
   UI can read / write these fields.

Hard rules (both profiles):
  - Existing schema fields cannot be deleted or renamed.
  - Field *values* can be updated freely.
  - New fields from the API are placed in the ``custom`` section.
"""

from __future__ import annotations

import json
import logging
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles

from curator.config import CURATOR_CACHE_DIR
from curator.customers import get_customer

logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════════════
# Customer-facing profile schema
# ══════════════════════════════════════════════════════════════════════════════

PROFILE_SCHEMA: list[dict[str, Any]] = [
    # ── Company ───────────────────────────────────────────────────────────
    {"section": "company", "field": "industry", "type": "str", "description": "Industry vertical", "default": ""},
    {"section": "company", "field": "employee_count", "type": "int", "description": "Number of employees", "default": 0},
    {"section": "company", "field": "website", "type": "str", "description": "Company website URL", "default": ""},
    {"section": "company", "field": "headquarters", "type": "str", "description": "HQ location", "default": ""},
    {"section": "company", "field": "fiscal_year_end", "type": "str", "description": "Fiscal year end (e.g. December)", "default": ""},

    # ── Contract ──────────────────────────────────────────────────────────
    {"section": "contract", "field": "tier", "type": "enum", "description": "Contract tier", "default": "", "options": ["starter", "growth", "enterprise"]},
    {"section": "contract", "field": "start_date", "type": "date", "description": "Contract start date", "default": ""},
    {"section": "contract", "field": "renewal_date", "type": "date", "description": "Next renewal date", "default": ""},
    {"section": "contract", "field": "arr", "type": "float", "description": "Annual recurring revenue ($)", "default": 0.0},
    {"section": "contract", "field": "credit_limit", "type": "int", "description": "Credit limit", "default": 0},
    {"section": "contract", "field": "billing_contact", "type": "str", "description": "Billing contact email", "default": ""},

    # ── Adoption ──────────────────────────────────────────────────────────
    {"section": "adoption", "field": "deployment_stage", "type": "enum", "description": "Current deployment stage", "default": "onboarding", "options": ["onboarding", "pilot", "scaling", "mature"]},
    {"section": "adoption", "field": "automations_live", "type": "int", "description": "Number of live automations", "default": 0},
    {"section": "adoption", "field": "active_users", "type": "int", "description": "Monthly active users", "default": 0},
    {"section": "adoption", "field": "credits_used_mtd", "type": "int", "description": "Credits used month-to-date", "default": 0},
    {"section": "adoption", "field": "last_active_date", "type": "date", "description": "Last platform activity date", "default": ""},

    # ── Contacts ──────────────────────────────────────────────────────────
    {"section": "contacts", "field": "contacts", "type": "contacts_table", "description": "Customer contacts", "default": [],
     "columns": [
         {"key": "name", "label": "Name", "width": "flex-[2]"},
         {"key": "role", "label": "Role / Designation", "width": "flex-[2]"},
         {"key": "email", "label": "Email", "width": "flex-[2]"},
         {"key": "phone", "label": "Phone", "width": "flex-1"},
         {"key": "notes", "label": "Notes", "width": "flex-1"},
     ]},

    # ── Goals ─────────────────────────────────────────────────────────────
    {"section": "goals", "field": "business_objectives", "type": "list", "description": "Business objectives", "default": []},
    {"section": "goals", "field": "success_criteria", "type": "list", "description": "Measurable success criteria", "default": []},
    {"section": "goals", "field": "target_roi", "type": "str", "description": "Target ROI or value metric", "default": ""},
]

PROFILE_SECTION_ORDER = [
    ("company", "Company"),
    ("contract", "Contract"),
    ("adoption", "Adoption & Usage"),
    ("contacts", "Contacts"),
    ("goals", "Goals & Outcomes"),
    ("custom", "Custom Fields"),
]

_PROFILE_FIELDS: set[str] = {f["field"] for f in PROFILE_SCHEMA}
_PROFILE_LOOKUP: dict[str, dict[str, Any]] = {f["field"]: f for f in PROFILE_SCHEMA}

# ══════════════════════════════════════════════════════════════════════════════
# Internal-only profile schema  (agent has ZERO access)
# ══════════════════════════════════════════════════════════════════════════════

INTERNAL_PROFILE_SCHEMA: list[dict[str, Any]] = [
    # ── Health & Engagement ───────────────────────────────────────────────
    {"section": "health", "field": "health_score", "type": "int", "description": "Overall health score (0-100)", "default": 0},
    {"section": "health", "field": "nps_score", "type": "int", "description": "Net Promoter Score (-100 to 100)", "default": 0},
    {"section": "health", "field": "csat_score", "type": "float", "description": "Customer satisfaction score (0-5)", "default": 0.0},
    {"section": "health", "field": "last_qbr_date", "type": "date", "description": "Last QBR date", "default": ""},
    {"section": "health", "field": "next_qbr_date", "type": "date", "description": "Next scheduled QBR date", "default": ""},
    {"section": "health", "field": "churn_risk", "type": "enum", "description": "Churn risk level", "default": "low", "options": ["low", "medium", "high"]},

    # ── Internal Notes ────────────────────────────────────────────────────
    {"section": "internal_notes", "field": "strategic_notes", "type": "text", "description": "Strategic notes and context", "default": ""},
    {"section": "internal_notes", "field": "internal_notes", "type": "text", "description": "Internal team notes", "default": ""},
    {"section": "internal_notes", "field": "last_updated_by", "type": "str", "description": "Who last updated the profile", "default": ""},
]

INTERNAL_SECTION_ORDER = [
    ("health", "Health & Engagement"),
    ("internal_notes", "Internal Notes"),
    ("custom", "Custom Fields"),
]

_INTERNAL_FIELDS: set[str] = {f["field"] for f in INTERNAL_PROFILE_SCHEMA}
_INTERNAL_LOOKUP: dict[str, dict[str, Any]] = {f["field"]: f for f in INTERNAL_PROFILE_SCHEMA}


# ══════════════════════════════════════════════════════════════════════════════
# Shared helpers
# ══════════════════════════════════════════════════════════════════════════════


def _build_default(schema: list[dict[str, Any]]) -> dict[str, Any]:
    """Build a default profile dict from a schema list."""
    out: dict[str, Any] = {}
    for entry in schema:
        out[entry["field"]] = deepcopy(entry["default"])
    out["custom"] = {}
    return out


def _coerce_value(value: Any, schema_entry: dict[str, Any]) -> Any:
    """Best-effort coercion of a value to the schema field's type."""
    field_type = schema_entry["type"]
    try:
        if field_type == "int":
            return int(value) if value not in (None, "") else 0
        if field_type == "float":
            return float(value) if value not in (None, "") else 0.0
        if field_type == "contacts_table":
            if isinstance(value, list):
                return value
            return []
        if field_type == "list":
            if isinstance(value, list):
                return value
            if isinstance(value, str):
                return [v.strip() for v in value.split(",") if v.strip()]
            return []
        if field_type == "enum":
            options = schema_entry.get("options", [])
            if options and value not in options and value != "":
                logger.warning(
                    "Value %r not in allowed options %s for field %s",
                    value, options, schema_entry["field"],
                )
            return str(value) if value is not None else ""
        # str, date, text — all stored as strings
        return str(value) if value is not None else ""
    except (ValueError, TypeError):
        return schema_entry.get("default", "")


async def _load_or_create(
    path: Path,
    schema: list[dict[str, Any]],
    seed_fn=None,
) -> dict[str, Any]:
    """Load a profile from disk or create from defaults."""
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists():
        try:
            async with aiofiles.open(path) as fh:
                data = json.loads(await fh.read())
            # Backfill any new schema fields
            default = _build_default(schema)
            for field_name, default_val in default.items():
                if field_name not in data:
                    data[field_name] = default_val
            if "custom" not in data:
                data["custom"] = {}
            return data
        except Exception:
            logger.warning("Failed to read %s, recreating", path, exc_info=True)

    profile = _build_default(schema)
    if seed_fn:
        seed_fn(profile)
    return profile


async def _apply_updates(
    profile: dict[str, Any],
    updates: dict[str, Any],
    schema_fields: set[str],
    schema_lookup: dict[str, dict[str, Any]],
    updated_by: str,
) -> dict[str, Any]:
    """Apply partial updates to a profile dict."""
    for key, value in updates.items():
        if key == "custom" and isinstance(value, dict):
            profile.setdefault("custom", {}).update(value)
        elif key in schema_fields:
            profile[key] = _coerce_value(value, schema_lookup[key])
        else:
            profile.setdefault("custom", {})[key] = value

    profile["_last_updated"] = datetime.now(timezone.utc).isoformat()
    profile["_last_updated_by"] = updated_by
    return profile


async def _save_to_disk_and_drive(
    customer_key: str, path: Path, profile: dict[str, Any], drive_filename: str,
) -> None:
    """Write to local cache and upload to Drive (best-effort)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(profile, indent=2, default=str)

    async with aiofiles.open(path, "w") as fh:
        await fh.write(payload)

    try:
        from curator.customers import ensure_customer_drive_folder
        from curator.storage import gdrive

        drive_id = await ensure_customer_drive_folder(customer_key)
        if drive_id:
            await gdrive.upload(drive_id, f"meta/{drive_filename}", payload, "application/json")
    except Exception:
        logger.warning("Failed to upload %s to GDrive for %s", drive_filename, customer_key, exc_info=True)


# ══════════════════════════════════════════════════════════════════════════════
# Customer-facing profile  (agent CAN access)
# ══════════════════════════════════════════════════════════════════════════════

def _profile_path(customer_key: str) -> Path:
    return CURATOR_CACHE_DIR / customer_key / "meta" / "profile.json"


def _seed_from_config(profile: dict[str, Any], cfg: dict[str, Any]) -> None:
    """Seed customer-facing profile fields from existing customer config."""
    contract = cfg.get("contract", {})
    if contract.get("tier") and not profile.get("tier"):
        profile["tier"] = contract["tier"]
    if contract.get("renewal_date") and not profile.get("renewal_date"):
        profile["renewal_date"] = contract["renewal_date"]
    if contract.get("credit_limit") and not profile.get("credit_limit"):
        profile["credit_limit"] = contract["credit_limit"]

    # Seed contacts table from config contacts
    cfg_contacts = cfg.get("contacts", {})
    if cfg_contacts and not profile.get("contacts"):
        contacts_list = []
        primary = cfg_contacts.get("primary", "")
        if primary:
            entry = {"name": primary, "role": "Primary Contact", "email": "", "phone": "", "notes": ""}
            if "@" in primary:
                entry["email"] = primary
                entry["name"] = primary.split("@")[0].replace(".", " ").title()
            contacts_list.append(entry)
        for other in cfg_contacts.get("others", []):
            if other:
                entry = {"name": other, "role": "", "email": "", "phone": "", "notes": ""}
                if "@" in other:
                    entry["email"] = other
                    entry["name"] = other.split("@")[0].replace(".", " ").title()
                contacts_list.append(entry)
        if contacts_list:
            profile["contacts"] = contacts_list


async def get_profile(customer_key: str) -> dict[str, Any]:
    """Load or create the customer-facing profile."""
    path = _profile_path(customer_key)

    def _seed(p):
        try:
            cfg = get_customer(customer_key)
            _seed_from_config(p, cfg)
        except KeyError:
            pass

    profile = await _load_or_create(path, PROFILE_SCHEMA, seed_fn=_seed)

    # ── Migration: strip any internal-only fields from old combined profile ──
    migrated = False
    for field_name in list(profile.keys()):
        if field_name in _INTERNAL_FIELDS and field_name not in _PROFILE_FIELDS:
            del profile[field_name]
            migrated = True

    # ── Migration: convert old flat stakeholder fields → contacts table ──
    _OLD_STAKEHOLDER_FIELDS = {
        "champion": "Champion",
        "executive_sponsor": "Executive Sponsor",
        "technical_lead": "Technical Lead",
        "decision_maker": "Decision Maker",
    }
    if any(profile.get(f) for f in _OLD_STAKEHOLDER_FIELDS):
        contacts = profile.get("contacts", [])
        if not isinstance(contacts, list):
            contacts = []
        existing_names = {c.get("name", "").lower() for c in contacts}
        for old_field, role_label in _OLD_STAKEHOLDER_FIELDS.items():
            val = profile.pop(old_field, "").strip()
            if val and val.lower() not in existing_names:
                # Guess if value is email-like or name
                entry = {"name": val, "role": role_label, "email": "", "phone": "", "notes": ""}
                if "@" in val:
                    entry["email"] = val
                    entry["name"] = val.split("@")[0].replace(".", " ").title()
                contacts.append(entry)
        profile["contacts"] = contacts
        migrated = True
    else:
        # Clean up any lingering old fields even if empty
        for old_field in _OLD_STAKEHOLDER_FIELDS:
            if old_field in profile:
                del profile[old_field]
                migrated = True

    if migrated:
        await _save_to_disk_and_drive(customer_key, path, profile, "profile.json")
    elif not path.exists():
        await _save_to_disk_and_drive(customer_key, path, profile, "profile.json")
    return profile


async def update_profile(
    customer_key: str,
    updates: dict[str, Any],
    *,
    updated_by: str = "api",
) -> dict[str, Any]:
    """Update the customer-facing profile.  Returns the updated profile."""
    profile = await get_profile(customer_key)
    await _apply_updates(profile, updates, _PROFILE_FIELDS, _PROFILE_LOOKUP, updated_by)
    await _save_to_disk_and_drive(customer_key, _profile_path(customer_key), profile, "profile.json")
    logger.info("[%s] Profile updated by %s: %d field(s)", customer_key, updated_by, len(updates))
    return profile


def get_profile_schema() -> list[dict[str, Any]]:
    """Return the customer-facing schema for UI rendering."""
    return deepcopy(PROFILE_SCHEMA)


def get_section_order() -> list[tuple[str, str]]:
    """Return the customer-facing section order."""
    return list(PROFILE_SECTION_ORDER)


# ══════════════════════════════════════════════════════════════════════════════
# Internal-only profile  (agent has ZERO access — dashboard UI only)
# ══════════════════════════════════════════════════════════════════════════════

def _internal_profile_path(customer_key: str) -> Path:
    return CURATOR_CACHE_DIR / customer_key / "meta" / "internal_profile.json"


async def get_internal_profile(customer_key: str) -> dict[str, Any]:
    """Load or create the internal-only profile."""
    path = _internal_profile_path(customer_key)

    # ── Migration: seed from old combined profile.json if internal_profile.json
    # doesn't exist yet ──
    def _seed_from_old(p):
        old_path = _profile_path(customer_key)
        if old_path.exists():
            try:
                import json as _json
                with open(old_path) as fh:
                    old_data = _json.loads(fh.read())
                for field_name in _INTERNAL_FIELDS:
                    if field_name in old_data and old_data[field_name] != p.get(field_name):
                        p[field_name] = old_data[field_name]
            except Exception:
                pass

    profile = await _load_or_create(path, INTERNAL_PROFILE_SCHEMA, seed_fn=_seed_from_old if not path.exists() else None)
    if not path.exists():
        await _save_to_disk_and_drive(customer_key, path, profile, "internal_profile.json")
    return profile


async def update_internal_profile(
    customer_key: str,
    updates: dict[str, Any],
    *,
    updated_by: str = "dashboard",
) -> dict[str, Any]:
    """Update the internal-only profile.  Returns the updated profile."""
    profile = await get_internal_profile(customer_key)
    await _apply_updates(profile, updates, _INTERNAL_FIELDS, _INTERNAL_LOOKUP, updated_by)
    path = _internal_profile_path(customer_key)
    await _save_to_disk_and_drive(customer_key, path, profile, "internal_profile.json")
    logger.info("[%s] Internal profile updated by %s: %d field(s)", customer_key, updated_by, len(updates))
    return profile


def get_internal_profile_schema() -> list[dict[str, Any]]:
    """Return the internal-only schema for UI rendering."""
    return deepcopy(INTERNAL_PROFILE_SCHEMA)


def get_internal_section_order() -> list[tuple[str, str]]:
    """Return the internal-only section order."""
    return list(INTERNAL_SECTION_ORDER)
