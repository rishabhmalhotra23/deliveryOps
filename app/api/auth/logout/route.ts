// Auth0 v4 logout. The middleware() method handles /api/auth/logout natively
// and returns a proper redirect response (to Auth0's OIDC logout endpoint),
// NOT NextResponse.next() — so it's safe to call here unlike login.

import { auth0 } from "@/lib/auth/auth0";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return auth0.middleware(req);
}
