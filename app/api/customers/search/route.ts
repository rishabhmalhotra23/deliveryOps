import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const q = searchParams.get("q") ?? "";

  try {
    const sb = requireAdmin();
    let query = sb
      .from(TABLES.customers)
      .select("key, display_name, custom_category, ae_owner")
      .is("deleted_at", null)
      .order("display_name")
      .limit(limit);

    if (q.trim()) {
      query = query.ilike("display_name", `%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ customers: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed." },
      { status: 500 }
    );
  }
}
