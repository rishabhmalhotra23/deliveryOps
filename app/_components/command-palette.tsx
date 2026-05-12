"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "cmdk";

interface CustomerEntry {
  key: string;
  display_name: string;
  custom_category?: string | null;
  ae_owner?: string | null;
}

const STATIC_COMMANDS = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", group: "Navigate" },
  { id: "analytics", label: "Analytics", href: "/analytics", group: "Navigate" },
  { id: "customers", label: "All Customers", href: "/customers", group: "Navigate" },
  { id: "operations", label: "Operations Agent", href: "/operations", group: "Navigate" },
  { id: "agent", label: "Agent Chat", href: "/chat", group: "Navigate" },
  { id: "sync", label: "Sync Status", href: "/dev/sync", group: "Tools" },
  { id: "integrations", label: "Integrations", href: "/dev/integrations", group: "Tools" },
  { id: "import", label: "Import Customers", href: "/dev/import", group: "Tools" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerEntry[]>([]);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const customHandler = () => setOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener("open-command-palette", customHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("open-command-palette", customHandler);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch("/api/customers/search?limit=50")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []))
      .catch(() => {});
  }, [open]);

  const run = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-xl mx-4 glass-card overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="[&_[cmdk-root]]:outline-none">
          <div className="flex items-center border-b border-[var(--glass-border)] px-4">
            <svg
              className="w-4 h-4 text-[color:var(--muted-foreground)] shrink-0"
              fill="none" stroke="currentColor" strokeWidth="2"
              viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <CommandInput
              placeholder="Search customers, navigate pages…"
              className="flex-1 bg-transparent border-0 outline-none px-3 py-4 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] [&:focus]:outline-none"
              autoFocus
            />
            <kbd
              onClick={() => setOpen(false)}
              className="text-[10px] border border-[color:var(--glass-border)] rounded px-1.5 py-0.5 text-[color:var(--muted-foreground)] font-mono cursor-pointer hover:text-[color:var(--foreground)] transition-colors"
            >
              ESC
            </kbd>
          </div>

          <CommandList className="max-h-[400px] overflow-y-auto py-2">
            <CommandEmpty className="py-8 text-center text-sm text-[color:var(--muted-foreground)]">
              No results found.
            </CommandEmpty>

            {/* Static navigation */}
            <CommandGroup heading="Navigate" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5">
              {STATIC_COMMANDS.filter((c) => c.group === "Navigate").map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={cmd.label}
                  onSelect={() => run(cmd.href)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-[color:var(--foreground)] cursor-pointer hover:bg-[var(--glass-bg)] data-[selected=true]:bg-[rgba(242,255,112,0.08)] rounded-md mx-1 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--muted-foreground)] shrink-0" />
                  {cmd.label}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator className="my-1 border-t border-[var(--glass-border)]" />

            {/* Customers */}
            {customers.length > 0 && (
              <CommandGroup heading="Customers" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5">
                {customers.map((c) => (
                  <CommandItem
                    key={c.key}
                    value={c.display_name}
                    onSelect={() => run(`/customers/${c.key}`)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-[var(--glass-bg)] data-[selected=true]:bg-[rgba(242,255,112,0.08)] rounded-md mx-1 transition-colors"
                  >
                    <span className="w-6 h-6 rounded-md bg-[color:var(--brand-yellow)] text-[color:var(--brand-night)] text-[10px] font-semibold flex items-center justify-center shrink-0 font-mono">
                      {c.display_name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[color:var(--foreground)] truncate">{c.display_name}</span>
                      {c.ae_owner && (
                        <span className="block text-[11px] text-[color:var(--muted-foreground)] truncate">{c.ae_owner}</span>
                      )}
                    </span>
                    {c.custom_category && (
                      <span className="data-label text-[color:var(--muted-foreground)] shrink-0">{c.custom_category}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandSeparator className="my-1 border-t border-[var(--glass-border)]" />

            {/* Tools */}
            <CommandGroup heading="Tools" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5">
              {STATIC_COMMANDS.filter((c) => c.group === "Tools").map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={cmd.label}
                  onSelect={() => run(cmd.href)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-[color:var(--foreground)] cursor-pointer hover:bg-[var(--glass-bg)] data-[selected=true]:bg-[rgba(242,255,112,0.08)] rounded-md mx-1 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--muted-foreground)] shrink-0" />
                  {cmd.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
