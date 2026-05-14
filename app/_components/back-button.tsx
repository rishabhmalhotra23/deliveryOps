"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

interface BackButtonProps {
  href?: string;
  label?: string;
}

export function BackButton({ href, label }: BackButtonProps) {
  const router = useRouter();

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] transition-colors group mb-2"
      >
        <svg className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M19 12H5m7-7-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{label ?? "Back"}</span>
      </Link>
    );
  }

  return (
    <button
      onClick={() => router.back()}
      className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] transition-colors group mb-2"
    >
      <svg className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="M19 12H5m7-7-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label ?? "Back"}</span>
    </button>
  );
}
