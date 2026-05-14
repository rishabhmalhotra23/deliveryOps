import 'dotenv/config';
import * as fs from 'node:fs';

const env = '.env.local';
if (fs.existsSync(env)) require('dotenv').config({ path: env, override: true });

async function gql(q: string) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 
      Authorization: process.env.MONDAY_API_TOKEN!, 
      'Content-Type': 'application/json', 
      'API-Version': '2024-04' 
    },
    body: JSON.stringify({ query: q })
  });
  const d = await res.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (d.errors) throw new Error(d.errors[0].message);
  return d.data;
}

async function main() {
  const d = await gql(`query {
    boards(limit: 80, order_by: used_at) {
      id name description state items_count updated_at workspace { id name }
    }
  }`) as { boards: Array<{ id: string; name: string; state: string; items_count: number | null; workspace: { name: string } | null; description: string | null }> };

  console.log('\n=== All Monday boards ===\n');
  for (const b of d.boards) {
    const ws = (b.workspace?.name ?? '?').padEnd(32);
    const id = b.id.padEnd(18);
    const cnt = (b.items_count?.toString() ?? '?').padStart(5);
    const flag = b.state !== 'active' ? `[${b.state}]` : '';
    console.log(`${ws} ${id} ${cnt}  ${b.name} ${flag}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
