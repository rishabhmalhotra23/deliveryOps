-- Snapshot of every non-null `processes.phase` in PRODUCTION, taken
-- 2026-09-08 immediately before migration 0044 dropped the column.
--
-- Not a migration. Never applied automatically — `supabase/migrations/` is the
-- only directory safe-migrate reads, and this deliberately lives outside it.
--
-- WHY THIS EXISTS
-- ---------------
-- 0044 drops a column with data in it, and Postgres cannot undo that. The
-- audit said all but 5 of these 38 values were a 1:1 restatement of
-- `lifecycle` and the remaining 5 are post-live nuance already carried by
-- `work_mode` — but "we reasoned it was redundant" is not the same as "we can
-- put it back". This makes the drop reversible.
--
-- Read it as evidence, too: 6 of the 38 are visibly stale, which is the
-- argument for the drop rather than against it. Four `retired` processes still
-- claim "M1 - Discovery" and two `cancelled` ones claim "M3 - Testing/UAT",
-- because nothing ever cleared a phase when a lifecycle left the happy path.
--
-- TO RESTORE
-- ----------
--   create type process_phase as enum (
--     'pre_kickoff','m1_discovery','m2_development',
--     'm3_testing_uat','m4_deployment','m5_exception_handling');
--   alter table processes add column phase process_phase;
--   -- then run the updates below
--
-- Counts at the time of the snapshot: 149 live processes, 111 with phase null,
-- 38 with a value.

begin;

-- pre_kickoff (13)
update processes set phase = 'pre_kickoff' where id in (
  '2952c7e6-8b4c-404f-b8d3-466ba9f5cc14', -- Charleston County School District - Workflow Planning - POV (on_hold)
  '9d2b4bfb-b948-41c4-b924-2d4cb0f7358c', -- JBI - Compass Quote Update (backlog)
  'b951aaba-d86b-40d3-b74f-a3b75c1b60ad', -- JBI - Material Allocation Export Process (needs_triage)
  '10e2b725-6300-41e3-b9d1-c188e7018e93', -- JBI - Material Allocation Import Process (backlog)
  'cc7955e7-f031-459e-8f06-cb14d0a39809', -- Norco - HR Interview Reminder (needs_triage)
  '694a4a96-e916-49ef-bb78-741ce025818d', -- Plunkett - Vendor Bill creation from Multiple PO (needs_triage)
  '42aa5fc1-f915-462e-8d49-f20de4f47efb', -- Plunkett - Vendor Bill creation from PO (needs_triage)
  'afe67949-2c72-4007-b476-b4d2563e5255', -- Wipro BPS - iHeartRadio - Barter Affidavits (needs_triage)
  '919ffbaf-e65d-482e-a802-31c74e621f04', -- Wipro BPS - iHeartRadio - Bin & Pride (needs_triage)
  'a2964bc7-abbb-4513-92f5-a4f7da6a5852', -- Wipro BPS - iHeartRadio - Pool Report Process (needs_triage)
  '1a4f4f2c-5d64-4868-a3a4-63c031e92759', -- Wipro BPS - iHeartRadio - Premiere Programming Affidavits - Exceptions (needs_triage)
  '229c24d2-a455-47f0-affc-6c4100f9b3a4', -- Wipro BPS - iHeartRadio - Premiere Spots (needs_triage)
  '56ccbcfe-e3fa-451a-bdff-46fc0f6e3223', -- Wipro BPS - iHeartRadio - TTWN (needs_triage)
  '455765e2-7d7a-48e0-8a90-aa252167dad2'  -- Wipro FSS - GBL Audit Invoice Reconciliation (needs_triage)
);

-- m1_discovery (5) — 4 of these are `retired`, which is the staleness the
-- audit called out: a retired process claiming it is in discovery.
update processes set phase = 'm1_discovery' where id in (
  'cc960994-bc1a-4af1-9cea-cf4721952a14', -- American Towers POV (retired)
  'e009765d-6d78-42bb-82cc-d0237b761397', -- Concord POV (retired)
  '775b8464-9f9a-46f0-b482-da72891891ef', -- Conectiv - SONY Billing (discovery)
  '2f076c72-b484-4f20-9498-4d2e88087d7d', -- QMed - Pedigree Reconciliation POV (retired)
  '40ad9c8b-b6bc-4edb-a456-1d1c9151e008'  -- Siemens POV (retired)
);

-- m2_development (3)
update processes set phase = 'm2_development' where id in (
  'e92942d8-c8d3-45fd-92d1-f99fa9a355fc', -- JBI - Receiving Process (in_development)
  '64a57d64-acdc-4111-8250-ddbc09332fb2', -- Norco - Parts Reconciliation (in_development)
  '40c7372e-6529-4d0d-b747-c38348d92a15'  -- Wipro FSS - Collection Accounting (in_development)
);

-- m3_testing_uat (12) — includes the 2 `cancelled` rows still claiming UAT.
update processes set phase = 'm3_testing_uat' where id in (
  'c54bfa3a-ae69-4372-a1db-11e3ee9b4a98', -- BGV QC (uat)
  '841556ac-d36a-4db6-9662-f636b9b544e0', -- Century - Accounting Ops (uat)
  '0b0306dd-b6dd-4e71-a8e8-5f088e10d7d9', -- JBI - AP Invoice Processing (uat)
  'bdc89ec1-8e6b-4fcf-b975-36bb90b26a27', -- Kort Payments - 7 Docs (needs_triage)
  '1339d8ca-64e2-49a0-a229-b4fbe0e5016d', -- Kort Payments - Account Closures (needs_triage)
  '8b59e175-5b09-452a-a0ae-0ce81188c806', -- Kort Payments - Dash Deployment (needs_triage)
  '4b95655e-9161-40d8-ad30-e7b108d367d8', -- Kort Payments - Sales Support Field Transfer (needs_triage)
  '707d7af8-6619-4bfe-b230-d3783a5374db', -- Norco - Warranty (uat)
  'bb0cb69e-60f9-4d14-b5a0-cb0c742e6b98', -- Plunkett - Vendor Bill creation from Multiple PO (cancelled)
  'c3fbf4a1-db12-411f-97be-5589cde7a884', -- Plunkett - Vendor Bill creation from PO (cancelled)
  'd2d05677-dbf3-4bee-bbd1-3605299fbb60'  -- TTX - Property Tax Outline (needs_triage)
);

-- m4_deployment (1)
update processes set phase = 'm4_deployment' where id in (
  '1bd3a6b0-fbea-4cdb-8ecd-a6b531ddd9e0'  -- Wipro FSS - VHD Enhancements (live)
);

-- m5_exception_handling (4) — the only values that ever said something
-- lifecycle didn't. All four also carry work_mode, which is where this signal
-- lives now.
update processes set phase = 'm5_exception_handling' where id in (
  'dd866aff-3fa5-47d8-8311-d16ff6965739', -- Bradley & Beams - Tax File Renaming (live)
  'a18ffdaf-edd5-41eb-a8b1-5b9426e5adfb', -- Century - BOL (live)
  '22a85718-c898-4464-8123-67b3c585a5db', -- Century - Carrier Booking (live)
  '98bff320-7790-403a-9d90-c19da47279d2'  -- JBI - Time Cards (live)
);

commit;
