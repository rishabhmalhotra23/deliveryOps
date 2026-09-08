-- Makes customer zones and categories editable from the product.
--
-- WHY
-- ---
-- The bar (2026-09-08): "just make sure everything is configurable and
-- editable in UI". Customer category was only half configurable. The LABEL was
-- free text, so `custom_category` accepted anything and the record card's
-- picker could already mint one — but everything that gives a category
-- MEANING was compiled in:
--
--   * app/_components/brand.tsx      CATEGORY_TO_ZONE  (which group it files under)
--   * app/_components/brand.tsx      ZONE_ORDER/ZONE_DESC (the group headers)
--   * .../customers-browser.tsx      CATEGORY_VARIANT  (its chip colour)
--   * lib/supabase/types.ts          CUSTOMER_CATEGORIES (picker list + order)
--
-- So minting "To be dropped post contract expiry" saved the name and then
-- filed the customer under **Focus, the active book** — `zoneForCategory()`
-- has no entry for a new value and falls through to `?? "Focus"`. Its chip
-- rendered untoned for the same reason. Configurable in name only, and wrong
-- in the direction that matters.
--
-- WHY NO DDL, UNLIKE 0042
-- -----------------------
-- The process vocabularies are real Postgres enums, so adding a value means
-- `ALTER TYPE ... ADD VALUE` inside a SECURITY DEFINER function, and it can
-- never be undone (Postgres has no DROP VALUE) — which is why retiring one is
-- `active = false`.
--
-- `customers.custom_category` is plain `text` (0005 — no enum, no CHECK). So
-- these two vocabularies need no DDL at all: adding one is an ordinary INSERT
-- and a customer category can genuinely be DELETED, not just retired. They
-- deliberately do NOT go through add_vocabulary_value(), whose whole job is
-- the enum path.
--
-- WHAT `value` MEANS IN EACH
-- --------------------------
-- customer_category.value is the literal string stored in
-- customers.custom_category ("Strategic Growth", not "strategic_growth"),
-- because that column already holds display text and 41 rows point at it.
-- Renaming a category therefore has to move those rows too — that's
-- rename_customer_category() below, same shape as rename_roster_entry()
-- (0038).
--
-- customer_zone.value is a stable slug ("focus"). Nothing in `customers`
-- references a zone — it is derived from the category's rollup — so a zone's
-- label and description are free to change with no data to migrate. That is
-- what makes the group headers editable.

begin;

-- ── 1. Two nullable columns on 0042's table ────────────────────────────────
-- `rollup` is used only by customer_category (which zone it files under);
-- `description` only by customer_zone (the "the active book" subtitle under
-- each group header). The process vocabularies leave both null.
alter table vocabulary_values add column if not exists rollup      text;
alter table vocabulary_values add column if not exists description text;

comment on column vocabulary_values.rollup is
  'customer_category only: the customer_zone.value this category groups under. Null for every other vocabulary.';
comment on column vocabulary_values.description is
  'customer_zone only: the sub-label shown beside a group header ("the active book"). Null for every other vocabulary.';

-- ── 2. Zones ───────────────────────────────────────────────────────────────
-- Seeded from ZONE_ORDER + ZONE_DESC verbatim so the page reads identically on
-- day one. Hue drives nothing yet; it is set so a zone chip has a colour to
-- pick up if one is ever wanted.
insert into vocabulary_values (vocabulary, value, label, description, hue, sort_order)
values
  ('customer_zone', 'focus',      'Focus',      'the active book',          'emerald', 10),
  ('customer_zone', 'pipeline',   'Pipeline',   'proving value',            'blue',    20),
  ('customer_zone', 'evaluation', 'Evaluation', 'under strategic review',   'indigo',  30),
  ('customer_zone', 'closed',     'Closed',     'no longer active',         'neutral', 40)
on conflict (vocabulary, value) do nothing;

-- ── 3. Categories ──────────────────────────────────────────────────────────
-- sort_order follows CUSTOMER_CATEGORIES' canonical order, then the three
-- legacy values that exist in CATEGORY_TO_ZONE/CATEGORY_VARIANT but not in
-- CUSTOMER_CATEGORIES (Past, Dropped, Evaluation) so nothing already stored
-- can render unlabelled.
--
-- Hues map CATEGORY_VARIANT onto the 8-hue --st-* palette. One deliberate
-- change: POV used --brand-yellow, which is a FILL token and has no foreground
-- equivalent among the 8 chip hues (app/globals.css is explicit that
-- --brand-yellow must never be a foreground). It becomes blue, which is what
-- the approved mockup showed. One production customer is affected
-- (Charleston County School District) and the colour is now editable.
insert into vocabulary_values (vocabulary, value, label, hue, rollup, sort_order)
values
  ('customer_category', 'At Risk',            'At Risk',            'red',     'focus',      10),
  ('customer_category', 'Upcoming Renewals',  'Upcoming Renewals',  'amber',   'focus',      20),
  ('customer_category', 'Strategic Growth',   'Strategic Growth',   'emerald', 'focus',      30),
  ('customer_category', 'Active',             'Active',             'emerald', 'focus',      40),
  ('customer_category', 'Partner Managed',    'Partner Managed',    'fuchsia', 'focus',      50),
  ('customer_category', 'Secondary Priority', 'Secondary Priority', 'neutral', 'focus',      60),
  ('customer_category', 'POV',                'POV',                'blue',    'pipeline',   70),
  ('customer_category', 'Evaluation',         'Evaluation',         'indigo',  'evaluation', 80),
  ('customer_category', 'To Drop',            'To Drop',            'red',     'closed',     90),
  ('customer_category', 'Churned',            'Churned',            'neutral', 'closed',    100),
  ('customer_category', 'Past',               'Past',               'neutral', 'closed',    110),
  ('customer_category', 'Dropped',            'Dropped',            'neutral', 'closed',    120)
on conflict (vocabulary, value) do nothing;

-- ── 4. Anything already stored that the seed missed ────────────────────────
-- A category minted before this migration (the record card has allowed it
-- since 09ffb48) would otherwise have no row, and so no colour and no zone.
-- Filed under 'focus' to match today's `?? "Focus"` fallback exactly — same
-- behaviour, now visible and editable rather than implicit.
insert into vocabulary_values (vocabulary, value, label, hue, rollup, sort_order)
select distinct 'customer_category', c.custom_category, c.custom_category, 'neutral', 'focus', 500
  from customers c
 where c.custom_category is not null
   and btrim(c.custom_category) <> ''
   and not exists (
     select 1 from vocabulary_values v
      where v.vocabulary = 'customer_category' and v.value = c.custom_category
   )
on conflict (vocabulary, value) do nothing;

-- ── 5. Renaming a category has to move the customers pointing at it ───────
-- customers.custom_category stores the label itself, so a rename is two
-- writes that must not half-apply: 15 customers say 'Churned' today.
--
-- Deliberately does NOT preserve customers.last_manually_edited_at or touch
-- deliveryops_protected_fields: renaming a category is not an edit to any
-- individual customer's data, and marking 15 customers as hand-edited would
-- tell the sync to defend a field nobody chose to defend. Same reasoning as
-- 0038 keeping processes.updated_at out of a roster rename.
create or replace function rename_customer_category(
  p_from text,
  p_to   text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer;
begin
  if coalesce(btrim(p_to), '') = '' then
    raise exception 'A category name is required.';
  end if;
  if p_from = p_to then
    return 0;
  end if;
  if exists (select 1 from vocabulary_values
              where vocabulary = 'customer_category' and value = p_to) then
    raise exception 'A category called % already exists.', p_to;
  end if;

  update vocabulary_values
     set value = p_to, label = p_to, updated_at = now()
   where vocabulary = 'customer_category' and value = p_from;

  update customers
     set custom_category = p_to
   where custom_category = p_from;
  get diagnostics moved = row_count;

  return moved;
end;
$$;

comment on function rename_customer_category(text, text) is
  'Renames a customer category and repoints every customer carrying it, in one transaction. customers.custom_category stores the label rather than a slug, so the two cannot be updated separately without a window where a customer points at a category that no longer exists. Returns the number of customers moved.';

commit;
