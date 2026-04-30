import { NextResponse } from "next/server";
import { getAccount, listOpportunities, listCases } from "@/lib/integrations/salesforce";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/dev/probe/salesforce/account/[id]
// Returns the full Account record + its opportunities + open cases.
interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const [account, opportunities, cases] = await Promise.all([
      getAccount(id),
      listOpportunities({ accountId: id, limit: 25 }),
      listCases({ accountId: id, limit: 25 }),
    ]);
    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    return NextResponse.json({ account, opportunities, cases });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
