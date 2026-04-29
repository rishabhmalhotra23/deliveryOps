// Kognitos v1 / v2 client (inherited from kognitos-app-template).
//
// Env vars are read lazily so that missing creds don't blow up the build —
// a route handler that actually calls req() / invokeAutomation() / pollRun()
// will throw at request time with the same message.

function readEnv(name: string, opts: { required?: boolean } = {}): string | undefined {
  const value = process.env[name];
  if (opts.required && !value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function envs() {
  const TOKEN = readEnv("KOGNITOS_TOKEN", { required: true })!;
  const ORG_ID = readEnv("KOGNITOS_ORG_ID", { required: true })!;
  const WORKSPACE_ID = readEnv("KOGNITOS_WORKSPACE_ID", { required: true })!;
  const BASE_URL = readEnv("KOGNITOS_BASE_URL", { required: true })!;
  const AUTOMATION_ID = readEnv("KOGNITOS_AUTOMATION_ID");
  return { TOKEN, ORG_ID, WORKSPACE_ID, BASE_URL, AUTOMATION_ID };
}

export const ORG_ID: string | undefined = process.env.KOGNITOS_ORG_ID;
export const WORKSPACE_ID: string | undefined = process.env.KOGNITOS_WORKSPACE_ID;
export const BASE_URL: string | undefined = process.env.KOGNITOS_BASE_URL;
export const AUTOMATION_ID: string | undefined = process.env.KOGNITOS_AUTOMATION_ID;

export const APP_URL = (BASE_URL ?? "").replace("/api/v1", "");

export function kognitosRunUrl(runId: string, automationId?: string): string {
  const { ORG_ID: org, WORKSPACE_ID: ws, AUTOMATION_ID: auto, BASE_URL: base } = envs();
  const autoId = automationId || auto;
  const appUrl = base.replace("/api/v1", "");
  return `${appUrl}/organizations/${org}/workspaces/${ws}/automations/${autoId}/runs/${runId}`;
}

export async function req(path: string, options: RequestInit = {}): Promise<Response> {
  const { TOKEN, BASE_URL: base } = envs();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Automation invoke helpers                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse a single Kognitos typed output value into a plain JS value.
 * Handles text, bool_value, number (with decimal flags), and nested lists.
 */
export function parseOutputValue(v: Record<string, unknown>): unknown {
  if (typeof v.text === "string") return v.text;
  if (typeof v.bool_value === "boolean") return v.bool_value ? "true" : "false";
  if (v.number && typeof v.number === "object") {
    const n = v.number as { lo?: number; mid?: number; hi?: number; flags?: number };
    const scale = ((n.flags ?? 0) >> 16) & 0xff;
    return (n.lo ?? 0) / Math.pow(10, scale);
  }
  if (v.list && typeof v.list === "object") {
    const list = v.list as { items?: Array<Record<string, unknown>> };
    return (list.items ?? []).map((item) => parseOutputValue(item));
  }
  return v;
}

/**
 * Invoke a published Kognitos automation.
 * Returns the run ID for polling, or an error string.
 */
export async function invokeAutomation(
  automationId: string,
  inputs: Record<string, unknown>,
  stage: string = "AUTOMATION_STAGE_PUBLISHED",
): Promise<{ runId: string | null; error?: string }> {
  const { ORG_ID: org, WORKSPACE_ID: ws } = envs();
  const res = await req(
    `/organizations/${org}/workspaces/${ws}/automations/${automationId}:invoke`,
    {
      method: "POST",
      body: JSON.stringify({ inputs, stage }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    return { runId: null, error: `Invoke failed (${res.status}): ${text.slice(0, 300)}` };
  }

  const data = await res.json();
  const runId = data.run_id?.split("/runs/").pop() ?? null;
  return { runId };
}

export interface PollRunResult {
  status: "completed" | "failed" | "awaiting_guidance" | "timeout";
  outputs: Record<string, unknown>;
  error?: string;
  rawState?: unknown;
}

/**
 * Poll a Kognitos automation run until it reaches a terminal state or times out.
 * Returns parsed outputs on completion.
 */
export async function pollRun(
  automationId: string,
  runId: string,
  timeoutMs = 45_000,
  pollIntervalMs = 1500,
): Promise<PollRunResult> {
  const { ORG_ID: org, WORKSPACE_ID: ws } = envs();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const res = await req(
      `/organizations/${org}/workspaces/${ws}/automations/${automationId}/runs/${runId}`,
    );
    if (!res.ok) continue;

    const data = await res.json();

    if (data.state?.completed) {
      const rawOutputs = data.state.completed.outputs ?? {};
      const outputs: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(rawOutputs)) {
        outputs[key] = parseOutputValue(val as Record<string, unknown>);
      }
      return { status: "completed", outputs };
    }

    if (data.state?.failed) {
      return {
        status: "failed",
        outputs: {},
        error: data.state.failed.error?.description ?? "Run failed",
      };
    }

    if (data.state?.awaiting_guidance) {
      return {
        status: "awaiting_guidance",
        outputs: {},
        rawState: data.state.awaiting_guidance,
        error:
          data.state.awaiting_guidance.exception ??
          data.state.awaiting_guidance.description ??
          "Awaiting guidance",
      };
    }
  }

  return { status: "timeout", outputs: {}, error: "Run did not complete within timeout" };
}
