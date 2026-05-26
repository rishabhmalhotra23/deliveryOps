"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatPeopleList, formatPersonName } from "@/lib/delivery/taxonomy";

// Minimal project shape shared by customer page and delivery page.
export interface ProjectPanelItem {
  monday_item_id: string;
  name: string;
  customer_key?: string;
  customer_display_name?: string;
  fiscal_year?: string | null;
  health?: string | null;
  project_status?: string | null;
  current_phase?: string | null;
  dev_platform?: string | null;
  complexity?: string | null;
  kickoff_date?: string | null;
  go_live_date?: string | null;
  total_effort_days?: number | null;
  ttv_days_text?: string | null;
  delivered_value?: string | null;
  latest_update?: string | null;
  /** FDE roster — accepts either a comma-separated string (the delivery
   *  table format) or a pre-split string[] (the analytics drill-down
   *  format).  Replaces the old `tam` + `dev` props. */
  fde?: string | string[] | null;
  partner?: string | null;
  ae_owner?: string | null;
  group_title?: string | null;
}

interface Update {
  id: string;
  body: string;
  created_at: string;
  author: string;
}

const FY_COLORS: Record<string, string> = {
  active:           "#60a5fa",
  "FY-2026":        "#F2FF70",
  "FY-2025":        "#a78bfa",
  "FY-2024":        "#38bdf8",
  "FY-2023":        "#fb923c",
  account_overview: "#2dd4bf",
  inactive:         "#6b7280",
};

function fmtRelTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function Chip({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded border font-medium"
      style={color ? { background: `${color}18`, color, borderColor: `${color}30` }
        : { background: "var(--glass-bg)", color: "var(--muted-foreground)", borderColor: "var(--glass-border)" }}
    >
      {label}
    </span>
  );
}

export function ProjectDetailPanel({
  project: p,
  onClose,
  showCustomerLink = true,
}: {
  project: ProjectPanelItem;
  onClose: () => void;
  showCustomerLink?: boolean;
}) {
  const [updates, setUpdates] = useState<Update[] | null>(null);
  const [loadingUpdates, setLoadingUpdates] = useState(false);

  useEffect(() => {
    if (!p.monday_item_id) return;
    setLoadingUpdates(true);
    setUpdates(null);
    fetch(`/api/monday/item-updates?item_id=${encodeURIComponent(p.monday_item_id)}`)
      .then((r) => r.json())
      .then((d) => setUpdates((d as { updates?: Update[] }).updates ?? []))
      .catch(() => setUpdates([]))
      .finally(() => setLoadingUpdates(false));
  }, [p.monday_item_id]);

  const cleanName = p.customer_display_name
    ? p.name.replace(new RegExp(`^${escapeRegex(p.customer_display_name)}\\s*[-—]\\s*`), "")
    : p.name;

  const fyColor = FY_COLORS[p.fiscal_year ?? ""] ?? "#6b7280";
  const fyLabel =
    p.fiscal_year === "active" ? "In Flight" :
    p.fiscal_year === "account_overview" ? "Account Overview" :
    p.fiscal_year === "inactive" ? "Inactive" :
    p.fiscal_year ?? null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[520px] z-50 flex flex-col bg-[color:var(--card)] border-l border-[var(--glass-border)] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[color:var(--card)] border-b border-[var(--glass-border)] px-6 py-5 flex items-start gap-4 z-10">
          <div className="min-w-0 flex-1">
            {p.customer_display_name ? (
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
                {p.customer_display_name}
              </div>
            ) : null}
            <h2 className="text-xl font-bold tracking-tight text-[color:var(--foreground)] leading-tight">
              {cleanName}
            </h2>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {fyLabel ? <Chip label={fyLabel} color={fyColor} /> : null}
              {p.dev_platform ? (
                <Chip label={p.dev_platform} color={p.dev_platform === "V2" ? "#818cf8" : "#94a3b8"} />
              ) : null}
              {p.health ? (
                <Chip label={p.health} color={
                  p.health.includes("Risk") ? "#fb923c" :
                  p.health.includes("Track") ? "#34d399" :
                  p.health.includes("Finish") || p.health === "Done" ? "#818cf8" : undefined
                } />
              ) : null}
              {p.project_status ? (
                <Chip label={p.project_status} color={
                  p.project_status === "Live" || p.project_status === "Delivered" ? "#34d399" :
                  p.project_status === "In Progress" ? "#60a5fa" :
                  p.project_status === "On Hold" ? "#fbbf24" : undefined
                } />
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--glass-bg)] text-[color:var(--muted-foreground)] transition-colors"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-6 py-5 space-y-6">
          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: "Kickoff", value: p.kickoff_date },
              { label: "Go-live", value: p.go_live_date },
              { label: "TTV", value: p.ttv_days_text ? `${p.ttv_days_text}d` : null },
              { label: "Effort", value: p.total_effort_days ? `${p.total_effort_days}d` : null },
              { label: "Phase", value: p.current_phase?.replace(/^M\d\s+-\s+/, "") ?? null },
              { label: "Complexity", value: p.complexity },
            ].filter(x => x.value).map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-3">
                <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] mb-0.5">{label}</div>
                <div className="text-sm font-semibold text-[color:var(--foreground)] truncate">{value}</div>
              </div>
            ))}
          </div>

          {/* Timeline bar */}
          {(p.kickoff_date || p.go_live_date) ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-2">Timeline</div>
              <div className="flex items-center gap-3">
                {p.kickoff_date ? (
                  <div className="flex items-center gap-1.5 text-sm">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0" />
                    <span className="text-[color:var(--muted-foreground)]">Kick-off</span>
                    <span className="font-medium text-[color:var(--foreground)]">{p.kickoff_date}</span>
                  </div>
                ) : null}
                {p.kickoff_date && p.go_live_date ? <div className="flex-1 h-px bg-[var(--glass-border)]" /> : null}
                {p.go_live_date ? (
                  <div className="flex items-center gap-1.5 text-sm">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.project_status === "Live" || p.project_status === "Delivered" ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <span className="text-[color:var(--muted-foreground)]">Go-live</span>
                    <span className="font-medium text-[color:var(--foreground)]">{p.go_live_date}</span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Delivery team */}
          {(() => {
            const fdeNames = formatPeopleList(p.fde, { expand: true });
            const hasTeam = !!fdeNames || !!p.partner || !!p.ae_owner;
            if (!hasTeam) return null;
            return (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-2">Delivery team</div>
                <div className="space-y-1.5">
                  {fdeNames ? <Row label="FDE" name={fdeNames} color="#818cf8" /> : null}
                  {p.partner ? <Row label="Partner" name={p.partner} color="#fb923c" /> : null}
                  {p.ae_owner ? <Row label="AE" name={formatPersonName(p.ae_owner)} color="#f472b6" /> : null}
                </div>
              </div>
            );
          })()}

          {/* Delivered value */}
          {p.delivered_value ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-2">Value delivered</div>
              <div className="rounded-xl bg-emerald-500/8 border border-emerald-500/20 p-4 text-sm text-[color:var(--foreground)] leading-relaxed">
                {p.delivered_value}
              </div>
            </div>
          ) : null}

          {/* Monday updates */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-2">
              Updates from Monday
            </div>
            {loadingUpdates ? (
              <div className="space-y-2">
                {[1,2,3].map(i => (
                  <div key={i} className="h-12 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] animate-pulse" />
                ))}
              </div>
            ) : updates === null || updates.length === 0 ? (
              <div className="text-xs text-[color:var(--muted-foreground)] italic py-2">
                {updates === null ? "No updates found." : "No updates yet."}
              </div>
            ) : (
              <div className="space-y-2">
                {updates.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-medium text-[color:var(--foreground)]">{u.author}</span>
                      <span className="text-[10px] text-[color:var(--muted-foreground)]">{fmtRelTime(u.created_at)}</span>
                    </div>
                    <p className="text-xs text-[color:var(--muted-foreground)] leading-relaxed">{u.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {showCustomerLink && p.customer_key ? (
          <div className="sticky bottom-0 bg-[color:var(--card)] border-t border-[var(--glass-border)] px-6 py-4">
            <Link
              href={`/customers/${p.customer_key}`}
              onClick={onClose}
              className="btn-primary w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              Open {p.customer_display_name} page
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}

function Row({ label, name, color }: { label: string; name: string; color: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] w-16 shrink-0">{label}</span>
      <span className="text-[color:var(--foreground)]">{name}</span>
    </div>
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

