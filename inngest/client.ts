import { Inngest } from "inngest";

// In dev (no INNGEST_EVENT_KEY), the SDK auto-connects to the Inngest Dev
// Server at http://localhost:8288 — no cloud account needed. Run
// `npm run inngest:dev` in a second terminal to start it.
export const inngest = new Inngest({
  id: "delivery-ops",
  isDev: !process.env.INNGEST_EVENT_KEY,
});
