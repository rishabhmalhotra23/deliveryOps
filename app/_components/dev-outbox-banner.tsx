import Link from "next/link";

import { gmailEnabled } from "@/lib/dev/mode";

// Shown on the NPS admin pages when Gmail isn't actually configured
// (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN unset) —
// sendEmail() silently routes to the dev outbox in that state, so this
// makes sure nobody mistakes a logged mock-send for a delivered email.
export function DevOutboxBanner() {
  if (gmailEnabled()) return null;

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2 flex-wrap">
      <span className="font-semibold">Dev outbox mode</span>
      <span>— Gmail isn&apos;t configured, so emails are logged but not actually delivered.</span>
      <Link href="/dev/outbox" className="underline font-medium">
        View the outbox →
      </Link>
    </div>
  );
}
