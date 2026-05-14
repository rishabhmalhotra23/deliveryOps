// Discover all Monday workspaces and boards — including per-customer workspaces
// with Account Overview boards and the Projects Portfolio.
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

interface Workspace {
  id: string;
  name: string;
  kind: string;
  description: string | null;
}

interface Board {
  id: string;
  name: string;
  state: string;
  items_count: number | null;
  workspace: { id: string; name: string } | null;
}

async function main() {
  // Get all workspaces
  const wsData = await gql<{ workspaces: Workspace[] }>(
    `query { workspaces(limit: 100) { id name kind description } }`
  );
  console.log('\n=== All Workspaces ===\n');
  for (const w of wsData.workspaces) {
    console.log(`  ${w.id.padEnd(16)} [${w.kind.padEnd(8)}]  ${w.name}`);
  }

  // Get ALL boards across all workspaces (paginate if needed)
  const boardData = await gql<{ boards: Board[] }>(
    `query($limit: Int!) {
      boards(limit: $limit, order_by: used_at) {
        id name state items_count workspace { id name }
      }
    }`,
    { limit: 200 }
  );

  // Group by workspace
  const byWs = new Map<string, { name: string; boards: Board[] }>();
  for (const b of boardData.boards) {
    const wsId = b.workspace?.id ?? 'unknown';
    const wsName = b.workspace?.name ?? 'Unknown';
    if (!byWs.has(wsId)) byWs.set(wsId, { name: wsName, boards: [] });
    byWs.get(wsId)!.boards.push(b);
  }

  console.log('\n=== Boards by Workspace ===\n');
  for (const [wsId, ws] of byWs.entries()) {
    // Flag workspaces that look like customer workspaces
    const isCustomer = !['Main workspace', 'Delivery Planning', 'Projects Portfolio', 'KogBizOps'].includes(ws.name);
    console.log(`\nWorkspace: ${ws.name} (${wsId})${isCustomer ? '  ← CUSTOMER' : ''}`);
    for (const b of ws.boards) {
      const flag = b.state !== 'active' ? `[${b.state}]` : '';
      const cnt = (b.items_count ?? 0).toString().padStart(4);
      console.log(`  ${b.id.padEnd(18)} ${cnt}  ${b.name} ${flag}`);
    }
  }

  // Specifically find boards named "Account Overview" or similar
  const accountBoards = boardData.boards.filter(b => 
    b.name.toLowerCase().includes('account') || 
    b.name.toLowerCase().includes('overview') ||
    b.name.toLowerCase().includes('portfolio')
  );
  console.log('\n=== Account / Overview / Portfolio boards ===');
  for (const b of accountBoards) {
    console.log(`  ${b.id.padEnd(18)} ${(b.items_count ?? 0).toString().padStart(4)}  [${b.workspace?.name}]  ${b.name}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
