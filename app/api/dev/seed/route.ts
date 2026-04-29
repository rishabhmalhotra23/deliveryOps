import { NextResponse } from "next/server";

import { createCustomer, getCustomerByKey } from "@/lib/customers";

export const dynamic = "force-dynamic";

const DEMO = {
  key: "acme",
  display_name: "Acme",
  slack_channel: "acme",
  email_alias: "acme@deliveryops.example",
};

async function handle(request: Request): Promise<NextResponse> {
  const back = new URL("/dev", request.url);
  try {
    const existing = await getCustomerByKey(DEMO.key);
    if (existing) {
      return NextResponse.redirect(back, 303);
    }
    await createCustomer(DEMO);
    return NextResponse.redirect(back, 303);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Seed failed." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
