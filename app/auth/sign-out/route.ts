import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const dynamic = "force-dynamic";

async function signOut(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "?message=Signed%20out.";
  let response = NextResponse.redirect(url);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return response;

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set({ name, value, ...(options as CookieOptions) });
        }
      },
    },
  });

  await supabase.auth.signOut();
  return response;
}

export const GET = signOut;
export const POST = signOut;
