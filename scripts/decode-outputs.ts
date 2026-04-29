import { req, ORG_ID, WORKSPACE_ID } from "../lib/kognitos";
import { tableFromIPC } from "apache-arrow";

const AUTOMATION_ID = process.env.KOGNITOS_AUTOMATION_ID!;

interface RunOutput {
  table?: { inline?: { data?: string } };
  scalar?: unknown;
  file?: unknown;
}

interface RunState {
  completed?: { outputs?: Record<string, RunOutput> };
  awaiting_guidance?: { exception?: string; description?: string };
  failed?: { error?: string };
}

function decodeArrowIPC(b64: string) {
  const buf = Buffer.from(b64, "base64");
  return tableFromIPC(buf);
}

async function main() {
  const runsPath = `/organizations/${ORG_ID}/workspaces/${WORKSPACE_ID}/automations/${AUTOMATION_ID}/runs?pageSize=20`;
  const runsRes = await req(runsPath);
  const runsData = (await runsRes.json()) as { runs: Array<{ name: string; state: RunState; create_time: string }> };
  const runs = runsData.runs ?? [];

  const completedRun = runs.find((r) => r.state.completed);
  if (!completedRun) {
    console.error("No completed runs found.");
    process.exit(1);
  }

  const runId = completedRun.name.split("/").pop()!;
  console.log(`Using completed run: ${runId}`);
  console.log(`Created: ${completedRun.create_time}\n`);

  const outputs = completedRun.state.completed!.outputs ?? {};

  for (const [name, output] of Object.entries(outputs)) {
    console.log("=".repeat(60));
    console.log(`OUTPUT: ${name}`);
    console.log("=".repeat(60));

    const b64 = output.table?.inline?.data;
    if (b64) {
      const table = decodeArrowIPC(b64);
      console.log(`  Rows: ${table.numRows}`);
      console.log(`  Columns: ${table.numCols}\n`);

      console.log("  Schema:");
      for (let i = 0; i < table.schema.fields.length; i++) {
        const f = table.schema.fields[i];
        console.log(`    ${String(i + 1).padStart(2)}. ${f.name.padEnd(45)} ${f.type}`);
      }
      console.log();

      if (table.numRows > 0) {
        const sampleRows = Math.min(3, table.numRows);
        console.log(`  Sample data (first ${sampleRows} rows):`);
        for (let r = 0; r < sampleRows; r++) {
          const row: Record<string, unknown> = {};
          for (const field of table.schema.fields) {
            const col = table.getChild(field.name);
            row[field.name] = col?.get(r);
          }
          console.log(`    Row ${r + 1}:`, JSON.stringify(row, null, 2).split("\n").join("\n    "));
        }
      } else {
        console.log("  (empty table — no rows)");
      }
    } else {
      console.log(`  Raw shape:`, JSON.stringify(output, null, 2).slice(0, 500));
    }
    console.log();
  }

  const guidanceRun = runs.find((r) => r.state.awaiting_guidance);
  if (guidanceRun) {
    const gRunId = guidanceRun.name.split("/").pop()!;
    console.log("=".repeat(60));
    console.log(`AWAITING GUIDANCE RUN: ${gRunId}`);
    console.log("=".repeat(60));
    const ag = guidanceRun.state.awaiting_guidance!;
    console.log(`  Exception ref: ${ag.exception ?? "none"}`);
    console.log(`  Description: ${ag.description ?? "none"}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
