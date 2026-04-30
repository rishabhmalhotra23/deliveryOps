"use client";

import { useEffect, useMemo, useState } from "react";

interface SfAccount {
  Id: string;
  Name: string;
  Industry: string | null;
  AnnualRevenue: number | null;
  NumberOfEmployees: number | null;
  BillingCity: string | null;
  BillingCountry: string | null;
  Owner: { Name: string } | null;
}

interface MondayCustomer {
  item_id: string;
  name: string;
  group: string;
  ce_owner: string | null;
  primary_owner: string | null;
  secondary_owner: string | null;
  topic: string | null;
  partner: string | null;
  arr_estimate: string | null;
  employee_count: string | null;
  industry: string | null;
}

interface MondayProject {
  item_id: string;
  name: string;
  group: string;
}

interface ImportCandidate {
  monday: MondayCustomer;
  projects: MondayProject[];
  workspace: { id: string; name: string } | null;
  salesforce_candidates: SfAccount[];
  proposed_key: string;
  already_imported: { id: string; key: string } | null;
}

interface PreviewResponse {
  candidates: ImportCandidate[];
  summary: {
    total: number;
    with_project_match: number;
    total_projects_matched: number;
    with_workspace_match: number;
    with_sf_candidates: number;
    already_imported: number;
  };
  generated_at: string;
}

interface RowSelection {
  include: boolean;
  salesforce_account_id: string | null; // null = "skip SF for this customer"
}

type RowState = Record<string, RowSelection>;

const GROUP_ORDER = [
  "High Risk",
  "Upcoming Renewal",
  "Growth / Focus",
  "Tier 2 - Secondary Priority",
  "Partner Managed",
  "POV",
  "Churned/Dropped",
];

export function ImportClient() {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<RowState>({});
  const [importing, setImporting] = useState(false);
  const [dropSeed, setDropSeed] = useState(true);
  const [importResult, setImportResult] = useState<unknown>(null);
  const [groupFilter, setGroupFilter] = useState<string>("all");

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/dev/import/preview");
      const json = (await res.json()) as PreviewResponse | { error: string };
      if (!res.ok) throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      const preview = json as PreviewResponse;
      setData(preview);
      // Default selections: include everything not already imported, top SF candidate.
      const init: RowState = {};
      for (const c of preview.candidates) {
        init[c.monday.item_id] = {
          include: !c.already_imported,
          salesforce_account_id: c.salesforce_candidates[0]?.Id ?? null,
        };
      }
      setSelections(init);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function runImport() {
    if (!data) return;
    setImporting(true);
    setImportResult(null);
    try {
      const selectedRows = data.candidates.filter((c) => selections[c.monday.item_id]?.include);
      const payload = {
        drop_seed: dropSeed,
        selections: selectedRows.map((c) => ({
          monday_item_id: c.monday.item_id,
          monday_workspace_id: c.workspace?.id ?? null,
          display_name: c.monday.name,
          proposed_key: c.proposed_key,
          salesforce_account_id: selections[c.monday.item_id]?.salesforce_account_id ?? null,
          partner: c.monday.partner,
          ce_owner: c.monday.ce_owner,
          lifecycle_group: c.monday.group,
          slack_channel: c.proposed_key,
        })),
      };
      const res = await fetch("/api/dev/import/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setImportResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const filteredCandidates = useMemo(() => {
    if (!data) return [];
    if (groupFilter === "all") return data.candidates;
    return data.candidates.filter((c) => c.monday.group === groupFilter);
  }, [data, groupFilter]);

  const selectedCount = useMemo(() => {
    return Object.values(selections).filter((s) => s.include).length;
  }, [selections]);

  useEffect(() => {
    loadPreview();
  }, []);

  if (loading || !data) {
    return (
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-6 text-sm text-[color:var(--brand-gray)]">
        {loading ? "Pulling Monday + Salesforce…" : "—"}
        {error ? <pre className="mt-2 text-xs text-red-700 whitespace-pre-wrap">{error}</pre> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="rounded-md border border-[color:var(--brand-metal)] bg-white p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Stat label="Customers" value={String(data.summary.total)} />
        <Stat
          label="With projects"
          value={`${data.summary.with_project_match} (${data.summary.total_projects_matched} total)`}
        />
        <Stat label="Workspace match" value={String(data.summary.with_workspace_match)} />
        <Stat label="SF candidates" value={String(data.summary.with_sf_candidates)} />
        <Stat label="Already imported" value={String(data.summary.already_imported)} />
        <span className="ml-auto text-xs text-[color:var(--brand-gray)]">
          {selectedCount} selected for import
        </span>
      </div>

      {/* Group filter pills */}
      <div className="flex flex-wrap gap-1">
        {["all", ...GROUP_ORDER].map((g) => {
          const count =
            g === "all"
              ? data.candidates.length
              : data.candidates.filter((c) => c.monday.group === g).length;
          if (g !== "all" && count === 0) return null;
          return (
            <button
              key={g}
              onClick={() => setGroupFilter(g)}
              className={`px-3 py-1 rounded-full text-xs font-medium border ${
                groupFilter === g
                  ? "bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] border-[color:var(--brand-night)]"
                  : "border-[color:var(--brand-metal)] text-[color:var(--brand-gray)] hover:border-[color:var(--brand-night)] hover:text-[color:var(--brand-night)]"
              }`}
            >
              {g === "all" ? "All" : g} <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-[color:var(--brand-metal)] bg-white p-3 text-sm">
        <button
          onClick={runImport}
          disabled={importing || selectedCount === 0}
          className="rounded-md bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] px-4 py-1.5 font-medium hover:opacity-90 disabled:opacity-40"
        >
          {importing ? "Importing…" : `Import ${selectedCount} customer${selectedCount === 1 ? "" : "s"}`}
        </button>
        <label className="flex items-center gap-2 text-xs text-[color:var(--brand-gray)]">
          <input
            type="checkbox"
            checked={dropSeed}
            onChange={(e) => setDropSeed(e.target.checked)}
          />
          Drop the seeded &ldquo;Acme&rdquo; placeholder after import
        </label>
        <button
          onClick={loadPreview}
          disabled={loading}
          className="ml-auto rounded-md border border-[color:var(--brand-metal)] px-3 py-1 text-xs hover:border-[color:var(--brand-night)]"
        >
          Refresh from Monday
        </button>
      </div>

      {/* Result */}
      {importResult ? <ImportResult result={importResult as ImportResultShape} /> : null}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-[color:var(--brand-metal)]">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--brand-seasalt)] text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">
            <tr>
              <th className="text-left px-3 py-2 w-8"></th>
              <th className="text-left px-3 py-2">Customer (from Monday)</th>
              <th className="text-left px-3 py-2">Lifecycle</th>
              <th className="text-left px-3 py-2">Owner / Partner</th>
              <th className="text-left px-3 py-2">Projects</th>
              <th className="text-left px-3 py-2">Workspace</th>
              <th className="text-left px-3 py-2">Salesforce match</th>
              <th className="text-left px-3 py-2">Key</th>
            </tr>
          </thead>
          <tbody>
            {filteredCandidates.map((c) => {
              const sel = selections[c.monday.item_id];
              const include = sel?.include ?? false;
              const sfId = sel?.salesforce_account_id ?? null;
              const alreadyImported = !!c.already_imported;
              return (
                <tr
                  key={c.monday.item_id}
                  className={`border-t border-[color:var(--brand-metal)] ${
                    alreadyImported ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={include}
                      onChange={(e) =>
                        setSelections((prev) => ({
                          ...prev,
                          [c.monday.item_id]: {
                            ...prev[c.monday.item_id],
                            include: e.target.checked,
                          },
                        }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{c.monday.name}</div>
                    <div className="text-xs text-[color:var(--brand-gray)]">
                      {c.monday.industry ?? ""}
                      {c.monday.industry && c.monday.arr_estimate ? " · " : ""}
                      {c.monday.arr_estimate ?? ""}
                      {c.monday.employee_count ? ` · ${c.monday.employee_count} emp` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="inline-block rounded px-2 py-0.5 text-xs bg-[color:var(--brand-seasalt)]">
                      {c.monday.group}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {c.monday.ce_owner ? <div>CE: {c.monday.ce_owner}</div> : null}
                    {c.monday.partner ? (
                      <div className="text-[color:var(--brand-gray)]">{c.monday.partner}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {c.projects.length === 0 ? (
                      <span className="text-[color:var(--brand-gray)]">no match</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer">
                          {c.projects.length} project{c.projects.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-1 space-y-0.5 text-[11px]">
                          {c.projects.slice(0, 8).map((p) => (
                            <li key={p.item_id}>
                              {p.name}
                              <span className="text-[color:var(--brand-gray)]"> · {p.group}</span>
                            </li>
                          ))}
                          {c.projects.length > 8 ? (
                            <li className="text-[color:var(--brand-gray)]">
                              … {c.projects.length - 8} more
                            </li>
                          ) : null}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {c.workspace ? (
                      <span>
                        {c.workspace.name}
                        <span className="block text-[color:var(--brand-gray)] tabular-nums">
                          {c.workspace.id}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[color:var(--brand-gray)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {c.salesforce_candidates.length === 0 ? (
                      <span className="text-xs text-[color:var(--brand-gray)]">no candidates</span>
                    ) : (
                      <select
                        value={sfId ?? ""}
                        onChange={(e) =>
                          setSelections((prev) => ({
                            ...prev,
                            [c.monday.item_id]: {
                              ...prev[c.monday.item_id],
                              salesforce_account_id: e.target.value || null,
                            },
                          }))
                        }
                        className="rounded border border-[color:var(--brand-metal)] bg-white px-2 py-1 text-xs max-w-[280px]"
                      >
                        <option value="">— skip Salesforce —</option>
                        {c.salesforce_candidates.map((a) => (
                          <option key={a.Id} value={a.Id}>
                            {a.Name}
                            {a.BillingCountry ? ` · ${a.BillingCountry}` : ""}
                            {a.AnnualRevenue
                              ? ` · $${(a.AnnualRevenue / 1_000_000).toFixed(0)}M`
                              : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <code className="text-xs text-[color:var(--brand-gray)]">
                      {c.proposed_key}
                    </code>
                    {alreadyImported ? (
                      <div className="text-xs text-[color:var(--brand-gray)] mt-0.5">
                        already in DB
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <div className="text-xs uppercase tracking-wider text-[color:var(--brand-gray)]">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

interface ImportResultShape {
  results: Array<{
    monday_item_id: string;
    display_name: string;
    status: "imported" | "updated" | "skipped" | "failed";
    customer_key?: string;
    error?: string;
  }>;
  summary: {
    total: number;
    imported: number;
    failed: number;
    seed_dropped: boolean;
  };
}

function ImportResult({ result }: { result: ImportResultShape }) {
  const failed = result.results.filter((r) => r.status === "failed");
  return (
    <div className="rounded-md border border-[color:var(--brand-night)] bg-[color:var(--brand-yellow)]/30 p-4 text-sm">
      <div className="font-medium mb-1">
        Imported {result.summary.imported} / {result.summary.total} customers
        {result.summary.failed > 0 ? ` · ${result.summary.failed} failed` : ""}
        {result.summary.seed_dropped ? " · Acme seed dropped" : ""}
      </div>
      {failed.length > 0 ? (
        <ul className="text-xs text-red-800 mt-2 space-y-1">
          {failed.map((r) => (
            <li key={r.monday_item_id}>
              <span className="font-medium">{r.display_name}</span>: {r.error}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-[color:var(--brand-gray)] mt-1">
          Open <a className="underline" href="/customers">/customers</a> to see them.
        </div>
      )}
    </div>
  );
}
