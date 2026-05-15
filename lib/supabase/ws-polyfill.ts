// Side-effect import: polyfills `globalThis.WebSocket` from the `ws` package
// when running in Node < 22 without a native WebSocket. supabase-js >= 2.105
// requires it for its realtime client, even when realtime isn't used —
// SupabaseClient's constructor eagerly initialises the realtime channel and
// fails fast otherwise.
//
// Browsers and Node >= 22 already have a global WebSocket, so this is a
// no-op there. Edge runtimes (Vercel Edge, Cloudflare) intentionally don't
// get a polyfill — supabase-js detects those separately.

import WebSocket from "ws";

if (typeof (globalThis as Record<string, unknown>).WebSocket === "undefined") {
  (globalThis as Record<string, unknown>).WebSocket = WebSocket;
}

export {};
