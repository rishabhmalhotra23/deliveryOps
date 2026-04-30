import { NextResponse } from "next/server";

import { updateCustomerManually } from "@/lib/customers";
import { appendEvent } from "@/lib/events/events";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ key: string }>;
}

// POST /api/customers/[key]/manual-update
//   body: { field: "ae_owner" | "custom_category" | "partner" | "lifecycle_group" | "slack_channel" | "email_alias" | "display_name", value: string | null, reason?: string }
//
// Bypasses the per-field-route boilerplate by routing every manual edit
// through one validated handler that uses updateCustomerManually under the
// hood. Logs an audit event tagged "manual-edit".
const ALLOWED_FIELDS = new Set([
  "ae_owner",
  "custom_category",
  "partner",
  "lifecycle_group",
  "slack_channel",
  "email_alias",
  "display_name",
]);

interface Body {
  field?: string;
  value?: string | null;
  reason?: string;
}

export async function POST(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const field = body.field?.trim();
  if (!field || !ALLOWED_FIELDS.has(field)) {
    return NextResponse.json(
      { error: `field must be one of: ${Array.from(ALLOWED_FIELDS).join(", ")}` },
      { status: 400 }
    );
  }

  // Coerce empty string → null for nullable fields. display_name can't be null.
  let value = body.value;
  if (typeof value === "string") value = value.trim();
  if (field === "display_name" && (!value || typeof value !== "string")) {
    return NextResponse.json({ error: "display_name cannot be empty." }, { status: 400 });
  }
  if (value === "") value = null;

  try {
    const customer = await updateCustomerManually(key, {
      [field]: value,
    } as Parameters<typeof updateCustomerManually>[1]);

    // Audit event
    try {
      await appendEvent(
        key,
        field === "ae_owner"
          ? "OWNER_CHANGED"
          : field === "custom_category"
            ? "CATEGORY_CHANGED"
            : "PROFILE_UPDATED",
        { field, value, reason: body.reason ?? null, source: "dashboard-inline" },
        {
          summary: `${field} → ${value ?? "(none)"}${body.reason ? ` · ${body.reason}` : ""}`,
          tags: ["manual-edit", field, "dashboard"],
        }
      );
    } catch {
      /* event logging is best-effort */
    }

    return NextResponse.json({ customer });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
