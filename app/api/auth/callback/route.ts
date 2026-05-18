// OAuth callback — Auth0 sends the user here after login.
// auth0.middleware() handles the code exchange and session creation.

import { auth0 } from "@/lib/auth/auth0";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return auth0.middleware(req);
}
