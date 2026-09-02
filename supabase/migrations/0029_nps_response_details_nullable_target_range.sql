-- Historical responses' "how many processes do you target automating"
-- question used a coarser 3-bucket scale (1-5 / 6-10 / more than 10) than
-- the current 5-bucket form (1-5 / 6-10 / 11-25 / 26-50 / 50+). "More than
-- 10" doesn't map to a single one of the current buckets without guessing,
-- so those backfilled rows leave this column null rather than picking an
-- arbitrary bucket. The live survey form always populates it.

alter table nps_response_details
  alter column automation_target_range drop not null;
