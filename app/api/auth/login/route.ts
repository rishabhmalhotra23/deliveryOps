import { auth0 } from "@/lib/auth/auth0";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const returnTo = searchParams.get("returnTo") ?? "/dashboard";
  return auth0.startInteractiveLogin({ returnTo });
}
