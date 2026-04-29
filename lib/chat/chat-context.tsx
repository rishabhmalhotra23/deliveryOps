"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { ChatSession, ChatMessage } from "./types";

interface ChatContextValue {
  sessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  messages: ChatMessage[];
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isSending: boolean;
  streamingContent: string;
  toolStatus: string | null;
  error: string | null;
  createSession: () => Promise<string | null>;
  sendMessage: (content: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skipNextLoadRef = useRef(false);

  const loadSessions = useCallback(async () => {
    try {
      setIsLoadingSessions(true);
      const res = await fetch("/api/chat/sessions");
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      /* ignore */
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoadingMessages(true);
      try {
        const res = await fetch(`/api/chat/sessions/${activeSessionId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setMessages(data.messages ?? []);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  const createSession = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/chat/sessions", { method: "POST" });
      if (!res.ok) return null;
      const data = await res.json();
      const session = data.session as ChatSession;
      setSessions((prev) => [session, ...prev]);
      skipNextLoadRef.current = true;
      setActiveSessionId(session.id);
      setMessages([]);
      return session.id;
    } catch {
      return null;
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      let sessionId = activeSessionId;
      if (!sessionId) {
        sessionId = await createSession();
        if (!sessionId) return;
      }

      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);
      setStreamingContent("");
      setToolStatus(null);
      setError(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: content }),
        });

        if (!res.ok || !res.body) {
          setError(`Failed to send message (${res.status})`);
          setIsSending(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
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
            if (payload === "[DONE]") continue;
            try {
              const event = JSON.parse(payload);
              if (event.type === "text") {
                accumulated += event.content ?? "";
                setStreamingContent(accumulated);
                setToolStatus(null);
              } else if (event.type === "tool_use") {
                setToolStatus(`Running ${event.tool_name ?? "tool"}…`);
              } else if (event.type === "tool_result") {
                setToolStatus(null);
              } else if (event.type === "title") {
                const title = event.content ?? "";
                setSessions((prev) =>
                  prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
                );
              } else if (event.type === "error") {
                console.error("[chat] Server error:", event.content);
                setError(event.content ?? "Something went wrong");
              }
            } catch {
              /* skip malformed */
            }
          }
        }

        if (accumulated) {
          const assistantMsg: ChatMessage = {
            id: `asst-${Date.now()}`,
            session_id: sessionId,
            role: "assistant",
            content: accumulated,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setIsSending(false);
        setStreamingContent("");
        setToolStatus(null);
      }
    },
    [activeSessionId, createSession]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setMessages([]);
        }
      } catch {
        /* ignore */
      }
    },
    [activeSessionId]
  );

  return (
    <ChatContext.Provider
      value={{
        sessions,
        activeSessionId,
        setActiveSessionId,
        messages,
        isLoadingSessions,
        isLoadingMessages,
        isSending,
        streamingContent,
        toolStatus,
        error,
        createSession,
        sendMessage,
        deleteSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
