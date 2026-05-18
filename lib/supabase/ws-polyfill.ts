// WebSocket polyfill for Node 18/20 running supabase-js >= 2.105.
// Node 22+ has a native WebSocket; older versions do not.
// Import this as a side-effect at the top of tsx scripts:
//   import "@/lib/supabase/ws-polyfill";
//
// Not needed in Next.js server routes — the Node runtime there is Node 20+
// with the polyfill handled by the build pipeline.

import WebSocket from "ws";

if (typeof (globalThis as Record<string, unknown>).WebSocket === "undefined") {
  (globalThis as Record<string, unknown>).WebSocket = WebSocket;
}

export {};
