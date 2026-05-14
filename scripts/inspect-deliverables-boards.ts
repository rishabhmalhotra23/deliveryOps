// Inspect column schemas of the deliverables + related boards so we can
// design the extended sync.
import 'dotenv/config';
import * as fs from 'node:fs';

const env = '.env.local';
if (fs.existsSync(env)) require('dotenv').config({ path: env, override: true });

const BOARDS_TO_INSPECT = [
  { id: '18395281570', name: 'Projects (active)' },
  { id: '18398797267', name: 'FY-2026 Deliverables' },
  { id: '18398797224', name: 'FY-2025 Deliverables' },
  { id: '18398797248', name: 'FY-2024 Deliverables' },
  { id: '18398797257', name: 'FY-2023 Deliverables' },
  { id: '18398797301', name: 'Inactive / Cancelled' },
];

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

interface BoardInfo {
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
        column_values: Array<{ id: string; text: string | null; value: string | null }>;
      }>;
    };
  }>;
}

async function inspectBoard(boardId: string, boardName: string) {
  const d = await gql<BoardInfo>(
    `query($ids: [ID!]) {
      boards(ids: $ids) {
        id name
        columns { id title type }
        groups { id title }
        items_page(limit: 5) {
          items {
            id name
            group { title }
            column_values { id text value }
          }
        }
      }
    }`,
    { ids: [boardId] }
  );
  
  const b = d.boards?.[0];
  if (!b) { console.log(`\n${boardName}: NOT FOUND`); return; }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Board: ${boardName} (${boardId})`);
  console.log(`Groups: ${b.groups.map(g => g.title).join(', ')}`);
  console.log(`\nColumns (${b.columns.length}):`);
  for (const c of b.columns) {
    console.log(`  ${c.id.padEnd(30)} ${c.type.padEnd(20)} ${c.title}`);
  }
  
  console.log(`\nSample items (${b.items_page.items.length}):`);
  for (const it of b.items_page.items) {
    console.log(`\n  [${it.group.title}] ${it.name}`);
    for (const cv of it.column_values) {
      if (cv.text && cv.text.trim() && cv.text.length < 120) {
        const col = b.columns.find(c => c.id === cv.id);
        console.log(`    ${(col?.title ?? cv.id).padEnd(28)} = ${cv.text}`);
      }
    }
  }
}

async function main() {
  for (const board of BOARDS_TO_INSPECT) {
    await inspectBoard(board.id, board.name);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
