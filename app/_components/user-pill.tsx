"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

interface Props {
  email: string;
  picture?: string | null;
}

export function UserPill({ email, picture }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || email[0]?.toUpperCase() || "?";

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left hover:bg-[rgba(255,255,255,0.06)] transition-colors"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {/* Avatar: use Google profile picture if available, else initials */}
        {picture ? (
          <Image
            src={picture}
            alt={email}
            width={24}
            height={24}
            className="w-6 h-6 rounded-full object-cover shrink-0"
            unoptimized
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] text-[10px] font-bold flex items-center justify-center shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-[color:var(--brand-seasalt)] truncate">{email}</div>
        </div>
        <svg
          className={`w-3 h-3 text-[color:var(--brand-metal)] transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[color:var(--brand-night)] shadow-xl overflow-hidden">
          {/* Sign out goes through Auth0's logout endpoint */}
          <a
            href="/api/auth/logout"
            className="block px-3 py-2 text-xs text-[color:var(--brand-seasalt)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            Sign out
          </a>
        </div>
      ) : null}
    </div>
  );
}
