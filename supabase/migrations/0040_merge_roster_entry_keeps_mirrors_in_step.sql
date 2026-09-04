-- mergeRosterEntries() left the denormalized owner text behind.
--
-- It repoints every processes.*_owner_id FK from the loser to the survivor
-- (lib/roster/store.ts), but `processes` keeps BOTH halves of every owner
-- (0032: fde_owner alongside fde_owner_id) so pre-roster readers keep
-- working. So merging "Arushi" into "Arushi Bohra" moved the 2 FKs and left
-- fde_owner still reading "Arushi" — the roster would say the duplicate is
-- gone while the Delivery table kept showing it, which is the whole failure
-- the merge operation exists to end.
--
-- It also reset updated_at on every row it touched. Repointing an FK to the
-- canonical row for the SAME human is bookkeeping, not delivery progress:
-- "Last touched" and every staleness signal built on it (the table column and
-- its colouring, stalest-first lane ordering, delivery-review) would have
-- reported a merge as fresh work on 7 processes.
--
-- Both are the problems 0038 solved for renames, so this reuses that
-- machinery: one function, one transaction, behind the same
-- transaction-local GUC that processes_set_updated_at() honours.

create or replace function merge_roster_entry(p_loser_id uuid, p_survivor_id uuid)
returns integer
language plpgsql
as $$
declare
  survivor_name text;
  touched integer := 0;
  n integer;
begin
  if p_loser_id = p_survivor_id then
    raise exception 'Cannot merge a roster entry into itself';
  end if;

  select display_name into survivor_name from roster_entries where id = p_survivor_id;
  if survivor_name is null then
    raise exception 'Unknown survivor roster entry: %', p_survivor_id;
  end if;
  if not exists (select 1 from roster_entries where id = p_loser_id) then
    raise exception 'Unknown roster entry: %', p_loser_id;
  end if;

  perform set_config('deliveryops.roster_rename', 'on', true);

  -- Every alias that resolved to the loser must now resolve to the survivor,
  -- including the loser's own name — that is what stops the next free-text
  -- write of "Arushi" from forking a third row for the same person.
  update roster_aliases set roster_entry_id = p_survivor_id where roster_entry_id = p_loser_id;

  -- FK and text mirror together, per column, so the two halves can never
  -- disagree even if this fails partway (it is one transaction).
  update processes set fde_owner_id  = p_survivor_id, fde_owner  = survivor_name
    where fde_owner_id  = p_loser_id;
  get diagnostics n = row_count; touched := touched + n;
  update processes set tam_owner_id  = p_survivor_id, tam_owner  = survivor_name
    where tam_owner_id  = p_loser_id;
  get diagnostics n = row_count; touched := touched + n;
  update processes set engg_owner_id = p_survivor_id, engg_owner = survivor_name
    where engg_owner_id = p_loser_id;
  get diagnostics n = row_count; touched := touched + n;
  update processes set partner_id    = p_survivor_id, partner    = survivor_name
    where partner_id    = p_loser_id;
  get diagnostics n = row_count; touched := touched + n;

  -- The survivor inherits any role the loser held: "Arushi" was only ever an
  -- FDE while "Arushi Bohra" is FDE and TAM, but the reverse happens too and
  -- dropping a role here would quietly demote somebody in the pickers.
  update roster_entries s
  set roles = (
    select array_agg(distinct role order by role)
    from (
      select unnest(s.roles) as role
      union
      select unnest(l.roles) from roster_entries l where l.id = p_loser_id
    ) merged
  )
  where s.id = p_survivor_id;

  update roster_entries
  set active = false, merged_into_id = p_survivor_id
  where id = p_loser_id;

  return touched;
end;
$$;

comment on function merge_roster_entry(uuid, uuid) is
  'Folds one roster entry into another: repoints aliases and every processes owner FK, rewrites the denormalized owner text to match, unions the roles onto the survivor, and deactivates the loser -- all in one transaction with updated_at preserved. Replaces the app-side loop in mergeRosterEntries(), which moved the FKs but not the text and reset "Last touched" on every row.';
