import { AppShell } from "@/app/_components/app-shell";

// Layout group for all the "real product" pages — gives them a sidebar and
// top bar. /dev/* pages stay in the older lightweight layout.
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
