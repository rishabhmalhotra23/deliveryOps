// Salesforce sync — for every customer with salesforce_account_id mapped,
// pull the Account + Opportunities + Cases and write them into the cache
// tables (sf_accounts / sf_opportunities / sf_cases).
//
// Designed to be cheap: ~3 SOQL queries per customer. With 40 customers and
// SF rate limits, this comfortably fits in a single Inngest run.

import { requireAdmin } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/customers";
import {
  getAccount,
  listOpportunities,
  listCases,
  type SfAccount,
  type SfOpportunity,
  type SfCase,
} from "@/lib/integrations/salesforce";

export interface SalesforceSyncResult {
  customers_synced: number;
  accounts: number;
  opportunities: number;
  cases: number;
  errors: Array<{ customer_key: string; error: string }>;
}

export async function syncSalesforce(opts: { customerKey?: string } = {}): Promise<SalesforceSyncResult> {
  const sb = requireAdmin();
  const allCustomers = await listCustomers();
  const customers = opts.customerKey
    ? allCustomers.filter((c) => c.key === opts.customerKey)
    : allCustomers.filter((c) => c.salesforce_account_id);

  const result: SalesforceSyncResult = {
    customers_synced: 0,
    accounts: 0,
    opportunities: 0,
    cases: 0,
    errors: [],
  };

  for (const customer of customers) {
    if (!customer.salesforce_account_id) continue;
    const sfId = customer.salesforce_account_id;
    try {
      const [account, opportunities, cases] = await Promise.all([
        getAccount(sfId),
        listOpportunities({ accountId: sfId, limit: 100 }).catch(() => []),
        listCases({ accountId: sfId, limit: 100, openOnly: false }).catch(() => []),
      ]);

      // 1. Upsert account
      if (account) {
        await sb
          .from("sf_accounts")
          .upsert(toAccountRow(customer.id, account), { onConflict: "sf_id" });
        result.accounts++;
      }

      // 2. Replace opportunities for this customer
      await sb.from("sf_opportunities").delete().eq("customer_id", customer.id);
      if (opportunities.length > 0) {
        await sb.from("sf_opportunities").insert(opportunities.map((o) => toOppRow(customer.id, o)));
        result.opportunities += opportunities.length;
      }

      // 3. Replace cases for this customer
      await sb.from("sf_cases").delete().eq("customer_id", customer.id);
      if (cases.length > 0) {
        await sb.from("sf_cases").insert(cases.map((c) => toCaseRow(customer.id, c)));
        result.cases += cases.length;
      }

      result.customers_synced++;
    } catch (err) {
      result.errors.push({
        customer_key: customer.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

function toAccountRow(customerId: string, a: SfAccount) {
  return {
    customer_id: customerId,
    sf_id: a.Id,
    name: a.Name,
    industry: a.Industry,
    type: a.Type,
    annual_revenue: a.AnnualRevenue,
    number_of_employees: a.NumberOfEmployees,
    website: a.Website,
    phone: a.Phone,
    billing_city: a.BillingCity,
    billing_country: a.BillingCountry,
    owner_name: a.Owner?.Name ?? null,
    sf_created_at: a.CreatedDate,
    sf_updated_at: a.LastModifiedDate,
    raw: a as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

function toOppRow(customerId: string, o: SfOpportunity) {
  return {
    customer_id: customerId,
    sf_id: o.Id,
    account_sf_id: o.AccountId,
    name: o.Name,
    stage_name: o.StageName,
    amount: o.Amount,
    close_date: o.CloseDate,
    probability: o.Probability,
    is_closed: o.IsClosed,
    is_won: o.IsWon,
    owner_name: o.Owner?.Name ?? null,
    sf_updated_at: o.LastModifiedDate,
    raw: o as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

function toCaseRow(customerId: string, c: SfCase) {
  return {
    customer_id: customerId,
    sf_id: c.Id,
    case_number: c.CaseNumber,
    account_sf_id: c.AccountId,
    subject: c.Subject,
    status: c.Status,
    priority: c.Priority,
    origin: c.Origin,
    is_closed: c.IsClosed,
    sf_created_at: c.CreatedDate,
    sf_updated_at: c.LastModifiedDate,
    raw: c as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}
