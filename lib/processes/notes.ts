// The process_notes feed (0031) — an append-only replacement for the single
// notes/blockers text fields on `processes`, which get overwritten on every
// edit and so can never show what was said before the last edit.
//
// addProcessNote also mirrors the new body into processes.notes/blockers
// (via the same updateProcess() every drawer edit uses, so field_provenance
// stays consistent) — every existing reader of proc.notes/proc.blockers
// keeps seeing "the latest note" without any change on their end.

import { requireAdmin } from "@/lib/supabase/server";
import { TABLES, type Process, type ProcessNote, type ProcessNoteKind } from "@/lib/supabase/types";
import { updateProcess } from "@/lib/processes/store";

export class ProcessNoteNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Unknown process note: ${id}`);
    this.name = "ProcessNoteNotFoundError";
  }
}

export async function listProcessNotes(processId: string): Promise<ProcessNote[]> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processNotes)
    .select("*")
    .eq("process_id", processId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ProcessNote[]) ?? [];
}

// kind 'note' mirrors into processes.notes; 'blocker' mirrors into
// processes.blockers; 'system' (auto-logged transitions, not built yet)
// mirrors into neither — there's no legacy single-value field for it.
const MIRROR_FIELD: Partial<Record<ProcessNoteKind, "notes" | "blockers">> = {
  note: "notes",
  blocker: "blockers",
};

export async function addProcessNote(
  processId: string,
  body: string,
  kind: ProcessNoteKind,
  actor: string
): Promise<ProcessNote> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Note body is required.");

  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processNotes)
    .insert({ process_id: processId, kind, body: trimmed, created_by: actor })
    .select("*")
    .single();
  if (error) throw error;

  const mirrorField = MIRROR_FIELD[kind];
  if (mirrorField) {
    await updateProcess(processId, { [mirrorField]: trimmed } as Partial<Process>, actor);
  }

  return data as ProcessNote;
}

export async function softDeleteProcessNote(noteId: string): Promise<ProcessNote> {
  const sb = requireAdmin();
  const { data, error } = await sb
    .from(TABLES.processNotes)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", noteId)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) {
    if (error.code === "PGRST116") throw new ProcessNoteNotFoundError(noteId);
    throw error;
  }
  return data as ProcessNote;
}
