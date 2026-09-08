import { NextResponse } from "next/server";

import { auth0 } from "@/lib/auth/auth0";
import {
  listOverrides,
  setOverride,
  clearOverride,
  InvalidOverrideError,
  OVERRIDABLE_FIELDS,
  OVERRIDE_ENTITY_TYPES,
  type OverrideEntityType,
} from "@/lib/overrides/store";

export const dynamic = "force-dynamic";

// Best-effort attribution, same fallback as the process routes: a session
// lookup failure shouldn't fail the write, but an override is a judgement
// call and "who decided this" is the most valuable thing recorded here, so
// it's read from the session rather than accepted from the body.
async function actor(): Promise<string> {
  try {
    const session = await auth0.getSession();
    return session?.user?.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

// GET /api/overrides?entity_type=customer — every live correction, plus the
// catalogue of what can be corrected, so the UI doesn't hardcode a second
// copy of the allow-list.
export async function GET(request: Request) {
  const entityType = new URL(request.url).searchParams.get("entity_type") as
    | OverrideEntityType
    | null;
  if (entityType && !OVERRIDE_ENTITY_TYPES.includes(entityType)) {
    return NextResponse.json(
      { error: `entity_type must be one of: ${OVERRIDE_ENTITY_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }
  try {
    const overrides = await listOverrides(entityType ?? undefined);
    return NextResponse.json({ overrides, overridable: OVERRIDABLE_FIELDS });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

interface PostBody {
  entity_type?: OverrideEntityType;
  entity_id?: string;
  field?: string;
  value?: unknown;
  synced_value?: unknown;
  reason?: string | null;
}

// POST /api/overrides — record or update a correction. Idempotent per
// (entity_type, entity_id, field): re-correcting updates the row rather than
// stacking a second one.
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.entity_type || !body.entity_id || !body.field) {
    return NextResponse.json(
      { error: "entity_type, entity_id and field are all required." },
      { status: 400 }
    );
  }

  try {
    const override = await setOverride({
      entityType: body.entity_type,
      entityId: body.entity_id,
      field: body.field,
      value: body.value,
      syncedValue: body.synced_value,
      reason: body.reason ?? null,
      setBy: await actor(),
    });
    return NextResponse.json({ override });
  } catch (err) {
    if (err instanceof InvalidOverrideError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// DELETE /api/overrides?entity_type=&entity_id=&field= — drop the correction
// so the field falls back to whatever the upstream source says.
export async function DELETE(request: Request) {
  const p = new URL(request.url).searchParams;
  const entityType = p.get("entity_type") as OverrideEntityType | null;
  const entityId = p.get("entity_id");
  const field = p.get("field");

  if (!entityType || !entityId || !field) {
    return NextResponse.json(
      { error: "entity_type, entity_id and field are all required." },
      { status: 400 }
    );
  }
  if (!OVERRIDE_ENTITY_TYPES.includes(entityType)) {
    return NextResponse.json(
      { error: `entity_type must be one of: ${OVERRIDE_ENTITY_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }

  try {
    const removed = await clearOverride(entityType, entityId, field);
    return NextResponse.json({ removed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
