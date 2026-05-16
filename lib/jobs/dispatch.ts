// Fire-and-forget job dispatcher.
//
// Replaces the Inngest event bus. Pattern:
//   1. Webhook handler (Slack/Gmail/upload) calls dispatchJob("ingest-document", data).
//   2. dispatchJob() does a POST to /api/jobs/<name> with the data and the
//      JOBS_SECRET header, then returns immediately without awaiting the body.
//   3. Vercel spins up a fresh function execution for /api/jobs/<name> which
//      runs the actual work — up to maxDuration (60s on Pro, 10s on Hobby).
//
// Why no awaiting:
//   The caller (Slack webhook, etc.) needs to ACK within ~3s. The dispatched
//   work (Claude vision OCR, multi-step ingestion) routinely takes longer.
//
// Why no retry / queue table:
//   Failures are logged to the events table by the job route itself. Re-upload
//   is the manual retry. If we ever need durable retry, drop in a `pending_jobs`
//   Postgres table — same pattern, just persistent.
//
// Auth:
//   Job routes accept Authorization: Bearer <JOBS_SECRET>. JOBS_SECRET defaults
//   to CRON_SECRET if unset, so the same secret used by Vercel Cron protects
//   the internal dispatch path too — one secret to rotate, not two.

import { logger } from "@/lib/logger";

const log = logger("jobs.dispatch");

export type JobName =
  | "ingest-document"
  | "run-task"
  | "process-email";

interface DispatchOptions {
  /** Optional override of where to POST. Defaults to VERCEL_URL or NEXT_PUBLIC_APP_URL. */
  baseUrl?: string;
}

/**
 * Fire-and-forget POST to /api/jobs/<name>. Does NOT await the response body;
 * the caller returns as soon as the request is dispatched.
 */
export async function dispatchJob<T = unknown>(
  name: JobName,
  data: T,
  opts: DispatchOptions = {}
): Promise<void> {
  const secret = process.env.JOBS_SECRET ?? process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      log.error("dispatch refused: JOBS_SECRET/CRON_SECRET not set", { job: name });
      throw new Error("Job dispatch unavailable: JOBS_SECRET not configured.");
    }
    log.warn("dispatch skipped in dev (no JOBS_SECRET set)", { job: name });
    return;
  }

  const base =
    opts.baseUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    "http://localhost:4001";

  const url = `${base}/api/jobs/${name}`;

  // Initiate the request and DO NOT await the body. We do await the initial
  // promise so a synchronous failure (DNS, refused) is logged, but we don't
  // wait for the work to complete.
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(data),
      // Important: don't keep the upstream request alive waiting for the
      // response body. The function spawns and runs on its own.
      keepalive: true,
    });
    // For HTTP-level failures, log but don't throw — the webhook ACK should
    // still succeed even if the background job couldn't start.
    if (!res.ok) {
      log.warn("dispatch returned non-OK", { job: name, status: res.status, url });
    }
  } catch (err) {
    log.error("dispatch failed", { job: name, url, err: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Validate an incoming job request. Returns null on success, or an error
 * Response to return immediately. Use at the top of every /api/jobs/* route:
 *
 *   const err = await assertJobAuth(request);
 *   if (err) return err;
 */
export async function assertJobAuth(request: Request): Promise<Response | null> {
  const { NextResponse } = await import("next/server");
  const expected = process.env.JOBS_SECRET ?? process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "JOBS_SECRET not configured." }, { status: 500 });
    }
    return null; // local dev, no secret required
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  return null;
}
