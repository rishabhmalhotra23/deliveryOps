-- processes.linear_ticket_ids is a raw text[] typed in by hand -- no
-- autocomplete against the real linear_tickets cache (0017), no per-ticket
-- status shown, no way to detach one ticket without retyping the whole
-- list. This adds a real many-to-many association, mirroring the same
-- shape team_ask_tickets already established for the same kind of link.
--
-- processes.linear_ticket_ids is NOT removed -- loader.ts's hasV2Evidence()
-- reads it directly, and it stays the mirrored legacy field, kept in sync
-- by lib/processes/tickets.ts on every attach/detach.

create table process_linear_tickets (
  process_id  uuid not null references processes(id) on delete cascade,
  ticket_id   text not null references linear_tickets(id) on delete cascade,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  primary key (process_id, ticket_id)
);

create index process_linear_tickets_ticket_idx on process_linear_tickets (ticket_id);

alter table process_linear_tickets enable row level security;

comment on table process_linear_tickets is
  'Many-to-many link between processes and linear_tickets — one process can be blocked by several tickets, one ticket can affect several processes.';

-- Backfill: only for ticket ids that actually resolve against the real
-- linear_tickets cache. A free-typed id that never matched (a typo, or a
-- ticket the daily sync hasn't ingested yet) is left out rather than
-- inserted as a dangling reference -- it stays visible in the legacy
-- linear_ticket_ids array for a human to notice and fix.
insert into process_linear_tickets (process_id, ticket_id, created_by)
select p.id, t.ticket_id, 'backfill'
from processes p, unnest(p.linear_ticket_ids) as t(ticket_id)
join linear_tickets lt on lt.id = t.ticket_id
on conflict do nothing;
