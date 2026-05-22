"use client";

// Slide-in side panel that powers the analytics chart drill-downs.  Opens
// when the user clicks a bar in any of the four workload charts; closes on
// ESC, backdrop click, or the X button.  The body is a list of rows
// rendered by the parent — keeps this component agnostic about whether
// it's showing projects, customers, or anything else.

import { useEffect } from "react";

export function DrillDownPanel({
  title,
  subtitle,
  footer,
  onClose,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock scroll on body while the panel is open so the page underneath
  // doesn't drift while the user scrolls a long list inside the panel.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="flex-1 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside className="w-full max-w-2xl h-full bg-[color:var(--background)] border-l border-[var(--glass-border)] shadow-2xl flex flex-col">
        <header className="px-6 py-4 border-b border-[var(--glass-border)] flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="text-lg font-semibold tracking-tight text-[color:var(--foreground)] truncate">
              {title}
            </div>
            {subtitle ? (
              <div className="text-xs text-[color:var(--muted-foreground)] mt-1">
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] hover:bg-[var(--glass-bg)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer ? (
          <footer className="px-6 py-3 border-t border-[var(--glass-border)] text-xs text-[color:var(--muted-foreground)] shrink-0">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
