import type Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/types";
import { listCustomers } from "@/lib/customers";
import { streamAgent } from "@/lib/agent/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PostBody {
  sessionId: string;
  message: string;
  customerKey?: string;
}

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { sessionId, message } = body;
  if (!sessionId || !message) {
    return NextResponse.json({ error: "Missing sessionId or message." }, { status: 400 });
  }

  // Resolve which customer this chat is scoped to. The client MUST pass
  // `customerKey` explicitly — either via the chat page's picker, or from
  // a customer-page chat tab. We fall back to "first customer" only when
  // the customers table has exactly one row (single-pilot mode), so the
  // app still works out-of-the-box but never silently masks the wrong
  // customer in a multi-customer environment.
  let customerKey = body.customerKey;
  if (!customerKey) {
    try {
      const customers = await listCustomers();
      if (customers.length === 1) {
        customerKey = customers[0].key;
      }
    } catch {
      /* fall through — we'll error below */
    }
  }
  if (!customerKey) {
    return new Response(
      `data: ${JSON.stringify({
        type: "error",
        content:
          "Pick a customer first — chat is scoped per-customer. Use the picker at the top of the chat page, or open the chat tab inside a customer's page.",
      })}\n\ndata: ${JSON.stringify({ type: "done", full_text: "" })}\n\n`,
      { headers: streamHeaders() }
    );
  }

  if (supabaseAdmin) {
    await supabaseAdmin
      .from(TABLES.chatMessages)
      .insert({ session_id: sessionId, role: "user", content: message });
  }

  // Hydrate prior messages for this session so the agent sees the thread.
  const history: Anthropic.MessageParam[] = [];
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from(TABLES.chatMessages)
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (data) {
      for (const m of data as Array<{ role: string; content: string }>) {
        if (m.role !== "user" && m.role !== "assistant") continue;
        const last = history[history.length - 1];
        if (last && last.role === m.role && typeof last.content === "string") {
          last.content = `${last.content}\n\n${m.content}`;
        } else {
          history.push({ role: m.role as "user" | "assistant", content: m.content });
        }
      }
    }
  }

  // Drop the trailing user message we just inserted; streamAgent expects to
  // receive it via `userMessage`.
  if (history.length > 0 && history[history.length - 1].role === "user") {
    history.pop();
  }

  const encoder = new TextEncoder();
  const responseStream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      let fullText = "";
      try {
        for await (const event of streamAgent({
          customerKey,
          userMessage: message,
          history,
          source: "web",
        })) {
          send(event as unknown as Record<string, unknown>);
          if (event.type === "text") fullText += event.content;
          if (event.type === "done") fullText = event.full_text;
        }

        if (supabaseAdmin && fullText) {
          await supabaseAdmin
            .from(TABLES.chatMessages)
            .insert({ session_id: sessionId, role: "assistant", content: fullText });

          const { count } = await supabaseAdmin
            .from(TABLES.chatMessages)
            .select("*", { count: "exact", head: true })
            .eq("session_id", sessionId);
          if (count && count <= 3) {
            try {
              const title = await generateTitle(message, fullText);
              await supabaseAdmin
                .from(TABLES.chatSessions)
                .update({ title, updated_at: new Date().toISOString() })
                .eq("id", sessionId);
              send({ type: "title", content: title });
            } catch {
              /* title generation is best-effort */
            }
          }
        }

        send({ type: "done" });
      } catch (err) {
        console.error("[chat] stream error:", err);
        send({ type: "error", content: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseStream, { headers: streamHeaders() });
}

function streamHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
}

async function generateTitle(userMessage: string, assistantMessage: string): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "New conversation";
  const anthropic = new Anthropic({ apiKey });
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
  const res = await anthropic.messages.create({
    model,
    max_tokens: 24,
    messages: [
      {
        role: "user",
        content: `Summarise this conversation in 4–6 words for a sidebar title. No quotes, no trailing punctuation, no exclamation points.\n\nUser: ${userMessage}\nAssistant: ${assistantMessage.slice(0, 300)}`,
      },
    ],
  });
  const block = res.content[0];
  return block.type === "text" ? block.text.trim().replace(/[!.?]+$/, "") : "New conversation";
}
