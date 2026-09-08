"use client";

// The editable customer record. Everything the team owns about a customer,
// plus the Salesforce-derived numbers with a way to correct them.
//
// This exists because the Customer 360 had no editing at all — not one
// manual-update or updateProfile call anywhere under
// app/(app)/customers/[key]/ — so ARR, category, owner, renewal and the
// integration mappings were read-only and changing any of them meant a code
// change or raw SQL.
//
// Two write paths, chosen per field by `source`:
//   deliveryops -> POST /api/customers/[key]/manual-update, which writes the
//                  column and adds it to deliveryops_protected_fields so a
//                  later sync can't undo it.
//   salesforce  -> POST /api/overrides, a field_overrides row (0041) that
//                  wins over the read-time derivation, after the confirm step
//                  in EditableValue asks whether the synced value was wrong.
//
// Approved design: docs/mockups/2026-09-04-editable-everything.html.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EditableValue, type OverrideInfo } from "@/app/_components/editable-value";
import { CUSTOMER_CATEGORIES, CONTRACT_TIERS } from "@/lib/supabase/types";

export interface CustomerRecordCardProps {
  customerKey: string;
  customerId: string;
  displayName: string;
  category: string | null;
  aeOwner: string | null;
  partner: string | null;
  active: boolean;
  /** Resolved ARR — already override-aware. */
  arr: number | null;
  renewalDate: string | null;
  salesforceAccountId: string | null;
  slackChannel: string | null;
  /** From `profiles` — a separate table with its own PATCH route, but the
   *  same idea: fields the team owns, editable in place. No sync writes
   *  `profiles`, so there is nothing to protect them from. */
  industry: string | null;
  tier: string | null;
  headquarters: string | null;
  /** Live overrides for this customer, keyed by field. */
  overrides: Record<string, OverrideInfo>;
}

export function CustomerRecordCard(props: CustomerRecordCardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function saveProfile(field: string, value: string | null) {
    setError(null);
    const res = await fetch(`/api/customers/${props.customerKey}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: { [field]: value }, updated_by: "customer-360" }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    router.refresh();
  }

  async function saveOwned(field: string, value: string | null) {
    setError(null);
    const res = await fetch(`/api/customers/${props.customerKey}/manual-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    router.refresh();
  }

  async function saveOverride(
    field: string,
    value: string,
    opts: { permanent: boolean; reason: string },
    syncedValue: unknown
  ) {
    setError(null);
    if (!opts.permanent) {
      // A one-off has nowhere to be stored — the value is derived, so there
      // is no column and no override row. Saying so is better than silently
      // doing nothing or pretending it saved.
      throw new Error(
        "A one-off isn't possible for a derived field: there's no column to hold it until the next sync. Choose “remember mine”, or leave it as the source has it."
      );
    }
    const res = await fetch("/api/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity_type: "customer",
        entity_id: props.customerId,
        field,
        value: field === "confirmed_arr" ? Number(value) : value,
        synced_value: syncedValue,
        reason: opts.reason,
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    router.refresh();
  }

  async function clearOverrideFor(field: string) {
    setError(null);
    const params = new URLSearchParams({
      entity_type: "customer",
      entity_id: props.customerId,
      field,
    });
    const res = await fetch(`/api/overrides?${params}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    router.refresh();
  }

  async function removeCustomer() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${props.customerKey}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      router.push("/customers");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-xl border p-3.5 space-y-3.5"
      style={{ borderColor: "var(--brand-metal-line)", background: "var(--surface-1, var(--card))" }}
    >
      <div className="flex items-center gap-2">
        <span className="dops-tiny-label" style={{ marginBottom: 0 }}>
          Record
        </span>
        <span className="ml-auto text-[10px] text-[color:var(--muted-foreground)]">
          every field editable
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <EditableValue
          label="ARR"
          display={props.arr != null ? fmtMoney(props.arr) : "—"}
          rawValue={props.arr}
          source="salesforce"
          kind="money"
          override={props.overrides.confirmed_arr ?? null}
          onSaveOverride={(v, o) =>
            saveOverride("confirmed_arr", v, o, props.overrides.confirmed_arr?.synced_value ?? null)
          }
          onClearOverride={() => clearOverrideFor("confirmed_arr")}
        />
        <EditableValue
          label="Renewal"
          display={props.renewalDate ?? "—"}
          rawValue={props.renewalDate}
          source="salesforce"
          kind="date"
          override={props.overrides.renewal_date ?? null}
          onSaveOverride={(v, o) =>
            saveOverride("renewal_date", v, o, props.overrides.renewal_date?.synced_value ?? null)
          }
          onClearOverride={() => clearOverrideFor("renewal_date")}
        />
      </div>

      <div className="h-px" style={{ background: "var(--brand-metal-line)" }} />

      <div className="grid grid-cols-2 gap-3">
        <EditableValue
          label="Category"
          display={props.category ?? "—"}
          rawValue={props.category}
          source="deliveryops"
          kind="select"
          options={CUSTOMER_CATEGORIES.map((c) => ({ value: c, label: c }))}
          onSaveOwned={(v) => saveOwned("custom_category", v)}
        />
        <EditableValue
          label="Status"
          display={props.active ? "Active" : "No longer a customer"}
          rawValue={String(props.active)}
          source="deliveryops"
          kind="select"
          options={[
            { value: "true", label: "Active" },
            { value: "false", label: "No longer a customer" },
          ]}
          onSaveOwned={(v) => saveOwned("active", v)}
        />
        <EditableValue
          label="AE owner"
          display={props.aeOwner ?? "—"}
          rawValue={props.aeOwner}
          source="deliveryops"
          onSaveOwned={(v) => saveOwned("ae_owner", v)}
        />
        <EditableValue
          label="Partner"
          display={props.partner ?? "—"}
          rawValue={props.partner}
          source="deliveryops"
          onSaveOwned={(v) => saveOwned("partner", v)}
        />
        <EditableValue
          label="Slack channel"
          display={props.slackChannel ?? "—"}
          rawValue={props.slackChannel}
          source="deliveryops"
          onSaveOwned={(v) => saveOwned("slack_channel", v)}
        />
        <EditableValue
          label="SF account ID"
          display={props.salesforceAccountId ?? "—"}
          rawValue={props.salesforceAccountId}
          source="deliveryops"
          onSaveOwned={(v) => saveOwned("salesforce_account_id", v)}
        />
        <EditableValue
          label="Industry"
          display={props.industry || "—"}
          rawValue={props.industry}
          source="deliveryops"
          onSaveOwned={(v) => saveProfile("industry", v)}
        />
        <EditableValue
          label="Tier"
          display={props.tier || "—"}
          rawValue={props.tier}
          source="deliveryops"
          kind="select"
          options={CONTRACT_TIERS.map((t) => ({ value: t, label: t }))}
          onSaveOwned={(v) => saveProfile("tier", v)}
        />
        <EditableValue
          label="Headquarters"
          display={props.headquarters || "—"}
          rawValue={props.headquarters}
          source="deliveryops"
          onSaveOwned={(v) => saveProfile("headquarters", v)}
        />
      </div>

      {error ? (
        <div className="text-[11.5px]" style={{ color: "var(--status-bad)" }}>
          {error}
        </div>
      ) : null}

      <div className="h-px" style={{ background: "var(--brand-metal-line)" }} />

      {/* Removing a customer was impossible from the product: deleteCustomer
          existed in the store with no route and no UI. Soft, and reversible
          via POST .../{action:"restore"} — but "no longer a customer" is
          usually what Status is for, so that is what the copy points at. */}
      {confirmDelete ? (
        <div className="space-y-2">
          <p className="text-[11.5px] m-0" style={{ color: "var(--st-amber-fg, #FBBF24)" }}>
            Remove {props.displayName} from DeliveryOps? Its processes, events and history are
            kept and it can be restored — but if you only want it out of the dropdowns, set
            Status to &ldquo;No longer a customer&rdquo; instead.
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setConfirmDelete(false)} className="dops-btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void removeCustomer()}
              disabled={busy}
              className="rounded-full px-3 py-1 text-[11.5px] font-semibold disabled:opacity-60"
              style={{ background: "var(--status-bad)", color: "#fff" }}
            >
              {busy ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="text-[11px] text-[color:var(--muted-foreground)] hover:text-[color:var(--status-bad)]"
        >
          Remove this customer…
        </button>
      )}
    </div>
  );
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
