import { NextResponse } from "next/server";

import {
  listCustomerRows,
  listProjectRows,
  listAllWorkspaces,
  findMatchingProjects,
  findMatchingWorkspace,
  normalizeName,
  type MondayCustomerRow,
  type MondayProjectRow,
} from "@/lib/import/monday-customers";
import { listAccounts, type SfAccount } from "@/lib/integrations/salesforce";
import { listCustomers, slugifyCustomerKey } from "@/lib/customers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export interface ImportCandidate {
  monday: MondayCustomerRow;
  projects: MondayProjectRow[];
  workspace: { id: string; name: string } | null;
  salesforce_candidates: SfAccount[];
  proposed_key: string;
  already_imported: { id: string; key: string } | null;
}

export interface PreviewResponse {
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

// GET /api/dev/import/preview
//
// Pulls every row from the Monday "Customers" board, matches each one against
// the Projects board + the workspace list, and fetches the top Salesforce
// candidates by name. Returns one object per customer ready for the UI to
// render and the user to confirm.
export async function GET() {
  try {
    // Step 1 — fetch the three Monday surfaces concurrently.
    const [customers, projects, workspaces, existingCustomers] = await Promise.all([
      listCustomerRows(),
      listProjectRows(),
      listAllWorkspaces(),
      listCustomers().catch(() => []),
    ]);

    const existingByMondayId = new Map(
      existingCustomers
        .filter((c) => c.monday_item_id)
        .map((c) => [c.monday_item_id!, c])
    );
    const existingByKey = new Map(existingCustomers.map((c) => [c.key, c]));

    // Step 2 — for each Monday customer, do the matching.
    // Salesforce search is sequential per customer to be polite to the rate
    // limiter (78k accounts, plus we only need top-5 prefix search per name).
    // ~250ms per customer keeps the full preview well under the maxDuration
    // budget for any realistic portfolio size.
    const candidates: ImportCandidate[] = [];
    for (const m of customers) {
      const matchedProjects = findMatchingProjects(m, projects);
      const workspace = findMatchingWorkspace(m, workspaces);

      // For Salesforce, use the first significant token of the customer name
      // as the search prefix. Examples:
      //   "Dish - Ecostar"   → "Dish"
      //   "Charleston…"      → "Charleston"
      //   "SSD/SKP"          → "SSD"
      const searchSeed = (m.name.split(/[\s\-/]+/)[0] ?? m.name).slice(0, 30);

      let sfCandidates: SfAccount[] = [];
      try {
        sfCandidates = await listAccounts({ search: searchSeed, limit: 5 });
      } catch (err) {
        console.warn(`[import preview] SF search failed for ${m.name}:`, err);
      }

      // Re-rank SF candidates by name similarity to the actual full Monday name.
      const norm = normalizeName(m.name);
      sfCandidates = sfCandidates
        .map((a) => ({ a, normName: normalizeName(a.Name), exact: normalizeName(a.Name) === norm }))
        .sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0))
        .map((x) => x.a);

      const proposedKey = slugifyCustomerKey(m.name);
      const alreadyByMonday = existingByMondayId.get(m.item_id);
      const alreadyByKey = existingByKey.get(proposedKey);
      const already = alreadyByMonday ?? alreadyByKey ?? null;

      candidates.push({
        monday: m,
        projects: matchedProjects,
        workspace: workspace ?? null,
        salesforce_candidates: sfCandidates,
        proposed_key: proposedKey,
        already_imported: already ? { id: already.id, key: already.key } : null,
      });
    }

    const summary = {
      total: candidates.length,
      with_project_match: candidates.filter((c) => c.projects.length > 0).length,
      total_projects_matched: candidates.reduce((sum, c) => sum + c.projects.length, 0),
      with_workspace_match: candidates.filter((c) => c.workspace).length,
      with_sf_candidates: candidates.filter((c) => c.salesforce_candidates.length > 0).length,
      already_imported: candidates.filter((c) => c.already_imported).length,
    };

    return NextResponse.json({
      candidates,
      summary,
      generated_at: new Date().toISOString(),
    } satisfies PreviewResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
