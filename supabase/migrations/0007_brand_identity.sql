-- Add per-customer brand identity columns.
-- brand_color: hex string e.g. "#E2231A" — drives the hero accent gradient.
-- logo_url: manual override; Clearbit auto-fetch is used when null.
-- Both are nullable and protected-field eligible.

alter table customers
  add column if not exists brand_color text,
  add column if not exists logo_url    text;

comment on column customers.brand_color is
  'Customer brand hex color (e.g. #E2231A). Drives the hero accent. Nullable — falls back to brand-yellow.';
comment on column customers.logo_url is
  'Manual logo URL override. When null, UI auto-fetches from logo.clearbit.com using the Salesforce account website domain.';
