import { NextResponse } from "next/server";

import {
  loadCustomerVocabulary,
  addCustomerVocabularyValue,
  updateVocabularyValue,
  deleteCustomerVocabularyValue,
  renameCustomerCategory,
  countCustomerVocabularyUsage,
  InvalidVocabularyInputError,
  FREE_TEXT_VOCABULARIES,
  type FreeTextVocabularyName,
} from "@/lib/vocabulary/store";

export const dynamic = "force-dynamic";

// Customer zones and categories (0045).
//
// Separate from /api/vocabulary, which fronts the delivery ENUM vocabularies
// and whose POST runs `ALTER TYPE` through a SECURITY DEFINER function. These
// two are plain `text`, so adding one is an INSERT and DELETE is genuinely
// available — a different contract, and worth a different route rather than a
// mode flag on that one.
//
// This is what makes zones and categories editable from the product: the group
// headers on /customers, a category's colour, and which zone it rolls up
// into were all compiled into app/_components/brand.tsx until 2026-09-08.

function isVocab(v: unknown): v is FreeTextVocabularyName {
  return typeof v === "string" && (FREE_TEXT_VOCABULARIES as readonly string[]).includes(v);
}

function fail(err: unknown) {
  if (err instanceof InvalidVocabularyInputError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : String(err) },
    { status: 500 }
  );
}

export async function GET() {
  try {
    const vocabulary = await loadCustomerVocabulary();
    // Usage counts turn "delete" from a blind action into a decision, the same
    // way the roster tab shows assignment counts before you retire someone.
    const usage: Record<string, number> = {};
    for (const c of vocabulary.categories) {
      usage[`customer_category:${c.value}`] = await countCustomerVocabularyUsage(
        "customer_category",
        c.value
      );
    }
    for (const z of vocabulary.zones) {
      usage[`customer_zone:${z.value}`] = await countCustomerVocabularyUsage(
        "customer_zone",
        z.value
      );
    }
    return NextResponse.json({ ...vocabulary, usage });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  let body: { vocabulary?: unknown; label?: unknown; hue?: unknown; rollup?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!isVocab(body.vocabulary)) {
    return NextResponse.json(
      { error: `vocabulary must be one of: ${FREE_TEXT_VOCABULARIES.join(", ")}.` },
      { status: 400 }
    );
  }
  if (typeof body.label !== "string") {
    return NextResponse.json({ error: "label must be a string." }, { status: 400 });
  }
  try {
    const value = await addCustomerVocabularyValue({
      vocabulary: body.vocabulary,
      label: body.label,
      hue: typeof body.hue === "string" ? body.hue : null,
      rollup: typeof body.rollup === "string" ? body.rollup : null,
      description: typeof body.description === "string" ? body.description : null,
    });
    return NextResponse.json({ value }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!isVocab(body.vocabulary) || typeof body.value !== "string") {
    return NextResponse.json({ error: "vocabulary and value are required." }, { status: 400 });
  }

  try {
    // A category rename has to move every customer carrying it, because
    // customers.custom_category stores the label rather than a slug. Dispatched
    // to the SQL function so the two writes can't half-apply. A zone rename is
    // an ordinary label edit — nothing stores a zone.
    if (
      body.vocabulary === "customer_category" &&
      typeof body.label === "string" &&
      body.label.trim() !== body.value
    ) {
      const customersMoved = await renameCustomerCategory(body.value, body.label);
      const vocabulary = await loadCustomerVocabulary();
      return NextResponse.json({ vocabulary, customersMoved });
    }

    await updateVocabularyValue(body.vocabulary, body.value, {
      label: typeof body.label === "string" ? body.label : undefined,
      hue: body.hue === null || typeof body.hue === "string" ? (body.hue as string | null) : undefined,
      rollup:
        body.rollup === null || typeof body.rollup === "string"
          ? (body.rollup as string | null)
          : undefined,
      description:
        body.description === null || typeof body.description === "string"
          ? (body.description as string | null)
          : undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    const vocabulary = await loadCustomerVocabulary();
    return NextResponse.json({ vocabulary, customersMoved: 0 });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const vocabulary = url.searchParams.get("vocabulary");
  const value = url.searchParams.get("value");
  if (!isVocab(vocabulary) || !value) {
    return NextResponse.json({ error: "vocabulary and value are required." }, { status: 400 });
  }
  try {
    await deleteCustomerVocabularyValue(vocabulary, value);
    return NextResponse.json({ vocabulary: await loadCustomerVocabulary() });
  } catch (err) {
    return fail(err);
  }
}
