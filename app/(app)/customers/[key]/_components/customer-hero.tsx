"use client";

import Image from "next/image";
import { InlineEdit } from "@/app/_components/inline-edit";
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

function ClearbitLogo({ domain, displayName }: { domain: string; displayName: string }) {
  return (
    <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/90 flex items-center justify-center shadow-sm border border-white/20 shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://logo.clearbit.com/${domain}`}
        alt={`${displayName} logo`}
        width={40}
        height={40}
        className="w-10 h-10 object-contain"
        onError={(e) => {
          const target = e.currentTarget as HTMLImageElement;
          target.style.display = "none";
          const parent = target.parentElement;
          if (parent) {
            parent.innerHTML = `<span class="text-lg font-bold text-[#171717]">${displayName.slice(0, 2).toUpperCase()}</span>`;
          }
        }}
      />
    </div>
  );
}

function InitialsAvatar({ name }: { name: string }) {
  return (
    <div className="w-12 h-12 rounded-xl bg-[#F2FF70] text-[#171717] flex items-center justify-center text-lg font-bold shrink-0 shadow-sm">
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

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

  const logoSrc = logoUrl ?? (sfWebsiteDomain ? undefined : undefined);
  const showClearbit = !logoUrl && !!sfWebsiteDomain;

  return (
    <section
      className="relative overflow-hidden border-b border-[var(--glass-border)]"
      style={{ "--customer-accent": accent } as React.CSSProperties}
    >
      {/* Brand color radial gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 60% 80% at 0% 0%, ${accent}18, transparent 70%)`,
        }}
      />

      <div className="relative max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-start gap-5">
          {/* Logo / initials */}
          {logoUrl ? (
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/90 flex items-center justify-center shadow-sm border border-white/20 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt={`${displayName} logo`} width={40} height={40} className="w-10 h-10 object-contain" />
            </div>
          ) : showClearbit ? (
            <ClearbitLogo domain={sfWebsiteDomain!} displayName={displayName} />
          ) : (
            <InitialsAvatar name={displayName} />
          )}

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
          <div className="flex items-center gap-2 shrink-0">
            {sfAccountUrl ? (
              <a
                href={sfAccountUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs tracking-tight text-[color:var(--muted-foreground)] border border-[var(--glass-border)] hover:text-[color:var(--foreground)] hover:border-[rgba(255,255,255,0.2)] transition-all"
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs tracking-tight text-[color:var(--muted-foreground)] border border-[var(--glass-border)] hover:text-[color:var(--foreground)] hover:border-[rgba(255,255,255,0.2)] transition-all"
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
