// Anthropic Message Batches API wrapper.
//
// Batches are 50% cheaper per token than realtime, but processing can take
// up to 24 hours. Use this for non-interactive bulk work:
//   • bulk reclassifying documents when DOCUMENT_CATEGORIES changes
//   • bulk profile enrichment from newly-imported customers
//   • monthly-digest fan-out across the whole portfolio
//   • future health-score backfill
//
// Do NOT use this for chat replies, approval responses, or anything else
// where the user is waiting on the result.
//
// Pattern:
//   1. submitBatch(requests) → returns the batch ID immediately
//   2. Wait (or poll). Typical batches finish in minutes; the SDK polls
//      at 2-second intervals up to a deadline.
//   3. collectResults(batchId) → async iterator over each request's response
//
// Anthropic docs: https://docs.anthropic.com/en/docs/build-with-claude/batch-processing

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Missing ANTHROPIC_API_KEY.");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

export interface BatchRequest {
  /** Caller-provided ID — used to match results back to the source row. */
  customId: string;
  /** The Message params for this one request. */
  params: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "stream">;
}

export interface BatchSubmission {
  batchId: string;
  requestCount: number;
}

/**
 * Submit a batch of message requests. Returns immediately with the batch ID.
 * Each request must have a unique `customId` so results can be correlated.
 */
export async function submitBatch(requests: BatchRequest[]): Promise<BatchSubmission> {
  if (requests.length === 0) throw new Error("submitBatch: no requests provided.");

  const ids = new Set<string>();
  for (const r of requests) {
    if (ids.has(r.customId)) {
      throw new Error(`submitBatch: duplicate customId "${r.customId}".`);
    }
    ids.add(r.customId);
  }

  const batch = await client().messages.batches.create({
    requests: requests.map((r) => {
      // Fall back to the workspace-default model unless the caller set one.
      const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        ...r.params,
        model: r.params.model ?? MODEL,
      };
      return { custom_id: r.customId, params };
    }),
  });

  return { batchId: batch.id, requestCount: requests.length };
}

export type BatchStatus =
  | "in_progress"
  | "canceling"
  | "ended";

export interface BatchProgress {
  status: BatchStatus;
  counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  endedAt: string | null;
  resultsAvailable: boolean;
}

export async function getBatchStatus(batchId: string): Promise<BatchProgress> {
  const b = await client().messages.batches.retrieve(batchId);
  return {
    status: b.processing_status as BatchStatus,
    counts: {
      processing: b.request_counts.processing,
      succeeded: b.request_counts.succeeded,
      errored: b.request_counts.errored,
      canceled: b.request_counts.canceled,
      expired: b.request_counts.expired,
    },
    endedAt: b.ended_at,
    resultsAvailable: b.processing_status === "ended" && !!b.results_url,
  };
}

export interface BatchResult {
  customId: string;
  /** "succeeded" rows return a full Anthropic.Message. */
  message?: Anthropic.Message;
  /** "errored", "canceled", "expired" return a structured error. */
  error?: { type: string; message: string };
  status: "succeeded" | "errored" | "canceled" | "expired";
}

/**
 * Collect all results for a completed batch into an array. Order is NOT
 * guaranteed — use `customId` to correlate back to source rows.
 *
 * Throws if the batch hasn't ended yet — call `getBatchStatus` first.
 */
export async function collectResults(batchId: string): Promise<BatchResult[]> {
  const decoder = await client().messages.batches.results(batchId);
  const out: BatchResult[] = [];
  for await (const entry of decoder) {
    const item: BatchResult = {
      customId: entry.custom_id,
      status: entry.result.type as BatchResult["status"],
    };
    if (entry.result.type === "succeeded") {
      item.message = entry.result.message;
    } else if (entry.result.type === "errored") {
      item.error = {
        type: entry.result.error.error.type,
        message: entry.result.error.error.message,
      };
    } else {
      item.error = { type: entry.result.type, message: `Batch entry ${entry.result.type}.` };
    }
    out.push(item);
  }
  return out;
}

/**
 * Convenience: extract the first text block from a succeeded batch message.
 * Returns null when the result errored or the message had no text.
 */
export function extractText(result: BatchResult): string | null {
  if (!result.message) return null;
  const block = result.message.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  return block?.text ?? null;
}
