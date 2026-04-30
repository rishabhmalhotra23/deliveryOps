import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/integrations/salesforce";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/dev/probe/salesforce/accounts
//   ?search=<prefix>   (case-sensitive Name LIKE prefix%)
//   ?limit=N           (default 25, max 100)
//
// Used as a lookup tool, not a roster source — Monday is the customer
// roster, Salesforce is enrichment.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "25"), 1), 100);

  try {
    const accounts = await listAccounts({ search, limit });
    return NextResponse.json({
      accounts,
      count: accounts.length,
      note: "This is a search probe. Salesforce holds 78k+ accounts including prospects; the customer roster comes from Monday.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
