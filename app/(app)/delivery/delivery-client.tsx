"use client";

// The merged Delivery workspace. V2 Migration is no longer its own page — it's
// a second section here ("Active work" / "V2 migration") over the same
// `processes` rows, switchable between table and board. Row click no longer
// opens the detail panel (cells edit in place); the panel opens deliberately
// from a row's ⤢ button, mounted either as a 420px sticky split column or an
// 880px centre overlay depending on the toolbar toggle.
// Approved design: 2026-09-03-v2-delivery-redesign.html (CLAUDE-CODE-PROMPT.md).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProcessesOverview, ProcessRow, V2MigrationOverview, V2ProcessRow } from "@/lib/processes/loader";
import { viewForLifecycle } from "@/lib/processes/loader";
import type { Process, ProcessNoteKind } from "@/lib/supabase/types";
import type {
  MigrationStage,
  ProcessHealth,
  ProcessLifecycle,
  ProcessPhase,
  ProcessPlatform,
} from "@/lib/supabase/types";
import { healthLabel, lifecycleLabel, phaseLabel, platformLabel, stageLabel } from "@/lib/delivery/labels";
import { PageHeader } from "@/app/_components/brand";
import { ProcessTable } from "@/app/_components/process-table";
import { ProcessBoard, LANE_SORTS, type LaneSort, type PositionWrite } from "@/app/_components/process-board";
import type { TablePositionWrite } from "@/app/_components/process-table";
import { byPosition } from "@/lib/delivery/reorder";
import { ProcessDetail, type DetailProcess } from "@/app/_components/process-detail";
import { ConfigureDialog } from "@/app/_components/configure-dialog";
import { BulkActionBar, type BulkResult } from "@/app/_components/bulk-action-bar";
import { NewProcessModal } from "./_components/new-process-modal";
import { useViewPrefs, type FilterField } from "@/lib/delivery/prefs";
import { COLDEFS, CARD_FIELDS, type ColKey } from "@/lib/delivery/columns";

type Section = "active" | "v2" | "all";
type ViewMode = "table" | "board";

const FILTER_LABEL: Record<FilterField, string> = {
  stage: "Stage",
  owner: "FDE",
  customer: "Customer",
  health: "Health",
  partner: "Partner",
  platform: "Platform",
  lifecycle: "Lifecycle",
  phase: "Phase",
  tam: "TAM",
};

const ALL_FILTER_FIELDS: FilterField[] = ["stage", "owner", "customer", "health", "partner", "platform", "lifecycle", "phase", "tam"];

function matchesFilters(row: DetailProcess, values: Partial<Record<FilterField, string>>): boolean {
  if (values.stage && row.migration_stage !== values.stage) return false;
  if (values.owner && row.fde_owner !== values.owner) return false;
  if (values.customer && row.customer_display_name !== values.customer) return false;
  if (values.health && row.health !== values.health) return false;
  if (values.partner && row.partner !== values.partner) return false;
  if (values.platform && row.platform !== values.platform) return false;
  if (values.lifecycle && row.lifecycle !== values.lifecycle) return false;
  if (values.phase && row.phase !== values.phase) return false;
  if (values.tam && row.tam_owner !== values.tam) return false;
  return true;
}

function matchesSearch(row: DetailProcess, q: string): boolean {
  if (!q) return true;
  const hay = [row.process_name, row.customer_display_name, row.fde_owner ?? "", row.partner ?? "", row.blockers ?? "", row.notes ?? "", ...row.linear_ticket_ids]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function compareBy(key: ColKey, a: DetailProcess, b: DetailProcess): number {
  switch (key) {
    case "customer":
      return a.customer_display_name.localeCompare(b.customer_display_name);
    case "stage":
      return a.migration_stage.localeCompare(b.migration_stage);
    case "lifecycle":
      return a.lifecycle.localeCompare(b.lifecycle);
    case "phase":
      return (a.phase ?? "").localeCompare(b.phase ?? "");
    case "owner":
      return (a.fde_owner ?? "").localeCompare(b.fde_owner ?? "");
    case "tam":
      return (a.tam_owner ?? "").localeCompare(b.tam_owner ?? "");
    case "partner":
      return (a.partner ?? "").localeCompare(b.partner ?? "");
    case "health":
      return (a.health ?? "").localeCompare(b.health ?? "");
    case "platform":
      return a.platform.localeCompare(b.platform);
    case "pct":
      return (a.completion_pct ?? -1) - (b.completion_pct ?? -1);
    case "arr":
      return (a.arr ?? -1) - (b.arr ?? -1);
    case "effort":
      return (a.total_effort_hours ?? -1) - (b.total_effort_hours ?? -1);
    case "kickoff":
      return (a.kickoff_date ?? "").localeCompare(b.kickoff_date ?? "");
    case "golive":
      return (a.go_live_date ?? "").localeCompare(b.go_live_date ?? "");
    case "tickets":
      return a.linear_ticket_ids.length - b.linear_ticket_ids.length;
    case "stale":
      return a.updated_at.localeCompare(b.updated_at);
    default:
      return 0;
  }
}

function optionsForField(field: FilterField, section: Section, rows: DetailProcess[], processesOverview: ProcessesOverview, v2Overview: V2MigrationOverview): string[] {
  const facets = section === "v2" ? v2Overview.facets : processesOverview.facets;
  switch (field) {
    case "customer":
      return facets.customers;
    case "owner":
      return facets.fdeOwners;
    case "tam":
      return facets.tamOwners;
    case "partner":
      return facets.partners;
    case "stage":
      return Array.from(new Set(rows.map((r) => r.migration_stage))).sort();
    case "health":
      return Array.from(new Set(rows.map((r) => r.health).filter((v): v is NonNullable<typeof v> => !!v))).sort();
    case "lifecycle":
      return Array.from(new Set(rows.map((r) => r.lifecycle))).sort();
    case "phase":
      return Array.from(new Set(rows.map((r) => r.phase).filter((v): v is NonNullable<typeof v> => !!v))).sort();
    case "platform":
      return Array.from(new Set(rows.map((r) => r.platform))).sort();
    default:
      return [];
  }
}

// Filter chips, the dropdowns and the active-filter pills all read through
// the shared label maps — they used to de-underscore the raw key, so the same
// value said "On track" in a table chip and "on track" in its own filter.
function optionLabel(field: FilterField, value: string): string {
  switch (field) {
    case "stage":
      return stageLabel(value as MigrationStage);
    case "platform":
      return platformLabel(value as ProcessPlatform);
    case "health":
      return healthLabel(value as ProcessHealth);
    case "lifecycle":
      return lifecycleLabel(value as ProcessLifecycle);
    case "phase":
      return phaseLabel(value as ProcessPhase);
    default:
      return value;
  }
}

interface DeliveryClientProps {
  processesOverview: ProcessesOverview;
  v2Overview: V2MigrationOverview;
}

const byTablePosition = byPosition<DetailProcess>((r) => r.table_position);

export function DeliveryClient({ processesOverview, v2Overview }: DeliveryClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialSection = ((): Section => {
    const q = searchParams.get("section");
    return q === "v2" || q === "all" ? q : "active";
  })();
  const [section, setSection] = useState<Section>(initialSection);
  const [viewBySection, setViewBySection] = useState<Record<Section, ViewMode>>({ active: "board", v2: "table", all: "table" });
  const [prefs, setPrefs] = useViewPrefs();

  const [allRows, setAllRows] = useState<ProcessRow[]>(processesOverview.all);
  const [v2Rows, setV2Rows] = useState<V2ProcessRow[]>(v2Overview.rows);
  useEffect(() => setAllRows(processesOverview.all), [processesOverview]);
  useEffect(() => setV2Rows(v2Overview.rows), [v2Overview]);

  const [search, setSearch] = useState("");
  // ?owner=<display name> arrives from Configure -> Roster, where marking
  // someone as left links here to hand over the processes they still own.
  // Matches on the display name because that's what the owner filter compares
  // (matchesFilters reads row.fde_owner, the text mirror) — no id plumbing.
  const [filterValues, setFilterValues] = useState<Partial<Record<FilterField, string>>>(() => {
    const owner = searchParams.get("owner");
    return owner ? { owner } : {};
  });
  const [openPopover, setOpenPopover] = useState<FilterField | "add" | "fields" | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [configureOpen, setConfigureOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createSeed, setCreateSeed] = useState<Partial<Process> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ ids: string[] } | null>(null);

  const backdropPressRef = useRef(false);
  // /processes/<id> redirects here with ?open=<id>; the permalink and the row
  // menu's "Copy link" both point at it.
  const [openId, setOpenIdState] = useState<string | null>(searchParams.get("open"));
  const setOpenId = setOpenIdState;
  const [laneSort, setLaneSort] = useState<LaneSort>("manual");
  const [sortKey, setSortKey] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Lock the page behind the overlay: without this the wheel scrolled the
  // table underneath instead of the panel's own content.
  useEffect(() => {
    if (!openId || prefs.pattern !== "overlay") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [openId, prefs.pattern]);

  // Every field in the panel commits on blur, and React does not fire blur on
  // unmount — so closing while a field was focused silently threw the edit
  // away. Blurring first lets the pending commit run.
  const closeDetail = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    setOpenId(null);
  }, []);

  // Escape dismisses the centre overlay only. In split mode the panel is part
  // of the layout, not a modal, so Escape deliberately leaves it open.
  useEffect(() => {
    if (!openId || prefs.pattern !== "overlay") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeDetail();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId, prefs.pattern, closeDetail]);

  // One document-level handler dismisses any open toolbar popover on outside
  // click or Escape.
  //
  // The exemption for a popover's own subtree is a `closest()` test, NOT
  // stopPropagation: React's App Router attaches its delegated listeners to
  // `document` too, and the DOM stop-propagation flag is only consulted
  // between nodes in the path — it never suppresses a sibling listener on the
  // same node. With stopPropagation this handler still ran and tore the menu
  // down on mousedown, so the click never landed on the option and no filter
  // could ever be applied.
  useEffect(() => {
    if (!openPopover) return;
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-dops-popover]")) return;
      setOpenPopover(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenPopover(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPopover]);

  const view = viewBySection[section];
  // "Active work" now actually means active work. It used to be handed every
  // non-deleted process — including live, cancelled, churned and retired —
  // so the tab badge (view-filtered) and the toolbar's "n of m" (unfiltered)
  // disagreed permanently, and in board view laneFor() returned null for all
  // of those rows so they were counted but rendered nowhere. Everything is
  // still reachable, via the All processes section.
  const activeRows = useMemo(() => allRows.filter((r) => viewForLifecycle(r.lifecycle) === "active"), [allRows]);
  const baseRows: DetailProcess[] = section === "v2" ? v2Rows : section === "all" ? allRows : activeRows;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseRows.filter((r) => matchesSearch(r, q) && matchesFilters(r, filterValues));
  }, [baseRows, search, filterValues]);

  // No column sort => the hand-dragged order, which is also the only state
  // where the table's drag grip is live. `byPosition` puts never-dragged rows
  // after positioned ones, keeping the previous stalest-first default intact
  // until somebody actually drags something.
  const sorted = useMemo(() => {
    if (!sortKey) return [...filtered].sort(byTablePosition);
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => sign * compareBy(sortKey, a, b));
  }, [filtered, sortKey, sortDir]);

  // Keep the selection to rows the user can actually see: a bulk action must
  // never silently hit a row hidden by the current filter or search.
  useEffect(() => {
    setSelected((cur) => {
      if (cur.size === 0) return cur;
      const visible = new Set(sorted.map((r) => r.id));
      const next = new Set(Array.from(cur).filter((id) => visible.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [sorted]);

  // Only CARD_FIELDS can render as a board chip. Promoting e.g. Lifecycle
  // used to push it into cardFields too, where CardChip fell through to its
  // default branch and printed the literal word "Lifecycle" on every card —
  // and the Fields menu only lists CARD_FIELDS, so there was no way to turn
  // it back off without wiping saved preferences.
  function promoteToColumn(col: ColKey) {
    setPrefs((cur) => ({
      ...cur,
      cols: cur.cols.includes(col) ? cur.cols : [...cur.cols, col],
      cardFields:
        CARD_FIELDS.includes(col) && !cur.cardFields.includes(col) ? [...cur.cardFields, col] : cur.cardFields,
    }));
  }

  function onSort(key: ColKey) {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortKey(null);
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // `router.refresh()` re-runs both loaders (two full-table reads), so it
  // fires once per user action — not once per updated row, which turned a
  // 40-row bulk patch into 40 refetches of the whole page payload.
  function applyUpdate(updated: Process, opts: { refresh?: boolean } = {}) {
    setAllRows((cur) => cur.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setV2Rows((cur) => cur.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    if (opts.refresh !== false) router.refresh();
  }

  // Throws on failure so callers can revert their own draft state. A
  // non-JSON body means something upstream intercepted the request (usually
  // an expired session), which `res.json()` would otherwise turn into an
  // opaque "Unexpected token '<'".
  async function saveField(id: string, patch: Partial<Process>): Promise<Process> {
    const res = await fetch(`/api/processes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
      const message =
        res.status === 401 || res.status === 403
          ? "Your session expired — refresh the page and log in again."
          : `Unexpected response (HTTP ${res.status}) — try refreshing the page.`;
      setActionError(message);
      throw new Error(message);
    }
    const json = await res.json();
    if (!res.ok) {
      const message = (json as { error?: string }).error || `HTTP ${res.status}`;
      setActionError(message);
      throw new Error(message);
    }
    setActionError(null);
    // No router.refresh() here: the PATCH response already carries the full
    // row (including server-derived lifecycle/phase), and refreshing per edit
    // meant two quick edits raced — the first refresh's snapshot landed after
    // the second edit and visibly reverted it.
    applyUpdate(json.process as Process, { refresh: false });
    return json.process as Process;
  }

  function removeRows(ids: string[]) {
    setAllRows((cur) => cur.filter((r) => !ids.includes(r.id)));
    setV2Rows((cur) => cur.filter((r) => !ids.includes(r.id)));
    setSelected((cur) => {
      const next = new Set(cur);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (openId && ids.includes(openId)) setOpenId(null);
    router.refresh();
  }

  // The bulk endpoint answers `{error}` with no updated/failed arrays on 400
  // (over the id cap) and 500, so the status has to be checked before the
  // shape is trusted.
  async function bulkRequest(body: Record<string, unknown>): Promise<BulkResult> {
    const res = await fetch("/api/processes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<BulkResult> & { error?: string };
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return { updated: json.updated ?? [], failed: json.failed ?? [] };
  }

  async function bulkPatch(ids: string[], patch: Partial<Process>): Promise<BulkResult> {
    const result = await bulkRequest({ ids, patch });
    for (const p of result.updated) applyUpdate(p, { refresh: false });
    router.refresh();
    return result;
  }

  // Only the rows the server actually archived are removed — on a partial
  // failure the rest stay put rather than vanishing and then reappearing on
  // the next refresh, which reads as data loss.
  async function bulkArchive(ids: string[]): Promise<BulkResult> {
    const result = await bulkRequest({ ids, action: "delete" });
    const archived = result.updated.map((p) => p.id);
    removeRows(archived);
    // The copy promised this was undoable; POST .../restore already exists,
    // so offer it for as long as the toast is up rather than leaving SQL as
    // the only way back.
    if (archived.length > 0) setUndo({ ids: archived });
    return result;
  }

  async function restoreProcesses(ids: string[]) {
    setUndo(null);
    const results = await Promise.all(
      ids.map((id) => fetch(`/api/processes/${id}/restore`, { method: "POST" }).then((r) => r.ok))
    );
    const failed = results.filter((ok) => !ok).length;
    if (failed > 0) setActionError(`${failed} process${failed > 1 ? "es" : ""} could not be restored.`);
    router.refresh();
  }

  // Manual reordering: one value per row, so it can't ride the single-patch
  // bulk endpoint. Applied optimistically then reconciled, and deliberately
  // without a router.refresh() — position is a view preference, and a refresh
  // per drag made two quick drags race each other visibly.
  //
  // `field` picks which order is being written: board lanes use
  // board_position, the table uses table_position. They're separate columns
  // on purpose (see lib/delivery/reorder.ts) — board positions are numbered
  // per lane, so one column can't express both orders.
  async function commitPositions(
    field: "board_position" | "table_position",
    writes: { id: string; position: number }[]
  ): Promise<void> {
    const optimistic = new Map(writes.map((w) => [w.id, w.position]));
    const apply = (list: DetailProcess[]) =>
      list.map((r) => (optimistic.has(r.id) ? { ...r, [field]: optimistic.get(r.id)! } : r));
    setAllRows((cur) => apply(cur) as ProcessRow[]);
    setV2Rows((cur) => apply(cur) as V2ProcessRow[]);

    const res = await fetch("/api/processes/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field,
        positions: writes.map((w) => ({ id: w.id, position: w.position })),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<BulkResult> & { error?: string };
    if (!res.ok) {
      setActionError(json.error || `Could not save the new order (HTTP ${res.status}).`);
      router.refresh();
      return;
    }
    for (const p of json.updated ?? []) applyUpdate(p, { refresh: false });
    if ((json.failed ?? []).length > 0) {
      setActionError(`${json.failed!.length} row${json.failed!.length > 1 ? "s" : ""} could not be reordered.`);
      router.refresh();
    }
  }

  const reorderProcesses = (writes: PositionWrite[]) =>
    commitPositions(
      "board_position",
      writes.map((w) => ({ id: w.id, position: w.board_position }))
    );

  const reorderRows = (writes: TablePositionWrite[]) =>
    commitPositions(
      "table_position",
      writes.map((w) => ({ id: w.id, position: w.table_position }))
    );

  async function bulkNote(ids: string[], body: string, kind: ProcessNoteKind): Promise<BulkResult> {
    const failed: { id: string; error: string }[] = [];
    const updated: Process[] = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/processes/${id}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body, kind }),
          });
          if (!res.ok) {
            const json = (await res.json().catch(() => ({}))) as { error?: string };
            failed.push({ id, error: json.error || `HTTP ${res.status}` });
          }
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : String(err) });
        }
      })
    );
    // A blocker note mirrors into processes.blockers server-side, so the row's
    // ⚑ indicator only appears once the page data is refetched.
    router.refresh();
    return { updated, failed };
  }

  function handleCreated(process: Process) {
    setCreating(false);
    setCreateSeed(null);
    // Only `allRows` gets the optimistic insert: a new process is always
    // created with migration_stage 'not_required' (see buildCreateProcessRow),
    // which isV2Relevant filters out of the V2 lens by definition.
    const asRow = { ...process, customer_display_name: process.account, open_suggestion_count: 0, needs_classification: false };
    setAllRows((cur) => [asRow, ...cur]);
    router.refresh();
  }

  // The split panel used to swap the table down to three columns
  // (NARROW_COLS), which hid most of the record you were working on. It now
  // keeps your chosen columns and just switches to the narrow *width*
  // variant — the table already owns a horizontal scrollport, so nothing is
  // lost, it's just tighter.
  const visibleCols = prefs.cols;
  const narrow = openId != null && prefs.pattern === "split";

  const openProcess = openId ? sorted.find((r) => r.id === openId) ?? baseRows.find((r) => r.id === openId) ?? null : null;

  const columnCountLabel = view === "board" ? "Card fields" : `${prefs.cols.length} columns`;

  // An empty list means two different things — nothing here yet, or nothing
  // left after filtering — and the copy used to claim the second either way.
  const hasNarrowing = search.trim().length > 0 || Object.keys(filterValues).length > 0;
  function clearNarrowing() {
    setSearch("");
    setFilterValues({});
  }
  const emptyCopy: Record<Section, { title: string; hint: string }> = {
    active: {
      title: "Nothing in flight right now",
      hint: "Delivered and closed work lives under All processes.",
    },
    v2: {
      title: "No processes with V2 migration activity",
      hint: "A process appears here once it has a migration stage, a linked ticket or a parity date.",
    },
    all: {
      title: "No processes yet",
      hint: "Create the first one with New process.",
    },
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Delivery"
        title="Every process, every customer, every stage."
        subtitle={`${processesOverview.counts.total} processes, native to DeliveryOps — Active work and V2 migration are the same records, two lenses.`}
        actions={
          <button type="button" onClick={() => setCreating(true)} className="btn-primary rounded-full px-4 py-2 text-sm font-semibold">
            New process
          </button>
        }
      />

      {/* Section tabs */}
      <div className="flex items-center gap-4 border-b" style={{ borderColor: "var(--glass-border)" }}>
        {(
          [
            { key: "active" as Section, label: "Active work", count: activeRows.length },
            { key: "v2" as Section, label: "V2 migration", count: v2Rows.length },
            { key: "all" as Section, label: "All processes", count: allRows.length },
          ]
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setSection(s.key);
              setOpenPopover(null);
              setSelected(new Set());
              setOpenId(null);
              router.replace(s.key === "active" ? "/delivery" : `/delivery?section=${s.key}`);
            }}
            className="dops-tab-underline pb-2 text-sm tracking-tight flex items-center gap-1.5"
            style={{
              color: section === s.key ? "var(--foreground)" : "var(--muted-foreground)",
              fontWeight: section === s.key ? 600 : 400,
              borderBottom: section === s.key ? "2px solid var(--yellow-ink)" : "2px solid transparent",
            }}
          >
            {s.label}
            <span className="font-mono text-[11px] opacity-70">{s.count}</span>
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)] pb-2">
          {section === "v2"
            ? "same records, migration lens"
            : section === "all"
              ? "every process, including delivered and closed"
              : "in flight now — delivered and closed live under All processes"}
        </span>
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border p-2.5 flex flex-wrap items-center gap-2" style={{ borderColor: "var(--glass-border)", background: "var(--surface-1, var(--card))" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search processes…"
          className="dops-input px-3 py-1.5 text-sm w-56"
          style={{ borderColor: "var(--glass-border)" }}
        />

        {prefs.filterKeys.map((key) => (
          <FilterChip
            key={key}
            fieldKey={key}
            value={filterValues[key] ?? null}
            open={openPopover === key}
            onToggleOpen={() => setOpenPopover((cur) => (cur === key ? null : key))}
            options={optionsForField(key, section, baseRows, processesOverview, v2Overview)}
            onPick={(v) => {
              setFilterValues((cur) => ({ ...cur, [key]: v ?? undefined }));
              setOpenPopover(null);
            }}
            onRemove={() => {
              setPrefs((cur) => ({ ...cur, filterKeys: cur.filterKeys.filter((k) => k !== key) }));
              setFilterValues((cur) => {
                const next = { ...cur };
                delete next[key];
                return next;
              });
            }}
          />
        ))}

        <div className="relative" data-dops-popover>
          <button
            type="button"
            onClick={() => setOpenPopover((cur) => (cur === "add" ? null : "add"))}
            className="rounded-md border border-dashed px-2.5 py-1.5 text-[12.5px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            style={{ borderColor: "var(--brand-metal-line)" }}
          >
            + Filter
          </button>
          {openPopover === "add" ? (
            <div
              className="dops-rise-in absolute z-30 mt-1 w-40 rounded-md border shadow-lg py-1"
              style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }}
            >
              {ALL_FILTER_FIELDS.filter((f) => !prefs.filterKeys.includes(f)).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setPrefs((cur) => ({ ...cur, filterKeys: [...cur.filterKeys, f] }));
                    setOpenPopover(f);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[var(--glass-bg)] text-[color:var(--foreground)]"
                >
                  {FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="inline-flex shrink-0 rounded-full border p-0.5" style={{ borderColor: "var(--glass-border)" }}>
            <button
              type="button"
              onClick={() => setViewBySection((cur) => ({ ...cur, [section]: "table" }))}
              className="px-2.5 py-1 rounded-full text-[11.5px]"
              style={view === "table" ? { background: "var(--yellow-soft)" } : undefined}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewBySection((cur) => ({ ...cur, [section]: "board" }))}
              className="px-2.5 py-1 rounded-full text-[11.5px]"
              style={view === "board" ? { background: "var(--yellow-soft)" } : undefined}
            >
              Board
            </button>
          </div>

          {/* Board view has no column headers, so lane order needs its own
              control — the table's header sort has no equivalent here. */}
          {view === "board" ? (
            <label className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--muted-foreground)] shrink-0">
              Sort
              <select
                value={laneSort}
                onChange={(e) => setLaneSort(e.target.value as LaneSort)}
                className="dops-input px-2 py-1 text-[11.5px]"
                aria-label="Order cards within each lane"
              >
                {LANE_SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* Labelled, not a bare gear: the roster lives in here and an
              unlabelled icon gave no clue where to edit people or colours. */}
          <button
            type="button"
            onClick={() => setConfigureOpen(true)}
            title="Configure stages, roster and colours"
            className="dops-press rounded-md border px-2.5 py-1.5 text-[12.5px] flex items-center gap-1.5 text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            style={{ borderColor: "var(--brand-metal-line)" }}
          >
            <span aria-hidden="true">⚙</span>
            Configure
          </button>

          <div className="relative" data-dops-popover>
            <button
              type="button"
              onClick={() => setOpenPopover((cur) => (cur === "fields" ? null : "fields"))}
              className="rounded-md border px-2.5 py-1.5 text-[12.5px] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
              style={{ borderColor: "var(--brand-metal-line)" }}
            >
              {columnCountLabel}
            </button>
            {openPopover === "fields" ? (
              <FieldsMenu
                view={view}
                cols={prefs.cols}
                cardFields={prefs.cardFields}
                onToggle={(key) => {
                  if (view === "table") {
                    setPrefs((cur) => ({
                      ...cur,
                      cols: cur.cols.includes(key) ? cur.cols.filter((c) => c !== key) : [...cur.cols, key],
                    }));
                  } else {
                    setPrefs((cur) => ({
                      ...cur,
                      cardFields: cur.cardFields.includes(key) ? cur.cardFields.filter((c) => c !== key) : [...cur.cardFields, key],
                    }));
                  }
                }}
                onResetWidths={() => setPrefs((cur) => ({ ...cur, colW: {} }))}
                hasCustomWidths={Object.keys(prefs.colW).length > 0}
              />
            ) : null}
          </div>

          <span className="text-[11.5px] font-mono text-[color:var(--muted-foreground)]">
            {sorted.length} of {baseRows.length}
          </span>

          <div className="w-px h-5" style={{ background: "var(--glass-border)" }} />

          <div className="inline-flex shrink-0 rounded-full border p-0.5" style={{ borderColor: "var(--glass-border)" }}>
            <button
              type="button"
              onClick={() => setPrefs((cur) => ({ ...cur, pattern: "split" }))}
              className="px-2.5 py-1 rounded-full text-[11.5px]"
              style={prefs.pattern === "split" ? { background: "var(--yellow-soft)" } : undefined}
            >
              Split panel
            </button>
            <button
              type="button"
              onClick={() => setPrefs((cur) => ({ ...cur, pattern: "overlay" }))}
              className="px-2.5 py-1 rounded-full text-[11.5px]"
              style={prefs.pattern === "overlay" ? { background: "var(--yellow-soft)" } : undefined}
            >
              Overlay
            </button>
          </div>
        </div>
      </div>

      {Object.keys(filterValues).length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.entries(filterValues) as [FilterField, string][]).map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border"
              style={{ background: "var(--yellow-soft)", borderColor: "var(--yellow-line)" }}
            >
              {FILTER_LABEL[k]} · {optionLabel(k, v)}
              <button
                type="button"
                onClick={() =>
                  setFilterValues((cur) => {
                    const next = { ...cur };
                    delete next[k];
                    return next;
                  })
                }
                className="opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" onClick={() => setFilterValues({})} className="text-[11px] underline text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]">
            Clear all
          </button>
        </div>
      ) : null}

      {/* Body. The list track is minmax(0,1fr), not minmax(560px,1fr): the
          table owns its own horizontal scrollport, so a floor wider than the
          viewport would blow the grid out and scroll the whole page sideways
          instead of scrolling the table. */}
      <div
        className={openId && prefs.pattern === "split" ? "grid gap-3 items-start" : ""}
        style={openId && prefs.pattern === "split" ? { gridTemplateColumns: "minmax(0,1fr) minmax(320px,420px)" } : undefined}
      >
        <div className="min-w-0">
          {view === "table" ? (
            <ProcessTable
              rows={sorted}
              cols={visibleCols}
              colW={prefs.colW}
              onColWChange={(key, px) => setPrefs((cur) => ({ ...cur, colW: { ...cur.colW, [key]: px } }))}
              onReorderCol={(from, to) =>
                setPrefs((cur) => {
                  // Insert *after* the target when dragging rightwards.
                  // Always inserting before meant no gesture could ever move
                  // a column to the last position.
                  const fromIdx = cur.cols.indexOf(from);
                  const toIdx = cur.cols.indexOf(to);
                  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return cur;
                  const next = cur.cols.filter((c) => c !== from);
                  const target = next.indexOf(to);
                  next.splice(fromIdx < toIdx ? target + 1 : target, 0, from);
                  return { ...cur, cols: next };
                })
              }
              narrow={narrow}
              selected={selected}
              onSelectionChange={setSelected}
              openId={openId}
              onOpenDetail={setOpenId}
              customerOptions={section === "v2" ? v2Overview.facets.customerOptions : processesOverview.facets.customerOptions}
              onReorderRows={reorderRows}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              colorMap={prefs.colorMap}
              onSave={saveField}
              onArchive={(id) => void bulkArchive([id])}
              onRestore={() => {}}
              showRestore={false}
              emptyTitle={hasNarrowing ? "No processes match these filters" : emptyCopy[section].title}
              emptyHint={hasNarrowing ? "Try clearing a filter or widening your search." : emptyCopy[section].hint}
              onClearFilters={hasNarrowing ? clearNarrowing : undefined}
            />
          ) : (
            <ProcessBoard
              mode={section === "v2" ? "v2" : "active"}
              laneSort={laneSort}
              rows={sorted}
              cardFields={prefs.cardFields}
              colorMap={prefs.colorMap}
              onSave={saveField}
              onReorder={reorderProcesses}
              onOpenDetail={setOpenId}
              onCreateInLane={(seed) => {
                setCreateSeed(seed);
                setCreating(true);
              }}
            />
          )}
        </div>

        {openId && prefs.pattern === "split" && openProcess ? (
          // flex column + overflow hidden so ProcessDetail's own `flex-1
          // overflow-y-auto` body gets a definite height to scroll inside,
          // instead of spilling past maxHeight.
          <div
            className="dops-panel-in rounded-xl border sticky self-start flex flex-col min-h-0 overflow-hidden"
            style={{
              top: 16,
              height: "calc(100vh - 32px)",
              borderColor: "var(--brand-metal-line)",
              background: "var(--surface-1, var(--card))",
            }}
          >
            <ProcessDetail
              process={openProcess}
              list={sorted}
              onSelectId={setOpenId}
              customerOptions={section === "v2" ? v2Overview.facets.customerOptions : processesOverview.facets.customerOptions}
              onUpdated={applyUpdate}
              onArchived={(id) => removeRows([id])}
              onDataChanged={() => router.refresh()}
              onClose={closeDetail}
              onAddColumn={promoteToColumn}
            />
          </div>
        ) : null}
      </div>

      {openId && prefs.pattern === "overlay" && openProcess ? (
        // Flex centring, not `grid place-items`: a single auto-sized grid
        // track sizes from the child's content, so a percentage-width child
        // collapses instead of centring at its intended 880px.
        <div
          className="fixed inset-0 z-40 bg-black/50 flex justify-center items-start p-6 sm:p-10 overflow-hidden"
          // Only a press that both starts and ends on the backdrop closes it.
          // A plain onClick fired when a text selection that began inside the
          // panel was released outside it, closing mid-edit.
          onMouseDown={(e) => {
            backdropPressRef.current = e.target === e.currentTarget;
          }}
          onMouseUp={(e) => {
            if (backdropPressRef.current && e.target === e.currentTarget) closeDetail();
            backdropPressRef.current = false;
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${openProcess.process_name} — process detail`}
            className="dops-rise-in rounded-xl border shadow-2xl flex flex-col min-h-0 overflow-hidden"
            style={{
              width: "min(880px, 100%)",
              borderColor: "var(--brand-metal-line)",
              background: "var(--surface-1, var(--card))",
              // A definite height (not just max-height) is what lets the
              // panel's inner flex child scroll instead of overflowing.
              height: "min(880px, 100%)",
              maxHeight: "100%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ProcessDetail
              process={openProcess}
              list={sorted}
              onSelectId={setOpenId}
              customerOptions={section === "v2" ? v2Overview.facets.customerOptions : processesOverview.facets.customerOptions}
              onUpdated={applyUpdate}
              onArchived={(id) => removeRows([id])}
              onDataChanged={() => router.refresh()}
              onClose={closeDetail}
              onAddColumn={promoteToColumn}
            />
          </div>
        </div>
      ) : null}

      {undo ? (
        <div
          className="dops-rise-in-centred fixed left-1/2 bottom-6 z-50 -translate-x-1/2 rounded-full border px-4 py-2 text-[12px] shadow-lg flex items-center gap-3"
          style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--brand-metal-line)" }}
        >
          Archived {undo.ids.length} process{undo.ids.length > 1 ? "es" : ""}.
          <button
            type="button"
            onClick={() => void restoreProcesses(undo.ids)}
            className="dops-press font-semibold underline"
            style={{ color: "var(--yellow-ink)" }}
          >
            Undo
          </button>
          <button type="button" onClick={() => setUndo(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
            ×
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div
          className={`dops-rise-in-centred fixed left-1/2 z-50 -translate-x-1/2 rounded-full border px-4 py-2 text-[12px] shadow-lg flex items-center gap-3 ${
            selected.size > 0 ? "bottom-32" : "bottom-6"
          }`}
          style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--status-bad)", color: "var(--status-bad)" }}
        >
          {actionError}
          <button type="button" onClick={() => setActionError(null)} className="opacity-70 hover:opacity-100">
            ×
          </button>
        </div>
      ) : null}

      <BulkActionBar
        selectedIds={Array.from(selected)}
        onClearSelection={() => setSelected(new Set())}
        onBulkPatch={bulkPatch}
        onBulkArchive={bulkArchive}
        onBulkNote={bulkNote}
      />

      {configureOpen ? (
        <ConfigureDialog colorMap={prefs.colorMap} onColorMapChange={(next) => setPrefs((cur) => ({ ...cur, colorMap: next }))} onClose={() => setConfigureOpen(false)} />
      ) : null}

      {creating ? (
        <NewProcessModal
          customerOptions={processesOverview.facets.customerOptions}
          seedLifecycle={createSeed?.lifecycle ?? undefined}
          onClose={() => {
            setCreating(false);
            setCreateSeed(null);
          }}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}

function FilterChip({
  fieldKey,
  value,
  open,
  onToggleOpen,
  options,
  onPick,
  onRemove,
}: {
  fieldKey: FilterField;
  value: string | null;
  open: boolean;
  onToggleOpen: () => void;
  options: string[];
  onPick: (v: string | null) => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative" data-dops-popover>
      <div
        className="flex items-center rounded-md border text-[12.5px] text-[color:var(--foreground)]"
        style={{ borderColor: value ? "var(--yellow-line)" : "var(--brand-metal-line)" }}
      >
        <button type="button" onClick={onToggleOpen} className="flex items-center gap-1.5 pl-2.5 py-1.5">
          {FILTER_LABEL[fieldKey]} · {value ? optionLabel(fieldKey, value) : "any"}
        </button>
        {/* A sibling button, not a span inside the trigger — nested
            interactive elements aren't focusable, so this filter could only
            be removed with a mouse. */}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${FILTER_LABEL[fieldKey]} filter`}
          className="px-2 py-1.5 opacity-50 hover:opacity-100"
        >
          ×
        </button>
      </div>
      {open ? (
        <div
          className="dops-rise-in absolute z-30 mt-1 w-52 max-h-64 overflow-auto rounded-md border shadow-lg py-1"
          style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }}
        >
          <button type="button" onClick={() => onPick(null)} className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[var(--glass-bg)] text-[color:var(--muted-foreground)]">
            any
          </button>
          {options.map((o) => (
            <button key={o} type="button" onClick={() => onPick(o)} className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[var(--glass-bg)] text-[color:var(--foreground)] truncate">
              {optionLabel(fieldKey, o)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldsMenu({
  view,
  cols,
  cardFields,
  onToggle,
  onResetWidths,
  hasCustomWidths,
}: {
  view: ViewMode;
  cols: ColKey[];
  cardFields: ColKey[];
  onToggle: (key: ColKey) => void;
  onResetWidths: () => void;
  hasCustomWidths: boolean;
}) {
  const active = view === "table" ? cols : cardFields;
  const universe = view === "table" ? COLDEFS : COLDEFS.filter((c) => CARD_FIELDS.includes(c.key));
  return (
    <div
      className="dops-rise-in absolute right-0 z-30 mt-1 w-52 rounded-md border shadow-lg py-1.5"
      style={{ background: "var(--surface-3, var(--card))", borderColor: "var(--glass-border)" }}
    >
      <div className="px-3 py-1 text-[10.5px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {view === "table" ? "Show as columns" : "Show on cards"}
      </div>

      <div className="max-h-64 overflow-auto">
        {universe.map((def) => (
          <button key={def.key} type="button" onClick={() => onToggle(def.key)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-[var(--glass-bg)] text-[color:var(--foreground)]">
            <span
              className="w-[13px] h-[13px] rounded-[3.5px] border flex items-center justify-center shrink-0"
              style={{ borderColor: "var(--glass-border)", background: active.includes(def.key) ? "var(--brand-yellow)" : "transparent" }}
            >
              {active.includes(def.key) ? <span style={{ color: "#171717", fontSize: 9 }}>✓</span> : null}
            </span>
            {def.label}
          </button>
        ))}
      </div>
      {view === "table" && hasCustomWidths ? (
        <button type="button" onClick={onResetWidths} className="w-full text-left px-3 py-1.5 text-[11.5px] border-t text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]" style={{ borderColor: "var(--glass-border)" }}>
          Reset column widths
        </button>
      ) : null}
    </div>
  );
}
