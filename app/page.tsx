import { redirect } from "next/navigation";

// Send root traffic into the dashboard. The /dashboard route lives in the
// (app) layout group so it picks up the sidebar shell.
export default function RootRedirect(): never {
  redirect("/dashboard");
}
