import { NextResponse } from "next/server";

import {
  upsertCustomer,
  deleteCustomer,
  slugifyCustomerKey,
  type CreateCustomerInput,
} from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ImportSelection {
  monday_item_id: string;
  monday_workspace_id?: string | null;
  display_name: string;
  proposed_key?: string;
  salesforce_account_id?: string | null;
  partner?: string | null;
  ce_owner?: string | null;
  lifecycle_group?: string | null;
  email_alias?: string | null;
  slack_channel?: string | null;
}

interface RunBody {
  selections: ImportSelection[];
  drop_seed?: boolean; // if true, soft-delete the seeded "acme" placeholder
}

interface ImportResult {
  monday_item_id: string;
  display_name: string;
  status: "imported" | "updated" | "skipped" | "failed";
  customer_key?: string;
  customer_id?: string;
  error?: string;
}

// POST /api/dev/import/run
// Body: { selections: [...], drop_seed?: true }
// Each selection becomes a customer row (insert if new, update if already
// imported by monday_item_id or proposed_key).
export async function POST(request: Request) {
  let body: RunBody;
  try {
    body = (await request.json()) as RunBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.selections) || body.selections.length === 0) {
    return NextResponse.json({ error: "selections[] required." }, { status: 400 });
  }

  const results: ImportResult[] = [];

  for (const sel of body.selections) {
    if (!sel.monday_item_id || !sel.display_name) {
      results.push({
        monday_item_id: sel.monday_item_id ?? "?",
        display_name: sel.display_name ?? "?",
        status: "failed",
        error: "missing monday_item_id or display_name",
      });
      continue;
    }

    const key = sel.proposed_key?.trim() || slugifyCustomerKey(sel.display_name);

    const input: CreateCustomerInput = {
      key,
      display_name: sel.display_name,
      slack_channel: sel.slack_channel ?? key, // default channel name = key
      email_alias: sel.email_alias ?? null,
      monday_item_id: sel.monday_item_id,
      monday_workspace_id: sel.monday_workspace_id ?? null,
      salesforce_account_id: sel.salesforce_account_id ?? null,
      partner: sel.partner ?? null,
      ce_owner: sel.ce_owner ?? null,
      lifecycle_group: sel.lifecycle_group ?? null,
    };

    try {
      const customer = await upsertCustomer(input);
      results.push({
        monday_item_id: sel.monday_item_id,
        display_name: sel.display_name,
        status: "imported",
        customer_key: customer.key,
        customer_id: customer.id,
      });

      // Log a CONTACT_CHANGE event so the import shows up in the customer's
      // events feed. Use the existing event types so we don't pollute the
      // enum.
      try {
        await appendEvent(
          customer.key,
          "MILESTONE",
          {
            kind: "imported_from_monday",
            monday_item_id: sel.monday_item_id,
            salesforce_account_id: sel.salesforce_account_id ?? null,
            lifecycle_group: sel.lifecycle_group ?? null,
          },
          {
            summary: `Imported from Monday Customers board (${sel.lifecycle_group ?? "?"})`,
            tags: ["import", "monday"],
          }
        );
      } catch {
        /* best-effort */
      }
    } catch (err) {
      results.push({
        monday_item_id: sel.monday_item_id,
        display_name: sel.display_name,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Optional: drop the seeded Acme placeholder (no monday_item_id, key=acme).
  let acmeDropped = false;
  if (body.drop_seed) {
    try {
      acmeDropped = await deleteCustomer("acme");
    } catch (err) {
      console.warn("[import run] failed to drop acme seed:", err);
    }
  }

  const summary = {
    total: results.length,
    imported: results.filter((r) => r.status === "imported").length,
    failed: results.filter((r) => r.status === "failed").length,
    seed_dropped: acmeDropped,
  };

  return NextResponse.json({ results, summary });
}
