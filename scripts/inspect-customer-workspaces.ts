// Inspect Account Overview boards + Projects Portfolio + missing customer workspaces.
import 'dotenv/config';
import * as fs from 'node:fs';

const env = '.env.local';
if (fs.existsSync(env)) require('dotenv').config({ path: env, override: true });

async function gql<T>(q: string, vars: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: process.env.MONDAY_API_TOKEN!,
      'Content-Type': 'application/json',
      'API-Version': '2024-04'
    },
    body: JSON.stringify({ query: q, variables: vars })
  });
  const d = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (d.errors) throw new Error(d.errors[0].message);
  return d.data!;
}

interface BoardSchema {
  boards: Array<{
    id: string;
    name: string;
    columns: Array<{ id: string; title: string; type: string }>;
    groups: Array<{ id: string; title: string }>;
    items_page: {
      items: Array<{
        id: string;
        name: string;
        group: { title: string };
        column_values: Array<{ id: string; text: string | null }>;
      }>;
    };
  }>;
}

async function inspectBoard(boardId: string, label: string) {
  const d = await gql<BoardSchema>(
    `query($ids: [ID!]) {
      boards(ids: $ids) {
        id name
        columns { id title type }
        groups { id title }
        items_page(limit: 8) {
          items {
            id name
            group { title }
            column_values { id text }
          }
        }
      }
    }`,
    { ids: [boardId] }
  );
  const b = d.boards?.[0];
  if (!b) { console.log(`\n${label}: NOT FOUND`); return; }
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${label} → ${b.name} (${boardId})`);
  console.log(`Groups: ${b.groups.map(g => g.title).join(' | ')}`);
  console.log(`Columns (${b.columns.length}):`);
  for (const c of b.columns) {
    console.log(`  ${c.id.padEnd(28)} ${c.type.padEnd(18)} ${c.title}`);
  }
  console.log(`Sample items (${b.items_page.items.length}):`);
  for (const it of b.items_page.items) {
    const vals = it.column_values.filter(cv => cv.text && cv.text.trim() && cv.text.length < 100);
    if (vals.length === 0) continue;
    console.log(`\n  [${it.group.title}] ${it.name}`);
    for (const cv of vals) {
      const col = b.columns.find(c => c.id === cv.id);
      console.log(`    ${(col?.title ?? cv.id).padEnd(30)} = ${cv.text}`);
    }
  }
}

// Fetch boards for customer workspaces not in our earlier results
interface WorkspaceBoards {
  boards: Array<{
    id: string;
    name: string;
    state: string;
    items_count: number | null;
    workspace: { id: string; name: string } | null;
  }>;
}

async function getBoardsForWorkspace(wsId: string): Promise<WorkspaceBoards['boards']> {
  // Monday doesn't have a workspace-filtered boards query directly, but we can
  // filter by workspace_ids in the boards query
  const d = await gql<WorkspaceBoards>(
    `query($wsIds: [ID!]) {
      boards(workspace_ids: $wsIds, limit: 50, order_by: used_at) {
        id name state items_count workspace { id name }
      }
    }`,
    { wsIds: [wsId] }
  );
  return d.boards ?? [];
}

async function main() {
  // 1. Inspect Projects Overview (Projects Portfolio workspace)
  await inspectBoard('6073051226', 'Projects Portfolio → Projects Overview');

  // 2. Inspect Account Overview boards from the customer workspaces we found
  const accountOverviewBoards = [
    { id: '8025567789', label: 'Century Account Overview' },
    { id: '8026250567', label: 'Paysafe Account Overview' },
    { id: '8026290389', label: 'Norco Account Overview' },
    { id: '8026180924', label: 'Pepsi Account Overview' },
    { id: '8026036781', label: 'TTX Account Overview' },
    { id: '8025449690', label: 'Airborne Account Overview' },
  ];
  for (const b of accountOverviewBoards) {
    await inspectBoard(b.id, b.label);
  }

  // 3. Discover boards in customer workspaces we haven't looked at yet
  const customerWorkspaceIds = [
    '8906655',  // JBI
    '8907669',  // Wipro FSS
    '9423739',  // Wipro BPS
    '8906667',  // Odyssey
    '8906669',  // Ciena
    '9387378',  // Hwy Haul
    '11058484', // GreenDot
    '11886452', // Ozark River
    '11911860', // Kort Payments
    '11986648', // Bradley & Beams
    '11997938', // CSA Transport
    '11943062', // SCAN
  ];

  console.log('\n\n=== Customer workspace boards (batch) ===');
  for (const wsId of customerWorkspaceIds) {
    const boards = await getBoardsForWorkspace(wsId);
    if (boards.length === 0) continue;
    const wsName = boards[0]?.workspace?.name ?? wsId;
    console.log(`\nWorkspace: ${wsName}`);
    for (const b of boards.filter(b => !b.name.startsWith('Subitems'))) {
      const cnt = (b.items_count ?? 0).toString().padStart(4);
      const flag = b.state !== 'active' ? ` [${b.state}]` : '';
      console.log(`  ${b.id.padEnd(18)} ${cnt}  ${b.name}${flag}`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
