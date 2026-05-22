// Print a clear warning at the top of every write-script run that says
// which Supabase URL we're about to hit.  Catches the
// 2026-05-22-style "scripts hit local Docker Supabase but user is
// looking at cloud Vercel" silent divergence.
//
// Call this from the top of any script that writes to the database.

const PROD_HOSTS = ["prnakdaxcpzagntgvaqf.supabase.co"];

export function logSupabaseTarget(scriptName: string): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(unset)";
  const isLocal = url.includes("127.0.0.1") || url.includes("localhost");
  const isProd = PROD_HOSTS.some((h) => url.includes(h));
  const tag = isLocal ? "LOCAL DOCKER" : isProd ? "CLOUD PROD" : "UNKNOWN";

  const banner = `[${scriptName}] target Supabase: ${tag} — ${url}`;
  if (isLocal) {
    console.log("─".repeat(banner.length));
    console.log(banner);
    console.log("─".repeat(banner.length));
  } else {
    // Loud red box for any non-local target so cloud writes are
    // visually distinct from local-dev runs.
    console.log("");
    console.log("╔" + "═".repeat(banner.length + 2) + "╗");
    console.log(`║ ${banner} ║`);
    console.log("╚" + "═".repeat(banner.length + 2) + "╝");
    console.log("");
  }
}
