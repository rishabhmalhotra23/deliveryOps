// Single catch-all route that handles all Auth0 flows:
//   GET /api/auth/login    → redirects to Auth0 Universal Login
//   GET /api/auth/logout   → clears session + redirects to Auth0 logout
//   GET /api/auth/callback → exchanges code for session after login
//
// In Auth0 v4, auth0.middleware() handles all three paths when mounted
// as a catch-all route handler.

import { auth0 } from "@/lib/auth/auth0";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  return auth0.middleware(req);
}

export async function POST(req: NextRequest) {
  return auth0.middleware(req);
}
