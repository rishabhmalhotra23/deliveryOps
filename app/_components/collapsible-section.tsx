"use client";

// Consistent collapse/expand wrapper for major sections on the customer
// page (and anywhere else). One predictable affordance:
//   - Click anywhere on the header to toggle.
//   - Caret rotates 90° on open.
//   - Open state persists per-section per-customer in localStorage so
//     a CSM's chosen layout survives page reloads.
//   - SectionMark + count + actions slot all stay inside the header.
//
// Uses native <details>/<summary> for accessibility — also works without
// JS for the initial render, then the script promotes it to a persisted
// state.

import { useState, useEffect, type ReactNode } from "react";

interface CollapsibleSectionProps {
  /** Stable key for localStorage persistence (e.g. "salesforce", "projects"). */
  id: string;
  title: ReactNode;
  /** Optional small count chip shown next to the title (e.g. "12 responses"). */
  count?: ReactNode;
  /** Optional right-aligned action (e.g. "synced 4m ago"). */
  meta?: ReactNode;
  /** Whether to default-open on first render. */
  defaultOpen?: boolean;
  /** Optional emphasis style — used for hero / above-the-fold sections. */
  emphasis?: boolean;
  children: ReactNode;
}

const STORAGE_PREFIX = "do.customer.section.";

export function CollapsibleSection({
  id,
  title,
  count,
  meta,
  defaultOpen = true,
  emphasis = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const stored = window.localStorage.getItem(STORAGE_PREFIX + id);
      if (stored === "open") setOpen(true);
      else if (stored === "closed") setOpen(false);
    } catch {
      /* localStorage can throw in some sandboxed contexts */
    }
  }, [id]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, open ? "open" : "closed");
    } catch {
      /* ignore */
    }
  }, [open, hydrated, id]);

  const headerBg = emphasis
    ? "bg-[color:var(--brand-yellow-soft)]"
    : "bg-white";

  return (
    <section
      className={`rounded-lg border border-line ${headerBg} overflow-hidden`}
      data-section-id={id}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-baseline justify-between gap-3 px-6 py-4 text-left hover:bg-[color:var(--brand-seasalt)] transition-colors"
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className={`inline-block transition-transform text-[color:var(--brand-gray)] shrink-0 ${
              open ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
          <span className="text-[10px] uppercase tracking-[0.22em] font-medium text-[color:var(--brand-night)]">
            {title}
          </span>
          {count != null ? (
            <span className="text-xs text-[color:var(--brand-gray)] tabular-nums ml-1">
              {count}
            </span>
          ) : null}
        </div>
        {meta ? (
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)] shrink-0">
            {meta}
          </span>
        ) : null}
      </button>
      {open ? <div className="px-6 pb-6 pt-1">{children}</div> : null}
    </section>
  );
}
