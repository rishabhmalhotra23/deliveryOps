"use client";

import { useEffect, useRef, useState } from "react";

interface ToolCall {
  tool_name: string;
  tool_input: unknown;
  result?: string;
}

interface AssistantMessage {
  role: "assistant";
  text: string;
  tool_calls: ToolCall[];
  done: boolean;
}

interface UserMessage {
  role: "user";
  text: string;
}

type Message = UserMessage | AssistantMessage;

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

export function OperationsClient({ suggested }: { suggested: string[] }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    const userMsg: UserMessage = { role: "user", text: text.trim() };
    const placeholder: AssistantMessage = { role: "assistant", text: "", tool_calls: [], done: false };
    setMessages((prev) => [...prev, userMsg, placeholder]);
    setInput("");
    setBusy(true);

    // Build history from prior turns (exclude the placeholder we just added)
    const history: HistoryItem[] = [];
    for (const m of messages) {
      if (m.role === "user") {
        history.push({ role: "user", content: m.text });
      } else if (m.text) {
        history.push({ role: "assistant", content: m.text });
      }
    }

    try {
      const res = await fetch("/api/operations/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), history }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (!payload) continue;
          try {
            const event = JSON.parse(payload) as
              | { type: "text"; content: string }
              | { type: "tool_use"; tool_name: string; tool_input: unknown }
              | { type: "tool_result"; tool_name: string; content: string }
              | { type: "done"; full_text: string }
              | { type: "end" }
              | { type: "error"; content: string };

            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") return next;

              if (event.type === "text") {
                next[next.length - 1] = { ...last, text: last.text + event.content };
              } else if (event.type === "tool_use") {
                next[next.length - 1] = {
                  ...last,
                  tool_calls: [
                    ...last.tool_calls,
                    { tool_name: event.tool_name, tool_input: event.tool_input },
                  ],
                };
              } else if (event.type === "tool_result") {
                const calls = [...last.tool_calls];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i].tool_name === event.tool_name && !calls[i].result) {
                    calls[i] = { ...calls[i], result: event.content };
                    break;
                  }
                }
                next[next.length - 1] = { ...last, tool_calls: calls };
              } else if (event.type === "done" || event.type === "end") {
                next[next.length - 1] = { ...last, done: true };
              } else if (event.type === "error") {
                setError(event.content);
                next[next.length - 1] = { ...last, done: true };
              }
              return next;
            });
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, done: true };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Conversation */}
      <div
        ref={scrollRef}
        className="rounded-lg border border-line bg-[color:var(--card)] p-6 max-h-[60vh] overflow-y-auto space-y-5"
      >
        {messages.length === 0 ? (
          <div className="text-sm text-[color:var(--brand-gray)] space-y-3">
            <p>Type any portfolio-wide command. Examples:</p>
            <ul className="space-y-1">
              {suggested.map((s) => (
                <li key={s}>
                  <button
                    onClick={() => setInput(s)}
                    className="text-left underline decoration-[color:var(--brand-yellow)] decoration-2 underline-offset-4 hover:text-[color:var(--brand-night)]"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m, idx) =>
            m.role === "user" ? (
              <UserBubble key={idx} text={m.text} />
            ) : (
              <AgentBubble key={idx} message={m} />
            )
          )
        )}
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tell DeliveryOps what changed…"
          disabled={busy}
          className="flex-1 rounded-md border border-line bg-[color:var(--card)] text-[color:var(--foreground)] px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-yellow)]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="btn-primary rounded-md px-4 py-2 text-sm disabled:opacity-40"
        >
          {busy ? "Thinking…" : "Send"}
        </button>
      </form>

      <p className="text-xs text-[color:var(--brand-gray)]">
        Operations changes lock the affected fields from the next sync. Other systems are signal
        sources; DeliveryOps is the truth.
      </p>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[color:var(--brand-night)] text-[color:var(--brand-seasalt)] px-4 py-2.5 text-sm">
        {text}
      </div>
    </div>
  );
}

function AgentBubble({ message }: { message: AssistantMessage }) {
  return (
    <div className="flex flex-col items-start gap-2 max-w-[90%]">
      {message.tool_calls.length > 0 ? (
        <div className="space-y-1">
          {message.tool_calls.map((c, i) => (
            <ToolPill key={i} call={c} />
          ))}
        </div>
      ) : null}
      {message.text || message.done ? (
        <div className="rounded-2xl rounded-bl-sm bg-[color:var(--card)] border border-line text-[color:var(--foreground)] px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
          {message.text || (message.done ? "(no reply)" : "")}
          {!message.done && message.text ? (
            <span className="inline-block w-2 h-4 bg-[color:var(--brand-yellow)] ml-0.5 animate-pulse" />
          ) : null}
        </div>
      ) : !message.done && message.tool_calls.length === 0 ? (
        <div className="text-xs text-[color:var(--brand-gray)] italic">Thinking…</div>
      ) : null}
    </div>
  );
}

function ToolPill({ call }: { call: ToolCall }) {
  const label = call.tool_name.replace(/_/g, " ");
  return (
    <details className="text-xs">
      <summary
        className={`cursor-pointer inline-flex items-center gap-2 rounded-md border px-2 py-1 ${
          call.result
            ? "bg-[color:var(--brand-yellow-soft)] border-[color:var(--brand-yellow-line)] text-[color:var(--brand-night)]"
            : "bg-[color:var(--brand-seasalt)] border-line text-[color:var(--brand-gray)]"
        }`}
      >
        <span className={call.result ? "" : "animate-pulse"}>
          {call.result ? "✓" : "▸"}
        </span>
        <span className="font-medium">{label}</span>
      </summary>
      <div className="mt-1 ml-4 space-y-1 text-[11px] text-[color:var(--brand-gray)]">
        <div>
          <span className="uppercase tracking-wider mr-1">input</span>
          <pre className="inline whitespace-pre-wrap font-mono">
            {JSON.stringify(call.tool_input ?? {}, null, 2)}
          </pre>
        </div>
        {call.result ? (
          <div>
            <span className="uppercase tracking-wider mr-1">result</span>
            <pre className="inline whitespace-pre-wrap font-mono">{call.result}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}
