-- Historical NPS responses (backfilled from the team's canonical Excel
-- tracker, spanning 2Q24-4Q26) sometimes answered "N/A" on the ease-rating
-- questions -- a respondent who hadn't done that particular thing yet.
-- The live survey form (app/nps/respond/[token]) always asks a strict 1-5
-- scale with no N/A option, so new submissions will always populate these;
-- this only relaxes the column for backfilled historical rows. The 1-5
-- check constraint is untouched -- Postgres check constraints already pass
-- through NULL (they only ever reject a value that's present and out of
-- range), so nothing needs re-adding there.

alter table nps_response_details
  alter column ease_creating_automation drop not null,
  alter column ease_business_user_acceptance drop not null,
  alter column ease_business_case drop not null,
  alter column ease_identifying_processes drop not null,
  alter column ease_self_sufficiency drop not null,
  alter column ease_support_guidance drop not null;
