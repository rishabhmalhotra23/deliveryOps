// Centralised Zod schemas for API route inputs.
// Import these in route handlers to validate request bodies before any
// business logic runs.

import { z } from "zod";

// ── Chat ─────────────────────────────────────────────────────────────────────

export const ChatPostSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  message: z.string().min(1, "message is required").max(4000, "message too long"),
  customerKey: z.string().optional(),
});
export type ChatPostInput = z.infer<typeof ChatPostSchema>;

// ── Customers ─────────────────────────────────────────────────────────────────

export const CustomerCreateSchema = z.object({
  key: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
  slack_channel: z.string().max(80).optional(),
  email_alias: z.string().email().optional(),
  drive_folder_id: z.string().optional(),
});
export type CustomerCreateInput = z.infer<typeof CustomerCreateSchema>;

export const ProfilePatchSchema = z.object({
  updates: z.record(z.string(), z.unknown()),
  updated_by: z.string().optional(),
}); // updated_by is optional; updates are validated at the DB layer
export type ProfilePatchInput = z.infer<typeof ProfilePatchSchema>;

export const RulesPutSchema = z.object({
  rules: z.string().min(1, "rules cannot be empty"),
});
export type RulesPutInput = z.infer<typeof RulesPutSchema>;

// ── Tasks ────────────────────────────────────────────────────────────────────

export const TaskScheduleSchema = z.union([
  z.object({ type: z.literal("once"), at: z.string().optional() }),
  z.object({ type: z.literal("recurring"), every: z.string(), until: z.string().optional() }),
  z.object({ type: z.literal("cron"), cron: z.string(), until: z.string().optional() }),
]);

export const TaskActionSchema = z.object({
  type: z.enum(["remind", "check", "run_prompt"]),
  channel: z.enum(["slack", "email", "internal"]).optional(),
  prompt: z.string().optional(),
  message: z.string().optional(),
});

export const TaskCreateSchema = z.object({
  description: z.string().min(1),
  name: z.string().optional(),
  schedule: TaskScheduleSchema,
  action: TaskActionSchema,
  tags: z.array(z.string()).optional(),
});
export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;

// ── Manual update ─────────────────────────────────────────────────────────────

export const ManualUpdateSchema = z.object({
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.null()]),
  lock: z.boolean().optional(),
});
export type ManualUpdateInput = z.infer<typeof ManualUpdateSchema>;

// ── Team asks (Linear ticket tracker — deliveryOps-only, never written
// back to Linear) ────────────────────────────────────────────────────────────

export const TeamAskCreateSchema = z.object({
  ask_text: z.string().min(1).max(2000),
  requester: z.string().min(1).max(120),
  priority_tier: z.enum(["now", "soon", "later"]).optional(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
  notes: z.string().max(4000).optional().nullable(),
  ticket_ids: z.array(z.string().min(1)).optional(),
});
export type TeamAskCreateInput = z.infer<typeof TeamAskCreateSchema>;

export const TeamAskUpdateSchema = z.object({
  ask_text: z.string().min(1).max(2000).optional(),
  requester: z.string().min(1).max(120).optional(),
  priority_tier: z.enum(["now", "soon", "later"]).optional(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
  notes: z.string().max(4000).optional().nullable(),
});
export type TeamAskUpdateInput = z.infer<typeof TeamAskUpdateSchema>;

export const TeamAskLinkTicketSchema = z.object({
  ticket_id: z.string().min(1),
});
export type TeamAskLinkTicketInput = z.infer<typeof TeamAskLinkTicketSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

/** Parse and validate a request body against a Zod schema.
 *  Returns `{ ok: true, data }` on success or `{ ok: false, response }` with a
 *  400 NextResponse ready to return from the route handler. */
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 }),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    return {
      ok: false,
      response: NextResponse.json({ error: "Validation failed.", details }, { status: 400 }),
    };
  }
  return { ok: true, data: result.data };
}
