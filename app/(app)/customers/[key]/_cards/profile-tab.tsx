"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContactRow, InternalProfile, Profile } from "@/lib/supabase/types";
import { computeStaleFields, CUSTOMER_FRESHNESS_FIELDS, type StaleField } from "@/lib/customers/staleness";

interface ProfileTabProps {
  customerKey: string;
}

// Section blueprint — drives the rendered field grid + the type-aware
// inputs. Adding a field here makes it visible + editable.
const PROFILE_SECTIONS: Array<{
  title: string;
  fields: Array<{ key: keyof Profile; label: string; type: "text" | "number" | "date" | "select"; options?: string[] }>;
}> = [
  {
    title: "Company",
    fields: [
      { key: "industry", label: "Industry", type: "text" },
      { key: "employee_count", label: "Employees", type: "number" },
      { key: "website", label: "Website", type: "text" },
      { key: "headquarters", label: "Headquarters", type: "text" },
      { key: "fiscal_year_end", label: "Fiscal year end", type: "text" },
    ],
  },
  {
    title: "Contract",
    fields: [
      { key: "tier", label: "Tier", type: "select", options: ["", "starter", "growth", "enterprise"] },
      { key: "start_date", label: "Start date", type: "date" },
      { key: "renewal_date", label: "Renewal date", type: "date" },
      { key: "arr", label: "ARR ($)", type: "number" },
      { key: "credit_limit", label: "Credit limit", type: "number" },
      { key: "billing_contact", label: "Billing contact", type: "text" },
    ],
  },
  {
    title: "Adoption",
    fields: [
      {
        key: "deployment_stage",
        label: "Deployment stage",
        type: "select",
        options: ["onboarding", "pilot", "scaling", "mature"],
      },
      { key: "automations_live", label: "Automations live", type: "number" },
      { key: "active_users", label: "Active users", type: "number" },
      { key: "credits_used_mtd", label: "Credits used (MTD)", type: "number" },
      { key: "last_active_date", label: "Last active", type: "date" },
    ],
  },
  {
    title: "Goals",
    fields: [
      { key: "target_roi", label: "Target ROI", type: "text" },
    ],
  },
];

const INTERNAL_FIELDS: Array<{
  key: keyof InternalProfile;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea";
  options?: string[];
}> = [
  { key: "health_score", label: "Health score", type: "number" },
  { key: "churn_risk", label: "Churn risk", type: "select", options: ["low", "medium", "high"] },
  { key: "next_qbr_date", label: "Next QBR", type: "date" },
  { key: "last_qbr_date", label: "Last QBR", type: "date" },
  { key: "strategic_notes", label: "Strategic notes", type: "textarea" },
  { key: "internal_notes", label: "Internal notes", type: "textarea" },
];

const EMPTY_CONTACT: ContactRow = { name: "", role: "", email: "", phone: "", notes: "" };

// Small "needs review" tag for a field that's gone past its freshness
// threshold — see lib/customers/staleness.ts. Purely informational; the
// fix is just editing the field normally.
function StaleTag({ stale }: { stale: StaleField | undefined }) {
  if (!stale) return null;
  const confirmed = stale.lastConfirmedAt
    ? `Last confirmed by ${stale.lastConfirmedBy ?? "unknown"}, ${stale.daysSinceConfirmed}d ago`
    : `Never confirmed — record is ${stale.daysSinceConfirmed}d old`;
  return (
    <span
      title={confirmed}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
    >
      Needs review
    </span>
  );
}

export function ProfileTab({ customerKey }: ProfileTabProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [internal, setInternal] = useState<InternalProfile | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [internalDraft, setInternalDraft] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState(false);
  const [internalEditing, setInternalEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactsEditing, setContactsEditing] = useState(false);
  const [contactsDraft, setContactsDraft] = useState<ContactRow[]>([]);

  const staleByKey = useMemo(() => {
    const stale = computeStaleFields(CUSTOMER_FRESHNESS_FIELDS, {
      profile: profile ? { field_provenance: profile.field_provenance, updated_at: profile.updated_at } : undefined,
      internalProfile: internal
        ? { field_provenance: internal.field_provenance, updated_at: internal.updated_at }
        : undefined,
    });
    return new Map(stale.map((s) => [s.key, s]));
  }, [profile, internal]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, ip] = await Promise.all([
        fetch(`/api/customers/${customerKey}/profile`).then((r) => r.json()),
        fetch(`/api/customers/${customerKey}/internal-profile`).then((r) => r.json()),
      ]);
      if (p.error) throw new Error(p.error);
      if (ip.error) throw new Error(ip.error);
      setProfile(p.profile as Profile);
      setInternal(ip.internalProfile as InternalProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerKey]);

  async function saveProfile() {
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerKey}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: draft }),
      });
      const json = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setProfile(json.profile ?? null);
      setDraft({});
      setEditing(false);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveContacts() {
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerKey}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: { contacts: contactsDraft } }),
      });
      const json = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setProfile(json.profile ?? null);
      setContactsEditing(false);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveInternal() {
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerKey}/internal-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: internalDraft }),
      });
      const json = (await res.json()) as { internalProfile?: InternalProfile; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setInternal(json.internalProfile ?? null);
      setInternalDraft({});
      setInternalEditing(false);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  }

  function fieldValue<K extends keyof Profile>(key: K): string {
    if (editing && key in draft) return String(draft[key as string] ?? "");
    const v = profile?.[key];
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function setField(key: string, value: string, type: string) {
    setDraft((d) => ({
      ...d,
      [key]: type === "number" ? (value === "" ? null : Number(value)) : value || null,
    }));
  }

  function internalFieldValue<K extends keyof InternalProfile>(key: K): string {
    if (internalEditing && key in internalDraft) return String(internalDraft[key as string] ?? "");
    const v = internal?.[key];
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function setInternalField(key: string, value: string, type: string) {
    setInternalDraft((d) => ({
      ...d,
      [key]: type === "number" ? (value === "" ? null : Number(value)) : value || null,
    }));
  }

  if (loading) return <div className="glass-card p-5 text-xs text-[color:var(--muted-foreground)]">Loading…</div>;
  if (error) return <div className="glass-card p-5 text-xs text-red-500">Error: {error}</div>;

  return (
    <div className="space-y-4">
      {/* Customer-facing profile */}
      <div className="glass-card glass-card-hover p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow text-[color:var(--muted-foreground)]">Profile</div>
            <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
              Customer-facing fields — the agent reads and writes these
            </div>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => {
                    setDraft({});
                    setEditing(false);
                  }}
                  className="text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  onClick={saveProfile}
                  disabled={saving || Object.keys(draft).length === 0}
                  className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {PROFILE_SECTIONS.map((section) => (
          <div key={section.title} className="space-y-2">
            <div className="eyebrow text-[color:var(--muted-foreground)]">{section.title}</div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {section.fields.map((f) => {
                const v = fieldValue(f.key);
                const stale = staleByKey.get(String(f.key));
                if (!editing) {
                  return (
                    <div key={String(f.key)} className="text-sm">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                        {f.label}
                        <StaleTag stale={stale} />
                      </div>
                      <div className="text-[color:var(--foreground)]">{v || "—"}</div>
                    </div>
                  );
                }
                return (
                  <div key={String(f.key)} className="text-sm">
                    <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                      {f.label}
                      <StaleTag stale={stale} />
                    </label>
                    {f.type === "select" ? (
                      <select
                        value={v}
                        onChange={(e) => setField(String(f.key), e.target.value, f.type)}
                        className="w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1 text-sm"
                      >
                        {(f.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt || "—"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.type}
                        value={v}
                        onChange={(e) => setField(String(f.key), e.target.value, f.type)}
                        className="w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1 text-sm"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Contacts */}
      <div className="glass-card glass-card-hover p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 eyebrow text-[color:var(--muted-foreground)]">
              Contacts
              <StaleTag stale={staleByKey.get("contacts")} />
            </div>
            <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
              Key people at this account — edit directly when you hear of a change
            </div>
          </div>
          <div className="flex gap-2">
            {contactsEditing ? (
              <>
                <button
                  onClick={() => {
                    setContactsDraft(profile?.contacts ?? []);
                    setContactsEditing(false);
                  }}
                  className="text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  onClick={saveContacts}
                  disabled={saving}
                  className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setContactsDraft(profile?.contacts ?? []);
                  setContactsEditing(true);
                }}
                className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {!contactsEditing ? (
          (profile?.contacts ?? []).length === 0 ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">No contacts on file.</div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {(profile?.contacts ?? []).map((c, i) => (
                <div key={i} className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5 text-sm">
                  <div className="font-medium text-[color:var(--foreground)]">{c.name || "—"}</div>
                  <div className="text-[color:var(--muted-foreground)]">
                    {[c.role, c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {c.notes ? <div className="text-[color:var(--muted-foreground)] mt-1">{c.notes}</div> : null}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-2">
            {contactsDraft.map((c, i) => (
              <div key={i} className="grid grid-cols-2 lg:grid-cols-5 gap-2 items-start rounded-md border border-[var(--glass-border)] p-2.5">
                {(["name", "role", "email", "phone", "notes"] as const).map((field) => (
                  <input
                    key={field}
                    placeholder={field}
                    value={c[field]}
                    onChange={(e) =>
                      setContactsDraft((rows) =>
                        rows.map((r, idx) => (idx === i ? { ...r, [field]: e.target.value } : r))
                      )
                    }
                    className="w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1 text-sm"
                  />
                ))}
                <button
                  onClick={() => setContactsDraft((rows) => rows.filter((_, idx) => idx !== i))}
                  className="col-span-2 lg:col-span-5 text-xs text-red-500 hover:text-red-600 text-left"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              onClick={() => setContactsDraft((rows) => [...rows, { ...EMPTY_CONTACT }])}
              className="text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            >
              + Add contact
            </button>
          </div>
        )}
      </div>

      {/* Internal profile */}
      <div className="glass-card glass-card-hover p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow text-[color:var(--muted-foreground)]">Internal · FDE only</div>
            <div className="text-sm font-semibold text-[color:var(--foreground)] tracking-tight">
              QBR dates and notes — agent has zero read access to these fields
            </div>
          </div>
          <div className="flex gap-2">
            {internalEditing ? (
              <>
                <button
                  onClick={() => {
                    setInternalDraft({});
                    setInternalEditing(false);
                  }}
                  className="text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  onClick={saveInternal}
                  disabled={saving || Object.keys(internalDraft).length === 0}
                  className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button
                onClick={() => setInternalEditing(true)}
                className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-xs"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {INTERNAL_FIELDS.map((f) => {
            const v = internalFieldValue(f.key);
            const stale = staleByKey.get(String(f.key));
            if (!internalEditing) {
              return (
                <div key={String(f.key)} className={f.type === "textarea" ? "col-span-full text-sm" : "text-sm"}>
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                    {f.label}
                    <StaleTag stale={stale} />
                  </div>
                  <div className="text-[color:var(--foreground)] whitespace-pre-wrap">{v || "—"}</div>
                </div>
              );
            }
            return (
              <div key={String(f.key)} className={f.type === "textarea" ? "col-span-full text-sm" : "text-sm"}>
                <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                  {f.label}
                  <StaleTag stale={stale} />
                </label>
                {f.type === "textarea" ? (
                  <textarea
                    value={v}
                    onChange={(e) => setInternalField(String(f.key), e.target.value, f.type)}
                    rows={3}
                    className="w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1.5 text-sm leading-relaxed"
                  />
                ) : (
                  <input
                    type={f.type}
                    value={v}
                    onChange={(e) => setInternalField(String(f.key), e.target.value, f.type)}
                    className="w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[color:var(--foreground)] px-2 py-1 text-sm"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
