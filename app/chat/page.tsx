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

/**
 * Replace these with domain-specific questions that users are likely to ask.
 */
const SUGGESTIONS = [
  "How many runs completed successfully today?",
  "Show me all runs that need review",
  "What does this automation do?",
  "Are there any failed runs I should look at?",
];

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
  } = useChatContext();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSessionId]);

  const handleSubmit = async (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || isSending) return;
    setInput("");
    await sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const showEmpty = !activeSessionId || (messages.length === 0 && !isLoadingMessages && !isSending);

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)]">
      <div className="p-4 border-b border-border shrink-0">
        <Title level="h3">Chat</Title>
        <Text level="xSmall" color="muted">
          Ask questions about your data, runs, and automation status
        </Text>
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
              <Title level="h3">Ask a question</Title>
              <Text color="muted" className="mt-1">
                I can help you look up data, check processing status, and
                answer questions about the automation.
              </Text>
            </div>
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
            placeholder="Ask a question..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="icon"
            onClick={() => handleSubmit()}
            disabled={!input.trim() || isSending}
          >
            <Icon type="SendHorizontal" size="sm" />
          </Button>
        </div>
      </div>
    </div>
  );
}
