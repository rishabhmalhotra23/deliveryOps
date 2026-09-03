-- Conservative, reviewable backfill: mechanical case/whitespace folding plus
-- the already-known duplicate-name pairs (from FDE_ALIASES in
-- v2-migration-client.tsx) folded in by hand. Every other distinct string
-- gets its own roster row rather than being fuzzy-matched -- real duplicates
-- that this doesn't catch get fixed with the merge operation
-- (lib/roster/store.ts:mergeRosterEntries) after a one-time human review of
-- roster_entries, not by guessing here.
--
-- Idempotent: every insert is `on conflict do nothing`, so this is safe to
-- re-run. It never writes the original text columns, only the new
-- roster_entries/roster_aliases rows and the new *_id FK columns.

with normalized(raw, canonical) as (
  select btrim(fde_owner),
    case lower(btrim(fde_owner))
      when 'ayush' then 'Ayush'
      when 'ayush ghosh' then 'Ayush'
      when 'ayush.ghosh@kognitos.com' then 'Ayush'
      when 'karthik n' then 'Karthik'
      when 'karthik nagabhushana' then 'Karthik'
      when 'rishabh' then 'Rishabh'
      when 'rishabh malhotra' then 'Rishabh'
      else btrim(fde_owner)
    end
  from processes where fde_owner is not null and btrim(fde_owner) <> ''
  union all
  select btrim(tam_owner),
    case lower(btrim(tam_owner))
      when 'ayush' then 'Ayush'
      when 'ayush ghosh' then 'Ayush'
      when 'ayush.ghosh@kognitos.com' then 'Ayush'
      when 'karthik n' then 'Karthik'
      when 'karthik nagabhushana' then 'Karthik'
      when 'rishabh' then 'Rishabh'
      when 'rishabh malhotra' then 'Rishabh'
      else btrim(tam_owner)
    end
  from processes where tam_owner is not null and btrim(tam_owner) <> ''
  union all
  select btrim(engg_owner),
    case lower(btrim(engg_owner))
      when 'ayush' then 'Ayush'
      when 'ayush ghosh' then 'Ayush'
      when 'ayush.ghosh@kognitos.com' then 'Ayush'
      when 'karthik n' then 'Karthik'
      when 'karthik nagabhushana' then 'Karthik'
      when 'rishabh' then 'Rishabh'
      when 'rishabh malhotra' then 'Rishabh'
      else btrim(engg_owner)
    end
  from processes where engg_owner is not null and btrim(engg_owner) <> ''
)
insert into roster_entries (kind, display_name)
select distinct 'person', canonical from normalized
on conflict (kind, lower(display_name)) do nothing;

insert into roster_aliases (alias, roster_entry_id)
select distinct lower(n.raw), r.id
from normalized n
join roster_entries r on r.kind = 'person' and lower(r.display_name) = lower(n.canonical)
on conflict (alias) do nothing;

insert into roster_entries (kind, display_name)
select distinct 'partner_org', btrim(partner) from processes
where partner is not null and btrim(partner) <> ''
on conflict (kind, lower(display_name)) do nothing;

insert into roster_aliases (alias, roster_entry_id)
select distinct lower(btrim(p.partner)), r.id
from processes p
join roster_entries r on r.kind = 'partner_org' and lower(r.display_name) = lower(btrim(p.partner))
where p.partner is not null and btrim(p.partner) <> ''
on conflict (alias) do nothing;

update processes p set fde_owner_id = a.roster_entry_id
from roster_aliases a where a.alias = lower(btrim(p.fde_owner)) and p.fde_owner_id is null;

update processes p set tam_owner_id = a.roster_entry_id
from roster_aliases a where a.alias = lower(btrim(p.tam_owner)) and p.tam_owner_id is null;

update processes p set engg_owner_id = a.roster_entry_id
from roster_aliases a where a.alias = lower(btrim(p.engg_owner)) and p.engg_owner_id is null;

update processes p set partner_id = a.roster_entry_id
from roster_aliases a where a.alias = lower(btrim(p.partner)) and p.partner_id is null;
