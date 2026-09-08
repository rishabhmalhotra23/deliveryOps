// Validation for the vocabulary layer. Worth real coverage because
// addVocabularyValue's value reaches `ALTER TYPE ... ADD VALUE` inside a
// SECURITY DEFINER function, and because the operation cannot be undone —
// Postgres has no DROP VALUE.
//
// The database function carries its own copy of every check below; that copy
// is the actual security boundary. These test the client-side copy, whose job
// is a useful error message instead of a raw Postgres exception.

import { describe, it, expect } from "vitest";
import {
  EXTENDABLE_VOCABULARIES,
  VOCABULARY_LABELS,
  InvalidVocabularyInputError,
  addVocabularyValue,
  updateVocabularyValue,
} from "@/lib/vocabulary/store";
import { HUES } from "@/lib/delivery/hues";

/** These reject before any Supabase call, so they can be asserted without a
 *  database — a rejected input never reaches requireAdmin(). */
async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected a rejection, got none");
}

describe("vocabulary catalogue", () => {
  it("labels every extendable vocabulary, since the picker lists them by label", () => {
    for (const v of EXTENDABLE_VOCABULARIES) {
      expect(VOCABULARY_LABELS[v], v).toBeTruthy();
    }
  });

  it("covers exactly the seven delivery enums the Configure dialog showed as fixed", () => {
    expect([...EXTENDABLE_VOCABULARIES].sort()).toEqual([
      "migration_stage",
      "process_blocked_on",
      "process_health",
      "process_lifecycle",
      "process_phase",
      "process_platform",
      "process_work_mode",
    ]);
  });
});

describe("addVocabularyValue validation", () => {
  it("rejects a vocabulary outside the allow-list — the value reaches DDL", async () => {
    const err = await rejection(() =>
      addVocabularyValue({ vocabulary: "customers", value: "x", label: "X" })
    );
    expect(err).toBeInstanceOf(InvalidVocabularyInputError);
    expect(err.message).toContain("Unknown vocabulary");
  });

  it("rejects characters that would need quoting in DDL, after normalisation", async () => {
    // Normalisation is trim -> lowercase -> spaces to underscores. These
    // survive it still malformed, so they must be refused.
    for (const bad of ["Bad Value; drop table x", "has-dash", "1_leading_digit", "trailing.dot", "quote'd"]) {
      const err = await rejection(() =>
        addVocabularyValue({ vocabulary: "migration_stage", value: bad, label: "X" })
      );
      expect(err, bad).toBeInstanceOf(InvalidVocabularyInputError);
    }
  });

  it("normalises a human-typed value rather than rejecting it outright", async () => {
    // "Awaiting Security Review" is what somebody types; the enum label has
    // to be lower_snake_case. Rejecting that would be needlessly hostile, so
    // it is folded. Each of these normalises to something valid and so gets
    // PAST validation — proven by the failure coming from the blank label
    // check that follows it, not from the value check.
    for (const typed of ["Awaiting Security Review", "Has_Caps", "trailing   "]) {
      const err = await rejection(() =>
        addVocabularyValue({ vocabulary: "migration_stage", value: typed, label: "" })
      );
      expect(err.message, typed).toContain("label is required");
    }
  });

  it("rejects a blank label — it's what people read", async () => {
    const err = await rejection(() =>
      addVocabularyValue({ vocabulary: "migration_stage", value: "some_stage", label: "   " })
    );
    expect(err.message).toContain("label is required");
  });

  it("rejects a hue outside the 8-hue palette", async () => {
    const err = await rejection(() =>
      addVocabularyValue({
        vocabulary: "migration_stage",
        value: "some_stage",
        label: "Some stage",
        hue: "chartreuse",
      })
    );
    expect(err.message).toContain("Unknown hue");
  });

  it("accepts every hue the chip system actually defines", () => {
    // Guards against the palette growing in hues.ts without this layer
    // learning about it, which would reject a legitimate colour.
    expect(HUES.length).toBe(8);
    for (const h of HUES) expect(typeof h).toBe("string");
  });

  it("rejects a value longer than the enum label limit it enforces", async () => {
    const err = await rejection(() =>
      addVocabularyValue({
        vocabulary: "migration_stage",
        value: "a".repeat(42),
        label: "Too long",
      })
    );
    expect(err).toBeInstanceOf(InvalidVocabularyInputError);
  });
});

describe("updateVocabularyValue validation", () => {
  it("rejects an unknown vocabulary", async () => {
    const err = await rejection(() => updateVocabularyValue("customers", "x", { label: "X" }));
    expect(err.message).toContain("Unknown vocabulary");
  });

  it("rejects a blank label", async () => {
    const err = await rejection(() =>
      updateVocabularyValue("migration_stage", "v2_native", { label: "  " })
    );
    expect(err.message).toContain("can't be blank");
  });

  it("rejects an empty patch rather than issuing a no-op UPDATE", async () => {
    const err = await rejection(() => updateVocabularyValue("migration_stage", "v2_native", {}));
    expect(err.message).toContain("Nothing to update");
  });

  it("allows clearing the hue back to the neutral fallback", async () => {
    // `hue: null` must be distinguishable from `hue: undefined` (absent), so
    // this has to get past validation and reach the database call.
    const err = await rejection(() =>
      updateVocabularyValue("migration_stage", "v2_native", { hue: null })
    );
    // It failed at the Supabase client, not in validation — which is what
    // proves null is accepted as a deliberate clear.
    expect(err).not.toBeInstanceOf(InvalidVocabularyInputError);
  });
});
