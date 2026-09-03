import { redirect } from "next/navigation";

// The detail panel shows `/processes/<id>` as a permalink and the row menu's
// "Copy link" copies it — but no such route existed, so both handed out a
// 404. A process isn't a standalone page (it's a panel over the workspace),
// so this resolves to the workspace with that record open.
export default async function ProcessPermalink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/delivery?open=${encodeURIComponent(id)}`);
}
