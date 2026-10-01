import { NextResponse } from "next/server";
import { createCustomer, listCustomers } from "@/lib/customers";
import { parseBody, CustomerCreateSchema } from "@/lib/api/schemas";
import { customerKeyFor } from "@/lib/customers/slug";
import { logger, errorCtx } from "@/lib/logger";

export const dynamic = "force-dynamic";
const log = logger("api/customers");

export async function GET() {
  try {
    const customers = await listCustomers();
    return NextResponse.json({ customers });
  } catch (err) {
    log.error("Failed to list customers", errorCtx(err));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list customers." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, CustomerCreateSchema);
  if (!parsed.ok) return parsed.response;
  const key = customerKeyFor(parsed.data);
  if (!key) {
    return NextResponse.json(
      { error: "Customer name needs at least one letter or digit." },
      { status: 400 }
    );
  }
  try {
    const customer = await createCustomer({ ...parsed.data, key });
    log.info("Customer created", { key: customer.key });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    log.error("Failed to create customer", { ...parsed.data, ...errorCtx(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create customer." },
      { status: 500 }
    );
  }
}
