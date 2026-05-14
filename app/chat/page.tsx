"use client";

import { useRef, useEffect, useState } from "react";
import {
  Title,
  Text,
  Button,
  Icon,
  Skeleton,
  Markdown,
} from "@kognitos/lattice";
import { useChatContext } from "@/lib/chat/chat-context";

// DeliveryOps-domain suggestion chips — replace the template's
// "runs / automation" copy. Surfaced only when no thread is open.
const SUGGESTIONS = [
  "What's happened with this customer in the last week?",
  "Draft a check-in email about their renewal",
  "Summarise the latest meeting notes",
  "Who's the right contact for billing questions?",
];

interface CustomerOption {
  key: string;
  display_name: string;
}

export default function ChatPage() {
  const {
    messages,
    isLoadingMessages,
    isSending,
    streamingContent,
    toolStatus,
    error,
    sendMessage,
    activeSessionId,
    activeCustomerKey,
    setActiveCustomerKey,
  } = useChatContext();

  const [input, setInput] = useState("");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load customers once so the picker has options. The endpoint returns
  // the full Customer rows; we project to the two fields the picker uses.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list = (data.customers ?? []) as Array<{ key: string; display_name: string }>;
        setCustomers(list.map((c) => ({ key: c.key, display_name: c.display_name })));
      })
      .catch(() => {
        /* picker stays empty — user sees the empty-state guard below */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSessionId]);

  const handleSubmit = async (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || isSending) return;
    if (!activeCustomerKey) {
      // Server would reject anyway — surface a friendlier message inline.
      return;
    }
    setInput("");
    await sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const activeCustomer = customers.find((c) => c.key === activeCustomerKey) ?? null;
  const showEmpty = !activeSessionId || (messages.length === 0 && !isLoadingMessages && !isSending);

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)]">
      <div className="p-4 border-b border-border shrink-0 flex items-center justify-between gap-4">
        <div>
          <Title level="h3">Agent</Title>
          <Text level="xSmall" color="muted">
            {activeCustomer
              ? `Scoped to ${activeCustomer.display_name}. The agent reads and writes this customer's profile, events, tasks, and rules.`
              : "Pick a customer to start a thread. The agent reads and writes the chosen customer's profile, events, tasks, and rules."}
          </Text>
        </div>
        <div className="shrink-0">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Customer
          </label>
          <select
            value={activeCustomerKey ?? ""}
            onChange={(e) => setActiveCustomerKey(e.target.value || null)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm min-w-[180px]"
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.key} value={c.key}>
                {c.display_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoadingMessages ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-3/4" />
            ))}
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-center">
              <Icon type="MessageSquare" size="xl" className="text-muted-foreground mb-3 mx-auto" />
              <Title level="h3">
                {activeCustomerKey ? "Ask a question" : "Pick a customer first"}
              </Title>
              <Text color="muted" className="mt-1">
                {activeCustomerKey
                  ? `Anything you ask runs against ${activeCustomer?.display_name ?? "this customer"}'s data — profile, events, contacts, tasks, rules.`
                  : "Chat is per-customer. Pick one from the dropdown above (or open the chat tab inside a customer's page)."}
              </Text>
            </div>
            {activeCustomerKey ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSubmit(s)}
                    className="text-left text-sm p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="chat-markdown">
                      <Markdown textProps={{ level: "small" }}>{msg.content}</Markdown>
                    </div>
                  ) : (
                    <Text level="small" className="text-primary-foreground">{msg.content}</Text>
                  )}
                </div>
              </div>
            ))}

            {isSending && streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg px-4 py-3 bg-muted">
                  <div className="chat-markdown">
                    <Markdown textProps={{ level: "small" }}>{streamingContent}</Markdown>
                  </div>
                </div>
              </div>
            )}

            {isSending && !error && (!streamingContent || toolStatus) && (
              <div className="flex justify-start">
                <div className="rounded-lg px-4 py-3 bg-muted">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                    <Text level="xSmall" color="muted">
                      {toolStatus ?? "Thinking..."}
                    </Text>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="flex justify-start">
                <div className="rounded-lg px-4 py-3 bg-destructive/10 border border-destructive/20">
                  <Text level="small" className="text-destructive">{error}</Text>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-border shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeCustomerKey
                ? `Ask anything about ${activeCustomer?.display_name ?? "this customer"}…`
                : "Pick a customer above first"
            }
            disabled={!activeCustomerKey}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            size="icon"
            onClick={() => handleSubmit()}
            disabled={!input.trim() || isSending || !activeCustomerKey}
          >
            <Icon type="SendHorizontal" size="sm" />
          </Button>
        </div>
      </div>
    </div>
  );
}
