import { NextResponse } from "next/server";

import { getCustomerByKey, deleteCustomer, restoreCustomer } from "@/lib/customers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ key: string }>;
}

// GET /api/customers/[key]
export async function GET(_request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  try {
    const customer = await getCustomerByKey(key);
    if (!customer) return NextResponse.json({ error: `Unknown customer: ${key}` }, { status: 404 });
    return NextResponse.json({ customer });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// DELETE /api/customers/[key] — soft delete.
//
// `deleteCustomer` has existed in lib/customers.ts since the beginning with no
// route and no UI, so removing a customer was impossible from the product.
// Added 2026-09-08.
//
// Soft, always: `deleted_at` is set and every reader already filters on it, so
// nothing is destroyed and POST .../restore puts it back. A customer owns
// processes, events, profiles, NPS responses and SF cache rows — a hard delete
// would either orphan them or cascade through a lot of history to remove one
// row from a dropdown, and "no longer a customer" is what `active` is for.
export async function DELETE(_request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  try {
    const existing = await getCustomerByKey(key);
    if (!existing) return NextResponse.json({ error: `Unknown customer: ${key}` }, { status: 404 });
    const removed = await deleteCustomer(key);
    return NextResponse.json({ removed, key });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST /api/customers/[key] with {"action":"restore"} — undo a soft delete.
// A single-purpose verb on the collection member rather than a nested
// /restore route, matching how the processes routes do it.
export async function POST(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (body.action !== "restore") {
    return NextResponse.json({ error: 'Only {"action":"restore"} is supported.' }, { status: 400 });
  }
  try {
    const customer = await restoreCustomer(key);
    return NextResponse.json({ customer });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
