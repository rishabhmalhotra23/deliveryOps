import { NextResponse } from "next/server";

import { createCustomer, listCustomers } from "@/lib/customers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const customers = await listCustomers();
    return NextResponse.json({ customers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list customers." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let body: { key?: string; display_name?: string; slack_channel?: string; email_alias?: string; drive_folder_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.key || !body.display_name) {
    return NextResponse.json(
      { error: "Missing required fields: key, display_name." },
      { status: 400 }
    );
  }

  try {
    const customer = await createCustomer({
      key: body.key,
      display_name: body.display_name,
      slack_channel: body.slack_channel,
      email_alias: body.email_alias,
      drive_folder_id: body.drive_folder_id,
    });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create customer." },
      { status: 500 }
    );
  }
}
