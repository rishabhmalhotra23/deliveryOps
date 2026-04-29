import { req, ORG_ID, WORKSPACE_ID } from "./kognitos";
import { tableFromIPC } from "apache-arrow";

export interface SpyOutput {
  number?: number;
  text?: string;
  table?: Record<string, unknown>[];
  raw: unknown;
}

export interface SpyResult {
  outputs: Record<string, SpyOutput>;
  executionId?: string;
}

/**
 * Run inline code in the workspace and return parsed outputs.
 *
 * Pass `connections` when the code references external services
 * (e.g. SharePoint, Excel Online). Discover connection IDs from
 * the automation's `connections` field or the workspace connections list.
 */
export async function runSpy(
  code: string,
  connections?: Record<string, { connection_id: string }>
): Promise<SpyResult> {
  const conns = connections ?? {};

  const body: Record<string, unknown> = {
    start_execution: {
      organization_id: ORG_ID,
      workspace_id: WORKSPACE_ID,
      code,
      no_recording: {},
      ...(Object.keys(conns).length > 0 && { connections: conns }),
    },
  };

  const res = await req(
    `/organizations/${ORG_ID}/workspaces/${WORKSPACE_ID}/executions:run`,
    { method: "POST", body: JSON.stringify(body) }
  );

  if (!res.ok) {
    throw new Error(`Spy execution request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const status = data.execution_status;

  if (status?.failed) {
    const desc = status.failed.error?.description ?? JSON.stringify(status.failed);
    throw new Error(`Spy execution failed: ${desc}`);
  }

  if (!status?.completed) {
    throw new Error(`Unexpected execution status: ${JSON.stringify(status).slice(0, 500)}`);
  }

  const executionId = data.execution_id as string | undefined;
  const rawOutputs = (status.completed.outputs ?? {}) as Record<string, any>;
  const outputs: Record<string, SpyOutput> = {};

  for (const [key, val] of Object.entries(rawOutputs)) {
    outputs[key] = parseOutput(val);
  }

  return { outputs, executionId };
}

function parseOutput(val: any): SpyOutput {
  if (val.number != null) {
    return { number: val.number.lo ?? 0, raw: val };
  }
  if (val.text != null) {
    return { text: val.text, raw: val };
  }
  if (val.string != null) {
    return { text: val.string.text ?? val.string, raw: val };
  }
  const b64 = val.table?.inline?.data;
  if (b64) {
    const buf = Buffer.from(b64, "base64");
    const arrowTable = tableFromIPC(buf);
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < arrowTable.numRows; i++) {
      const row: Record<string, unknown> = {};
      for (const field of arrowTable.schema.fields) {
        row[field.name] = arrowTable.getChild(field.name)?.get(i);
      }
      rows.push(row);
    }
    return { table: rows, raw: val };
  }
  return { raw: val };
}
