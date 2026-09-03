import { redirect } from "next/navigation";

// V2 Migration is no longer its own page — it's the "V2 migration" section
// inside Delivery, over the same `processes` rows. This redirect keeps
// existing links and bookmarks working.
// See CLAUDE-CODE-PROMPT.md / 2026-09-03-v2-delivery-redesign.html.
export default function V2MigrationRedirect() {
  redirect("/delivery?section=v2");
}
