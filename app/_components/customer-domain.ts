// Pure, server-safe helpers for resolving a customer's domain. Lives in a
// dedicated file (NOT the client `customer-avatar.tsx`) so server components
// like /customers and /dashboard can import + call it during SSR. Importing
// a "use client" function from a server component fails with "Attempted to
// call X from the server but X is on the client" — moving the helper here
// avoids that boundary.

export interface DeriveDomainInput {
  /** Customer's website URL, if known (e.g. Salesforce account `website`). */
  website?: string | null;
  /** Customer-facing email alias, e.g. `acme@kognitos.com`. */
  emailAlias?: string | null;
  /** Slug/handle, e.g. `acme`. Used as a last-resort guess. */
  key?: string | null;
}

/**
 * Best-effort domain extraction for customer logo lookup.
 * Tries (in order):
 *   - explicit `website` URL/string
 *   - the second half of an `email_alias` (skipping internal kognitos.com aliases)
 *   - "<key>.com" as a final guess — favicon services degrade gracefully if it
 *     doesn't exist, so a bad guess is no worse than no guess.
 */
export function deriveCustomerDomain(input: DeriveDomainInput): string | null {
  const { website, emailAlias, key } = input;

  if (website) {
    try {
      const u = new URL(website.startsWith("http") ? website : `https://${website}`);
      const host = u.hostname.replace(/^www\./, "");
      if (host && host.includes(".")) return host;
    } catch {
      // fall through
    }
  }

  if (emailAlias && emailAlias.includes("@")) {
    const host = emailAlias.split("@")[1]?.toLowerCase().trim();
    // Customer aliases at deliveryops live under kognitos.com — those are
    // routing addresses, not the customer's real domain. Skip them.
    if (host && host !== "kognitos.com" && host.includes(".")) return host;
  }

  if (key && /^[a-z0-9-]+$/i.test(key)) {
    return `${key.toLowerCase()}.com`;
  }

  return null;
}
