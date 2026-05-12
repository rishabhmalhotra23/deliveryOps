import { NextResponse } from "next/server";
import { runFullSync, type SyncSource } from "@/lib/sync/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // sync of 41 customers can run a couple of minutes

interface Body {
  sources?: SyncSource[];
  customer_key?: string;
}

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    /* empty body is fine — sync everything */
  }

  const result = await runFullSync({
    sources: body.sources,
    customerKey: body.customer_key,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
