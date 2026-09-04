-- Renaming a roster entry must not reset "Last touched" on every process that
-- person owns.
--
-- `processes` keeps a denormalized text mirror of each owner FK (0032:
-- fde_owner alongside fde_owner_id, and so on) so every pre-roster reader
-- still works. That means fixing a roster spelling — e.g.
-- "shyam.prabhal@kognitos.com" -> "Shyam Prabhal" — has to rewrite the text
-- column on all 10 of that person's processes, or the roster and the Delivery
-- table disagree about who owns what.
--
-- But those text columns are genuine content, so processes_set_updated_at
-- (0036/0037) correctly bumps updated_at when they change — and updated_at is
-- what the "Last touched" column, its staleness colouring, the stalest-first
-- lane ordering and delivery-review's staleness signals all read. A one-word
-- spelling fix would have reported 10 processes as freshly worked on. That is
-- precisely the class of bug 0036 was written to eliminate, arriving through a
-- new door.
--
-- Restoring the timestamp from the app can't work: the guard is a BEFORE
-- trigger that overwrites whatever value the client sends, and a follow-up
-- update touching only updated_at hits the trigger's own bookkeeping branch,
-- which puts the old value straight back. A transaction-local GUC is the
-- standard Postgres way to tell a trigger the intent behind a write, so the
-- rename runs inside a function that sets one.

create or replace function processes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Set only by rename_roster_entry(), and transaction-local (the `true`
  -- third argument to set_config), so it cannot leak into an unrelated write
  -- on a pooled connection.
  if coalesce(current_setting('deliveryops.roster_rename', true), '') = 'on' then
    new.updated_at = old.updated_at;
    return new;
  end if;

  if (
    to_jsonb(new) - 'updated_at' - 'ttv_days' - 'updated_by' - 'field_provenance'
      - 'board_position' - 'table_position' - 'reviewed_at' - 'reviewed_by'
  ) = (
    to_jsonb(old) - 'updated_at' - 'ttv_days' - 'updated_by' - 'field_provenance'
      - 'board_position' - 'table_position' - 'reviewed_at' - 'reviewed_by'
  ) then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

comment on function processes_set_updated_at() is
  'Maintains processes.updated_at as a content-change timestamp. A write that only touches board_position / table_position (manual ordering) or reviewed_at/reviewed_by (mark reviewed) preserves the previous value, as does any write inside rename_roster_entry() (which rewrites owner text mirrors and is bookkeeping, not delivery progress). Keeps "Last touched" and every staleness signal built on it honest.';

-- Renames the entry and every text mirror pointing at it, in one transaction,
-- without disturbing updated_at. Returns the number of process rows touched
-- so the caller can report it.
create or replace function rename_roster_entry(p_entry_id uuid, p_new_name text)
returns integer
language plpgsql
as $$
declare
  touched integer := 0;
  n integer;
begin
  if p_new_name is null or btrim(p_new_name) = '' then
    raise exception 'display_name cannot be blank';
  end if;

  perform set_config('deliveryops.roster_rename', 'on', true);

  update roster_entries set display_name = btrim(p_new_name) where id = p_entry_id;
  if not found then
    raise exception 'Unknown roster entry: %', p_entry_id;
  end if;

  update processes set fde_owner  = btrim(p_new_name) where fde_owner_id  = p_entry_id;
  get diagnostics n = row_count; touched := touched + n;
  update processes set tam_owner  = btrim(p_new_name) where tam_owner_id  = p_entry_id;
  get diagnostics n = row_count; touched := touched + n;
  update processes set engg_owner = btrim(p_new_name) where engg_owner_id = p_entry_id;
  get diagnostics n = row_count; touched := touched + n;
  update processes set partner    = btrim(p_new_name) where partner_id    = p_entry_id;
  get diagnostics n = row_count; touched := touched + n;

  return touched;
end;
$$;

comment on function rename_roster_entry(uuid, text) is
  'Renames a roster entry and rewrites the denormalized owner text mirrors on processes (fde_owner/tam_owner/engg_owner/partner) in one transaction, preserving updated_at on every row touched. The caller is responsible for adding the new spelling to roster_aliases.';
