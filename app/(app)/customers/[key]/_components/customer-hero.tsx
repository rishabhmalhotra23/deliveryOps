"use client";

import { InlineEdit } from "@/app/_components/inline-edit";
import { CustomerAvatar } from "@/app/_components/customer-avatar";
import { Badge } from "@kognitos/lattice";
import type { HeroCardProps } from "@/lib/customers/view-model";

const CATEGORY_VARIANT: Record<string, "destructive" | "warning" | "success" | "secondary" | "default" | "outline"> = {
  "At Risk": "destructive",
  "To Drop": "destructive",
  "Upcoming Renewals": "warning",
  "Strategic Growth": "success",
  Active: "success",
  "Partner Managed": "secondary",
  POV: "outline",
  Churned: "secondary",
};

export function CustomerHero({
  customerKey,
  displayName,
  category,
  aeOwner,
  partner,
  industry,
  renewalDate,
  protectedFields,
  brandColor,
  logoUrl,
  sfWebsiteDomain,
  sfAccountUrl,
  mondayUrl,
  knownAes,
  knownPartners,
  knownCategories,
}: HeroCardProps) {
  const accent = brandColor ?? "#F2FF70";
  const badgeVariant = CATEGORY_VARIANT[category] ?? "default";

  return (
    <section
      className="relative overflow-hidden border-b border-[var(--glass-border)] bg-[color:var(--card)]"
      style={{ "--customer-accent": accent } as React.CSSProperties}
    >
      {/* Brand color radial gradient — two-layer for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 70% 120% at -5% -10%, ${accent}22, transparent 55%),
            radial-gradient(ellipse 40% 60% at 100% 100%, ${accent}0a, transparent 50%)
          `,
        }}
      />
      {/* Subtle noise texture overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")", backgroundRepeat: "repeat", backgroundSize: "128px" }}
      />

      <div className="relative max-w-[1400px] mx-auto px-6 py-7">
        <div className="flex items-start gap-5">
          {/* Logo / initials */}
          <CustomerAvatar
            name={displayName}
            logoUrl={logoUrl}
            domain={sfWebsiteDomain}
            size="lg"
            showStatusDot={false}
            className="shadow-lg"
          />

          {/* Name + badges */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5 mb-1">
              <h1 className="text-2xl font-display font-semibold tracking-tighter text-[color:var(--foreground)] truncate">
                {displayName}
              </h1>
              <Badge variant={badgeVariant}>{category}</Badge>
              {industry ? (
                <Badge variant="outline" className="text-xs">{industry}</Badge>
              ) : null}
              {renewalDate ? (
                <span className="data-label text-[color:var(--muted-foreground)]">
                  Renews {renewalDate}
                </span>
              ) : null}
            </div>

            {/* Editable fields row */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3">
              <div>
                <div className="eyebrow mb-1">Account Executive</div>
                <InlineEdit
                  customerKey={customerKey}
                  field="ae_owner"
                  initialValue={aeOwner}
                  label="AE"
                  placeholder="(unassigned)"
                  suggestions={knownAes}
                />
              </div>
              <div>
                <div className="eyebrow mb-1">Category</div>
                <InlineEdit
                  customerKey={customerKey}
                  field="custom_category"
                  initialValue={category}
                  label="Category"
                  placeholder="(uncategorised)"
                  options={knownCategories.map((c) => ({ value: c, label: c }))}
                  allowNull={false}
                />
              </div>
              <div>
                <div className="eyebrow mb-1">Partner</div>
                <InlineEdit
                  customerKey={customerKey}
                  field="partner"
                  initialValue={partner}
                  label="Partner"
                  placeholder="(direct)"
                  suggestions={knownPartners}
                />
              </div>
            </div>

            {/* Protected fields */}
            {protectedFields.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 items-center mt-3">
                <span className="eyebrow">Locked from sync:</span>
                {protectedFields.map((f) => (
                  <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                ))}
              </div>
            ) : null}
          </div>

          {/* Action links */}
          <div className="flex items-center gap-2 shrink-0 self-start pt-1">
            {sfAccountUrl ? (
              <a
                href={sfAccountUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs tracking-tight font-medium text-[color:var(--muted-foreground)] bg-[color:var(--muted)] border border-[var(--glass-border)] hover:text-[color:var(--foreground)] hover:border-[color:var(--border)] transition-all"
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="group-hover:translate-x-0.5 transition-transform">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Salesforce
              </a>
            ) : null}
            {mondayUrl ? (
              <a
                href={mondayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs tracking-tight font-medium text-[color:var(--muted-foreground)] bg-[color:var(--muted)] border border-[var(--glass-border)] hover:text-[color:var(--foreground)] hover:border-[color:var(--border)] transition-all"
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="group-hover:translate-x-0.5 transition-transform">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Monday
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
