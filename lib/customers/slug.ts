// Customer key slugification, in its own module because both a server store
// and a client component need it.
//
// lib/customers.ts owns the canonical implementation but imports
// `requireAdmin` — service-role, server-only — so a "use client" component
// can't reach it. The Configure dialog briefly carried its own copy, which
// silently disagreed: it turned "Bradley & Beams" into "bradley-beams" while
// the server produced "bradley-and-beams", so a customer added from the UI
// would have got a different key than the same name from a sync. One
// implementation, imported by both.

/** Display name -> the stable `key` every integration and the
 *  /customers/[key] route join on. */
export function slugifyCustomerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}
