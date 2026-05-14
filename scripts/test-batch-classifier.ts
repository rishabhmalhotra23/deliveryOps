// End-to-end test of the Message Batches API plumbing:
// builds three classifier requests, submits as a batch, polls until the
// batch ends, and prints the results.
//
// Run: npx tsx scripts/test-batch-classifier.ts

import * as fs from "node:fs";
import * as path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config();
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

async function main() {
  const { submitBatch, getBatchStatus, collectResults, extractText } = await import("@/lib/agent/batch");
  const { buildClassifyBatchRequests, parseCategory } = await import("@/lib/ingestion/classifier");

  const reuseBatchId = process.argv[2];

  const items = [
    {
      customId: "doc-1",
      filename: "Q3 Renewal MSA — DraftStar Inc.pdf",
      markdown:
        "MASTER SERVICES AGREEMENT\n\nThis Master Services Agreement is entered into between DraftStar Inc. and Acme Corp on October 1, 2025...\n\nFees: $120,000 per year. Term: 12 months. Renewal: automatic unless 60 days notice...",
    },
    {
      customId: "doc-2",
      filename: "Weekly cadence — Norco — 2025-11-04.docx",
      markdown:
        "Attendees: Rishabh, Karthik, Norco team.\nAgenda:\n1. Warranty automation status — on track for M2.\n2. New use case proposed: claims triage.\nAction items:\n- Karthik: draft SOP by Friday.\n- Rishabh: schedule follow-up.",
    },
    {
      customId: "doc-3",
      filename: "How to onboard a new field — Kort Payments.md",
      markdown:
        "# Adding a new field to Kort Payments dashboard\n\nStep 1: Open the Kognitos workspace.\nStep 2: Navigate to the dashboard automation.\nStep 3: Add the new column to the input table.\nStep 4: Save and republish.",
    },
  ];

  let batchId: string;
  if (reuseBatchId) {
    batchId = reuseBatchId;
    console.log(`Reusing existing batch: ${batchId}`);
  } else {
    console.log(`Submitting batch of ${items.length} classifier requests…`);
    const reqs = buildClassifyBatchRequests(items);
    const submitted = await submitBatch(reqs);
    batchId = submitted.batchId;
    console.log(`Batch submitted: ${batchId}\n`);

    console.log("Polling until ended…");
    while (true) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await getBatchStatus(batchId);
      process.stdout.write(
        `  status=${s.status} succeeded=${s.counts.succeeded}/${items.length} errored=${s.counts.errored} processing=${s.counts.processing}\n`
      );
      if (s.status === "ended") break;
    }
  }

  console.log("\nResults:");
  const results = await collectResults(batchId);
  for (const r of results) {
    if (r.status === "succeeded") {
      const text = extractText(r);
      const cat = text ? parseCategory(text) : "other";
      console.log(`  ✓ ${r.customId.padEnd(8)} → ${cat}`);
    } else {
      console.log(`  ✗ ${r.customId.padEnd(8)} → ${r.status}: ${r.error?.message ?? ""}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
