import { AppShell } from "@/app/_components/app-shell";
import { getCurrentUser } from "@/lib/auth/server";

// Layout group for all the "real product" pages — gives them a sidebar and
// top bar. /dev/* pages stay in the older lightweight layout.
//
// Auth: middleware redirects unauthenticated users at the edge. This layout
// just reads the (already-validated) user for the sidebar pill. If somebody
// reaches here unauthenticated (e.g. Supabase down), getCurrentUser returns
// null and we render a no-pill shell rather than crash — the middleware will
// catch the next request.
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return <AppShell userEmail={user?.email ?? null}>{children}</AppShell>;
}
