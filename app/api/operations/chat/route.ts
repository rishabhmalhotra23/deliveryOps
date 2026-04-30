import { streamOperationsAgent } from "@/lib/agent/operations";
import type Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface PostBody {
  message: string;
  history?: Anthropic.MessageParam[];
}

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.message?.trim()) {
    return Response.json({ error: "Empty message." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        for await (const event of streamOperationsAgent({
          userMessage: body.message,
          history: body.history,
        })) {
          send(event as unknown as Record<string, unknown>);
        }
        send({ type: "end" });
      } catch (err) {
        send({
          type: "error",
          content: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
