import { NextResponse } from "next/server";
import { supabaseAdmin, TABLES } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json({ sessions: [] });
  }
  const { data, error } = await supabaseAdmin
    .from(TABLES.sessions)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data });
}

export async function POST() {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const { data, error } = await supabaseAdmin
    .from(TABLES.sessions)
    .insert({ title: "" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
