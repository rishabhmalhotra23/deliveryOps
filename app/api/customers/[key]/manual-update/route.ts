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
// Every DeliveryOps-owned column on `customers`. Widened 2026-09-08: the
// point is that changing a customer's state never needs a code change, and a
// short allow-list meant `active` (retire a customer) and the integration
// mappings weren't reachable from the product at all.
//
// Deliberately still an allow-list rather than "any column": `key` is what
// every integration and the /customers/[key] route join on, and the
// provenance/timestamp columns are bookkeeping this route maintains itself.
// Neither should be settable by a field name in a request body.
const ALLOWED_FIELDS = new Set([
  "ae_owner",
  "custom_category",
  "partner",
  "lifecycle_group",
  "slack_channel",
  "email_alias",
  "display_name",
  "active",
  "brand_color",
  "logo_url",
  "salesforce_account_id",
  "kognitos_v1_workspace_id",
  "kognitos_v2_workspace_id",
  "kognitos_v1_department_id",
  "drive_folder_id",
]);

/** `active` is the only non-text column here, and an HTML form or a JSON
 *  client can send it as "true"/"false". Coerced rather than rejected. */
function coerceValue(field: string, value: string | null): string | boolean | null {
  if (field !== "active") return value;
  if (value === null) return null;
  return value === "true" || value === "1";
}

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
  // `active` is NOT NULL, so a cleared value would fail at the database with
  // a constraint error rather than a useful message.
  if (field === "active" && value == null) {
    return NextResponse.json(
      { error: "active must be true or false." },
      { status: 400 }
    );
  }

  try {
    const customer = await updateCustomerManually(
      key,
      { [field]: coerceValue(field, value ?? null) } as Parameters<typeof updateCustomerManually>[1],
      { updatedBy: "dashboard-inline" }
    );

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
