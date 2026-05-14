import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// GET /api/monday/item-updates?item_id=XXX
// Fetches the most recent updates (comments/notes) for a Monday item.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const itemId = url.searchParams.get("item_id");
  if (!itemId) {
    return NextResponse.json({ error: "Missing item_id." }, { status: 400 });
  }

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ updates: [] });
  }

  try {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "API-Version": "2024-04",
      },
      body: JSON.stringify({
        query: `query($ids: [ID!]) {
          items(ids: $ids) {
            id
            name
            updates(limit: 10) {
              id
              body
              created_at
              creator {
                name
              }
            }
          }
        }`,
        variables: { ids: [itemId] },
      }),
    });

    const data = await res.json() as {
      data?: {
        items?: Array<{
          updates?: Array<{
            id: string;
            body: string;
            created_at: string;
            creator?: { name: string };
          }>;
        }>;
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      throw new Error(data.errors[0].message);
    }

    const updates = data.data?.items?.[0]?.updates ?? [];
    // Strip HTML tags from body
    const cleaned = updates.map((u) => ({
      id: u.id,
      body: u.body?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "",
      created_at: u.created_at,
      author: u.creator?.name ?? "—",
    })).filter((u) => u.body.length > 0);

    return NextResponse.json({ updates: cleaned });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch updates." },
      { status: 500 }
    );
  }
}
