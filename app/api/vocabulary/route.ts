import { NextResponse } from "next/server";

import {
  listVocabularyValues,
  addVocabularyValue,
  updateVocabularyValue,
  InvalidVocabularyInputError,
  EXTENDABLE_VOCABULARIES,
  VOCABULARY_LABELS,
  type VocabularyName,
} from "@/lib/vocabulary/store";

export const dynamic = "force-dynamic";

// GET /api/vocabulary — every value of every delivery vocabulary, with its
// label, colour and order. Backs Configure's stage/lifecycle tabs, which were
// read-only lists explaining that a new value needed a schema migration.
export async function GET(request: Request) {
  const vocabulary = new URL(request.url).searchParams.get("vocabulary") as VocabularyName | null;
  if (vocabulary && !(EXTENDABLE_VOCABULARIES as readonly string[]).includes(vocabulary)) {
    return NextResponse.json(
      { error: `vocabulary must be one of: ${EXTENDABLE_VOCABULARIES.join(", ")}.` },
      { status: 400 }
    );
  }
  try {
    const values = await listVocabularyValues(vocabulary ?? undefined);
    return NextResponse.json({
      values,
      vocabularies: EXTENDABLE_VOCABULARIES.map((v) => ({ name: v, label: VOCABULARY_LABELS[v] })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

interface PostBody {
  vocabulary?: string;
  value?: string;
  label?: string;
  short_label?: string | null;
  hue?: string | null;
}

// POST /api/vocabulary — add a value to a vocabulary.
//
// This one runs DDL (ALTER TYPE ... ADD VALUE) inside a SECURITY DEFINER
// function, and it CANNOT BE UNDONE: Postgres has no DROP VALUE. That's why
// the value shape is constrained in three places (here, the store, and the
// function) and why the response says so plainly.
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.vocabulary || !body.value || !body.label) {
    return NextResponse.json(
      { error: "vocabulary, value and label are all required." },
      { status: 400 }
    );
  }

  try {
    await addVocabularyValue({
      vocabulary: body.vocabulary,
      value: body.value,
      label: body.label,
      shortLabel: body.short_label,
      hue: body.hue,
    });
    const values = await listVocabularyValues(body.vocabulary as VocabularyName);
    return NextResponse.json({ values });
  } catch (err) {
    if (err instanceof InvalidVocabularyInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

interface PatchBody {
  vocabulary?: string;
  value?: string;
  label?: string;
  short_label?: string | null;
  hue?: string | null;
  sort_order?: number;
  active?: boolean;
}

// PATCH /api/vocabulary — restyle, reorder or retire a value. Never DDL: the
// enum label itself is immutable, so `active: false` is how a value leaves
// circulation without breaking the rows that already carry it.
export async function PATCH(request: Request) {
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.vocabulary || !body.value) {
    return NextResponse.json({ error: "vocabulary and value are required." }, { status: 400 });
  }

  try {
    const updated = await updateVocabularyValue(body.vocabulary, body.value, {
      label: body.label,
      shortLabel: body.short_label,
      hue: body.hue,
      sortOrder: body.sort_order,
      active: body.active,
    });
    return NextResponse.json({ value: updated });
  } catch (err) {
    if (err instanceof InvalidVocabularyInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
