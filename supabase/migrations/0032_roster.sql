-- fde_owner/tam_owner/engg_owner/partner on `processes` are free-text columns
-- with no canonical source -- the only "picker" is whatever distinct strings
-- already exist on the table, so "Karthik", "Karthik N" and "Karthik
-- Nagabhushana" all coexist as different people. The only fix that ever
-- shipped was a page-local, display-only alias map on the V2 Migration tab
-- (FDE_ALIASES in v2-migration-client.tsx) -- not applied on Delivery, not
-- applied at write time, and doesn't cover TAM or Partner at all.
--
-- This adds a real roster, standalone (not owned by `processes`) so
-- customers.ae_owner/customers.partner -- which have the identical problem
-- one level up -- can adopt it later without any rework here.
--
-- `partner` is not a person: it names an outsourcing agency (My Paradigm,
-- Wipro BPS, QBotica, Indium, ...), not a Kognitos employee. `kind`
-- discriminates so a teammate and a partner org are never forced into the
-- same shape.
--
-- The existing text columns on `processes` are NOT touched or replaced --
-- they become a denormalized display mirror, kept in sync by
-- updateProcess()'s resolution step (lib/processes/store.ts). Every current
-- reader of proc.fde_owner/tam_owner/partner/engg_owner keeps working
-- unmodified for as long as it takes the frontend to adopt the new *_id
-- columns.

create type roster_kind as enum ('person', 'partner_org');

create table roster_entries (
  id             uuid primary key default gen_random_uuid(),
  kind           roster_kind not null,
  display_name   text not null,
  email          text,                          -- persons only
  roles          text[] not null default '{}',   -- e.g. {'fde','tam'} -- one person can hold two roles without two rows
  active         boolean not null default true,
  merged_into_id uuid references roster_entries(id),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index roster_entries_kind_name_idx on roster_entries (kind, lower(display_name));
create index roster_entries_merged_into_idx on roster_entries (merged_into_id) where merged_into_id is not null;

create trigger roster_entries_set_updated_at before update on roster_entries
for each row execute function set_updated_at();

-- One alias maps to exactly one canonical row -- a join table, not a
-- text[] column, so "this raw string means this person" is a real
-- uniqueness constraint, not something the app has to enforce by hand.
create table roster_aliases (
  alias           text primary key,   -- lower(btrim(raw))
  roster_entry_id uuid not null references roster_entries(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create index roster_aliases_entry_idx on roster_aliases (roster_entry_id);

alter table roster_entries enable row level security;
alter table roster_aliases enable row level security;

alter table processes
  add column fde_owner_id  uuid references roster_entries(id) on delete set null,
  add column tam_owner_id  uuid references roster_entries(id) on delete set null,
  add column partner_id    uuid references roster_entries(id) on delete set null,
  add column engg_owner_id uuid references roster_entries(id) on delete set null;

create index processes_fde_owner_id_idx on processes (fde_owner_id);
create index processes_tam_owner_id_idx on processes (tam_owner_id);
create index processes_partner_id_idx   on processes (partner_id);
create index processes_engg_owner_id_idx on processes (engg_owner_id);
