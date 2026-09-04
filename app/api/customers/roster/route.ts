import { NextResponse } from "next/server";

import { listCustomers, countCustomerProcesses, updateCustomerManually } from "@/lib/customers";

export const dynamic = "force-dynamic";

// GET /api/customers/roster — the management view behind Configure ->
// Customers: every customer including inactive ones, plus how many processes
// each owns.
//
// Distinct from GET /api/customers (which the operations chat and other
// callers use) because this one deliberately includes inactive rows and pays
// for the process count. The customer PICKERS don't come here at all — they
// read facets.customerOptions from the page loader, which filters to active.
export async function GET() {
  try {
    const [customers, counts] = await Promise.all([listCustomers(), countCustomerProcesses()]);
    return NextResponse.json({ customers, counts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

interface PatchBody {
  key: string;
  active?: boolean;
  display_name?: string;
  custom_category?: string;
}

// PATCH /api/customers/roster — mark a customer active/inactive, or fix its
// name or category. Goes through updateCustomerManually so the field is added
// to deliveryops_protected_fields and the next Salesforce/Monday sync can't
// quietly reactivate a customer you just retired.
export async function PATCH(request: Request) {
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.key) {
    return NextResponse.json({ error: "key is required." }, { status: 400 });
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active must be a boolean." }, { status: 400 });
  }
  if (body.display_name !== undefined && !body.display_name.trim()) {
    return NextResponse.json({ error: "display_name cannot be blank." }, { status: 400 });
  }

  const updates: Parameters<typeof updateCustomerManually>[1] = {};
  if (body.active !== undefined) updates.active = body.active;
  if (body.display_name !== undefined) updates.display_name = body.display_name.trim();
  if (body.custom_category !== undefined) updates.custom_category = body.custom_category;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const customer = await updateCustomerManually(body.key, updates);
    return NextResponse.json({ customer });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
