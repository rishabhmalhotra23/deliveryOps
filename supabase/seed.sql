-- Demo customer for local dev.
-- Applied automatically by `supabase db reset`.

insert into customers (key, display_name, slack_channel, email_alias)
values ('acme', 'Acme', 'acme', 'acme@deliveryops.example')
on conflict (key) do nothing;

-- Seed an empty profile + internal_profile + rules row so /dev/simulate has
-- something to read against immediately.
insert into profiles (customer_id, deployment_stage)
select id, 'pilot'::deployment_stage
from customers
where key = 'acme'
on conflict (customer_id) do nothing;

insert into internal_profiles (customer_id)
select id
from customers
where key = 'acme'
on conflict (customer_id) do nothing;

insert into rules (customer_id, content)
select id, '# Customer rules

## Communication preferences
- Default to plainspoken, no marketing fluff.

## Topics to avoid
- Anything covered by the master MSA — point to legal first.

## Escalation policies
- Tag the on-call CSM in #cs-escalations for anything urgency=high.

## Other notes
- Acme uses Salesforce as the source of truth for renewal dates.
'
from customers
where key = 'acme'
on conflict (customer_id) do nothing;
