"use client";

// Lightweight tooltip primitive — info icon with a popover. Works on hover
// (desktop) and click (touch). No external dependency. Designed for inline
// use next to labels on the customer page.

import { useState, useRef, useEffect, type ReactNode } from "react";

interface TooltipProps {
  /** Plain-language explanation of what the labelled field means. */
  children: ReactNode;
  /** Optional source attribution (e.g. "from Salesforce", "computed"). */
  source?: string;
  /** Width of the popover. Default 280px. */
  width?: number;
}

export function InfoTooltip({ children, source, width = 280 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close on outside click / escape — same affordance as a popover.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[color:var(--brand-gray)] text-[8px] font-bold text-[color:var(--brand-gray)] hover:border-[color:var(--brand-night)] hover:text-[color:var(--brand-night)] transition-colors"
      >
        i
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute top-full left-0 mt-1.5 z-50 rounded-md border border-[color:var(--brand-night)] bg-white p-3 text-xs leading-relaxed text-[color:var(--brand-night)] shadow-lg"
          style={{ width }}
        >
          {children}
          {source ? (
            <span className="block mt-2 pt-2 border-t border-[color:var(--brand-metal-line)] text-[10px] uppercase tracking-wider text-[color:var(--brand-gray)]">
              {source}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

// Convenience: <FieldLabel> renders a label with an info icon when info is provided.
export function FieldLabel({
  children,
  info,
  source,
}: {
  children: ReactNode;
  info?: ReactNode;
  source?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{children}</span>
      {info ? (
        <InfoTooltip source={source}>{info}</InfoTooltip>
      ) : null}
    </span>
  );
}
