// Map Monday customer workspaces to customers table.
// Fetches all workspaces, matches by name to customer display_name,
// and updates monday_workspace_id + discovers Account Overview board IDs.
//
// Run: npx tsx scripts/map-customer-workspaces.ts

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

const envLocal = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocal)) require('dotenv').config({ path: envLocal, override: true });

import { createClient } from '@supabase/supabase-js';
import { normalizeName } from '@/lib/import/monday-customers';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

// Non-customer workspaces to skip
const SKIP_WORKSPACES = new Set([
  'Main workspace', 'Delivery Planning', 'Projects Portfolio',
  'KogBizOps', 'Marketing', 'Marketing HQ', 'General',
  'Project Management Hub', 'Kognitos Enablement',
  'Rishabh Malhotra Vibes',
]);

async function main() {
  // Fetch all workspaces
  const wsData = await gql<{ workspaces: Array<{ id: string; name: string }> }>(
    `query { workspaces(limit: 100) { id name } }`
  );

  // Fetch all customers
  const { data: customers } = await sb
    .from('customers')
    .select('id, key, display_name, monday_workspace_id')
    .is('deleted_at', null);

  const customerList = (customers ?? []) as Array<{
    id: string; key: string; display_name: string; monday_workspace_id: string | null;
  }>;

  console.log(`\nFetched ${wsData.workspaces.length} workspaces, ${customerList.length} customers.\n`);

  // Match workspace → customer by display name
  const updates: Array<{ customerId: string; displayName: string; wsId: string; wsName: string }> = [];
  const unmatched: string[] = [];

  for (const ws of wsData.workspaces) {
    if (SKIP_WORKSPACES.has(ws.name)) continue;

    const wsNorm = normalizeName(ws.name);
    let matched = customerList.find(
      c => c.display_name.toLowerCase() === ws.name.toLowerCase()
    );
    if (!matched) {
      matched = customerList.find(c => normalizeName(c.display_name) === wsNorm);
    }
    if (!matched) {
      // Partial: workspace name is prefix of (or contained in) customer name
      matched = customerList.find(c => {
        const cn = normalizeName(c.display_name);
        return cn.startsWith(wsNorm) || wsNorm.startsWith(cn);
      });
    }

    if (matched) {
      updates.push({ customerId: matched.id, displayName: matched.display_name, wsId: ws.id, wsName: ws.name });
    } else {
      // Could be a test/sandbox/POV workspace
      if (ws.name.length > 3) unmatched.push(`  ${ws.id.padEnd(14)} ${ws.name}`);
    }
  }

  console.log(`Matched ${updates.length} workspace → customer pairs:`);
  for (const u of updates) {
    const tag = u.wsId === customerList.find(c => c.id === u.customerId)?.monday_workspace_id ? ' (already set)' : '';
    console.log(`  ${u.wsName.padEnd(28)} → ${u.displayName}${tag}`);
  }

  if (unmatched.length > 0) {
    console.log(`\nUnmatched workspaces (${unmatched.length}):`);
    for (const u of unmatched) console.log(u);
  }

  // Apply updates
  let updated = 0;
  for (const u of updates) {
    const existing = customerList.find(c => c.id === u.customerId);
    if (existing?.monday_workspace_id === u.wsId) continue; // already set
    const { error } = await sb
      .from('customers')
      .update({ monday_workspace_id: u.wsId })
      .eq('id', u.customerId);
    if (error) {
      console.error(`Failed to update ${u.displayName}: ${error.message}`);
    } else {
      updated++;
    }
  }
  console.log(`\nUpdated monday_workspace_id for ${updated} customers.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
