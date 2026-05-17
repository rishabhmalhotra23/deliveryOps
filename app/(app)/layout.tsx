import { AppShell } from "@/app/_components/app-shell";
import { getCurrentUser } from "@/lib/auth/server";

// Layout group for all "real product" pages — gives them the sidebar shell.
// Auth0 middleware redirects unauthenticated users at the edge; this layout
// just reads the already-validated user for the sidebar pill.
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <AppShell
      userEmail={user?.email ?? null}
      userPicture={user?.picture ?? null}
    >
      {children}
    </AppShell>
  );
}
