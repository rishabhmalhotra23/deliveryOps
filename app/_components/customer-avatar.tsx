"use client";

import { useState } from "react";
import Image from "next/image";

// Multi-source logo lookup, in order of priority:
//   1. Manual override (customer.logo_url)
//   2. DuckDuckGo favicon (fast, no API key, returns crisp 32-128px ICOs)
//   3. Google S2 favicon (medium speed, broader coverage)
//   4. Clearbit logo (highest quality but slowest — last resort)
// Final fallback: a deterministic gradient with the first two letters of the
// customer name. The component swaps to the next source on each <img>'s
// onError, and only paints the gradient once every source has failed.

const AVATAR_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#818cf8", "#6366f1"], // indigo
  ["#34d399", "#059669"], // emerald
  ["#fb923c", "#ea580c"], // orange
  ["#f472b6", "#db2777"], // pink
  ["#38bdf8", "#0284c7"], // sky
  ["#a78bfa", "#7c3aed"], // violet
  ["#fbbf24", "#d97706"], // amber
  ["#6ee7b7", "#0d9488"], // teal
  ["#f87171", "#dc2626"], // red
  ["#c084fc", "#9333ea"], // purple
];

function gradientFor(name: string): string {
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % AVATAR_GRADIENTS.length;
  const [from, to] = AVATAR_GRADIENTS[idx];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

const CATEGORY_DOT: Record<string, string> = {
  "At Risk": "bg-red-500",
  "To Drop": "bg-red-500",
  "Upcoming Renewals": "bg-amber-500",
  "Strategic Growth": "bg-emerald-500",
  Active: "bg-emerald-500",
  "Partner Managed": "bg-purple-500",
  POV: "bg-[#F2FF70]",
  Churned: "bg-[color:var(--muted-foreground)]",
};

export type CustomerAvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASS: Record<CustomerAvatarSize, string> = {
  xs: "w-7 h-7 rounded-md text-[10px]",
  sm: "w-9 h-9 rounded-lg text-xs",
  md: "w-12 h-12 rounded-xl text-sm",
  lg: "w-16 h-16 rounded-xl text-xl",
};

const SIZE_PX: Record<CustomerAvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 56,
};

const DOT_CLASS: Record<CustomerAvatarSize, string> = {
  xs: "w-1.5 h-1.5 -bottom-0 -right-0",
  sm: "w-2.5 h-2.5 -bottom-0.5 -right-0.5",
  md: "w-2.5 h-2.5 -bottom-0.5 -right-0.5",
  lg: "w-3 h-3 -bottom-0 -right-0",
};

export interface CustomerAvatarProps {
  name: string;
  /** Manual logo URL — highest-priority source if set. */
  logoUrl?: string | null;
  /** Bare domain (no protocol) for favicon lookup, e.g. "acme.com". */
  domain?: string | null;
  /** Customer category for the optional status dot. */
  category?: string | null;
  size?: CustomerAvatarSize;
  /** When true (and category is set), overlays a coloured status dot. */
  showStatusDot?: boolean;
  /** Subtle fade-out for past engagements. */
  dimmed?: boolean;
  className?: string;
}

export function CustomerAvatar({
  name,
  logoUrl,
  domain,
  category,
  size = "sm",
  showStatusDot = true,
  dimmed = false,
  className = "",
}: CustomerAvatarProps) {
  const [srcIdx, setSrcIdx] = useState(0);
  const initials = name.slice(0, 2).toUpperCase();

  const sources: string[] = [];
  if (logoUrl) sources.push(logoUrl);
  if (domain) {
    sources.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
    sources.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
    sources.push(`https://logo.clearbit.com/${domain}`);
  }
  const src = sources[srcIdx] ?? null;

  const sizeClass = SIZE_CLASS[size];
  const px = SIZE_PX[size];
  const dot = category ? CATEGORY_DOT[category] ?? "bg-[color:var(--muted-foreground)]" : null;

  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className={`${sizeClass} overflow-hidden flex items-center justify-center font-bold text-white tracking-tight border border-black/5 dark:border-white/10`}
        style={{
          background: src ? "white" : gradientFor(name),
          opacity: dimmed ? 0.7 : 1,
        }}
      >
        {src ? (
          <Image
            src={src}
            alt={`${name} logo`}
            width={px}
            height={px}
            className="w-full h-full object-contain p-1"
            unoptimized={src.includes("duckduckgo")}
            onError={() => {
              if (srcIdx < sources.length - 1) setSrcIdx(srcIdx + 1);
              else setSrcIdx(sources.length); // exhausted → render gradient
            }}
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>
      {showStatusDot && dot && !dimmed ? (
        <div
          className={`absolute ${DOT_CLASS[size]} rounded-full border-2 border-[color:var(--background)] ${dot}`}
        />
      ) : null}
    </div>
  );
}

// The pure `deriveCustomerDomain` helper lives in ./customer-domain so server
// components (e.g. /customers, /dashboard pages) can import it directly. Do
// NOT re-export from this file — re-exporting through a "use client" module
// silently re-marks the function as client-only and breaks SSR callers with
// "Attempted to call deriveCustomerDomain() from the server but it's on the
// client".
