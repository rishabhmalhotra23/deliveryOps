// Post per-customer updates to the Monday "Customers" board. The raw
// Slack updates Rishabh shared with Neeraj on 2026-05-21 are polished
// into professional versions below and posted via Monday's
// `create_update` mutation.
//
// Usage:
//   npx tsx scripts/monday-post-updates.ts             # dry-run (no writes)
//   npx tsx scripts/monday-post-updates.ts --apply     # post the updates

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs") as typeof import("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path") as typeof import("node:path");
const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: envLocal, override: true });
}

interface UpdateEntry {
  customerKey: string;
  /** Friendly tag used in the Slack message for context. */
  tag: "Upsell Potential" | "New Deal" | "Flat Renewal";
  body: string;
}

const UPDATES: UpdateEntry[] = [
  {
    customerKey: "dish-ecostar",
    tag: "Upsell Potential",
    body: `Engagement is strong — Arushi is running regular office hours with the team, and they're now building automations on v2 themselves. Renewal is on solid ground and upsell potential is real; we'll firm up the expansion path at the next office hours session.`,
  },
  {
    customerKey: "iheartradio",
    tag: "Upsell Potential",
    body: `Process map is in place and the customer team has initial access. Conversations have moved into Binny + Rajesh's track for the next round of scoping. Renewal is solid; net-new scope is in active discussion.`,
  },
  {
    customerKey: "jbi",
    tag: "Upsell Potential",
    body: `Joint call scheduled with Kurt and Ken next week. Process count is low — driven by latency on their side, not ours — and they're actively asking about next steps. No renewal risk; expansion is the upside.`,
  },
  {
    customerKey: "kort-payments",
    tag: "Flat Renewal",
    body: `Testing is on track. Adam is out of office, so we're waiting on Sasha's team for production access. In parallel, Karthik and Sasha are building the equivalent capability on v2 — if that lands before their target system is ready, we'll go-live on v2 instead. No AE assigned yet (CSM is driving). Flat renewal is the working assumption; upsell conversation is on hold until go-live lands.`,
  },
  {
    customerKey: "mitie",
    tag: "New Deal",
    body: `Rajesh and Binny are aligned with the customer — this is a done deal. Closing paperwork next.`,
  },
  {
    customerKey: "ozark-river",
    tag: "Upsell Potential",
    body: `No renewal risk. New processes are being added with Arushi supporting the customer side. Alrazi has been introduced as the AE and is now taking over commercial discussions.`,
  },
  {
    customerKey: "pepsi",
    tag: "New Deal",
    body: `Binny and Rushil are running the engagement. Ayush has delivered the demo and the follow-on processes the team requested. Net-new motion is healthy and progressing on track.`,
  },
  {
    customerKey: "conectiv",
    tag: "Upsell Potential",
    body: `SME is on vacation, so UAT is paused until they're back. Once sign-off lands we go-live and start the upsell conversation with Dimitry — Binny is already engaged on that thread.`,
  },
  {
    customerKey: "wipro-fss",
    tag: "New Deal",
    body: `Binny and Rajesh are running the engagement. A high volume of enhancements and change requests has landed in recent weeks — strong velocity on net-new scope.`,
  },
];

async function main() {
  const apply = process.argv.includes("--apply");

  const { listCustomers } = await import("@/lib/customers");
  const { gql } = await import("@/lib/integrations/monday");

  const allCustomers = await listCustomers();
  const byKey = new Map(allCustomers.map((c) => [c.key, c]));

  // Resolve every update against an actual customer + Monday item_id.  If
  // anything's missing, we surface it loudly so we can fix the key map
  // before posting.
  const resolved: Array<{
    customerKey: string;
    displayName: string;
    mondayItemId: string;
    tag: UpdateEntry["tag"];
    body: string;
  }> = [];
  const missing: Array<{ customerKey: string; reason: string }> = [];

  for (const u of UPDATES) {
    const c = byKey.get(u.customerKey);
    if (!c) {
      missing.push({ customerKey: u.customerKey, reason: "customer not found in DeliveryOps" });
      continue;
    }
    if (!c.monday_item_id) {
      missing.push({ customerKey: u.customerKey, reason: "no Monday item_id on customer row" });
      continue;
    }
    resolved.push({
      customerKey: c.key,
      displayName: c.display_name,
      mondayItemId: c.monday_item_id,
      tag: u.tag,
      body: u.body,
    });
  }

  console.log(`Updates to post: ${resolved.length}`);
  console.log("");
  for (const r of resolved) {
    console.log(`  • ${r.displayName.padEnd(20)} [${r.tag}]`);
    console.log(`      Monday item_id: ${r.mondayItemId}`);
    console.log(`      ${r.body.slice(0, 100)}${r.body.length > 100 ? "…" : ""}`);
    console.log("");
  }
  if (missing.length > 0) {
    console.log("Missing — these won't post:");
    for (const m of missing) {
      console.log(`  • ${m.customerKey}: ${m.reason}`);
    }
    console.log("");
  }

  if (!apply) {
    console.log("Dry-run.  Re-run with --apply to post the updates.");
    return;
  }

  console.log("Posting…");
  for (const r of resolved) {
    // Monday "Updates" support markdown-style links/lists via plain text +
    // line breaks.  We prepend a short header so the update is scannable
    // in the activity feed.
    const body = `**${r.tag}** — DeliveryOps update (${new Date().toISOString().slice(0, 10)})\n\n${r.body}`;
    try {
      type CreateUpdateResp = { create_update: { id: string } };
      const res = await gql<CreateUpdateResp>(
        `mutation ($itemId: ID!, $body: String!) {
          create_update(item_id: $itemId, body: $body) { id }
        }`,
        { itemId: r.mondayItemId, body }
      );
      console.log(`  ✓ ${r.displayName} — update id ${res.create_update.id}`);
    } catch (err) {
      console.error(
        `  ✗ ${r.displayName} — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
