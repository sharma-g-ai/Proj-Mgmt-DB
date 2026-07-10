-- seed.sql — initial data imported from ATG_Projects_Status - Projects.csv
--
-- Run AFTER migrations 0001–0005. Idempotent (ON CONFLICT DO NOTHING), so it is
-- safe to re-run. Executes as the postgres role (SQL Editor / db push), which
-- bypasses RLS; the manager-lead role trigger still runs and is satisfied.
--
-- Column mapping from the source CSV:
--   Stakeholder (External/Internal)      -> project.stakeholder (text)
--   unlabeled col (Revenue/Product/POC…) -> ProjectTypeOption  (project_type_id)
--   RI                                   -> project.manager_lead_id (the lead)
--   Team                                 -> ProjectTeamMember.user_id
--   Allocation                           -> allocation_pct (assigned to the week
--                                           of that row's Start Date, Monday-based)
--   Priority TOP/HIGH->High, MEDIUM->Medium, LOW/"N/A"->Low
--   Status (free text)                   -> a clean StatusOption + project.status_detail
--
-- Decisions (see supabase/README.md):
--  * People in the RI column are Manager-Lead + active; all other team members are
--    pending (role NULL, is_active false) until an Admin activates them. No Admin
--    is seeded — assign one later.
--  * Emails are synthesised as <firstname>@amzur.com (Geetashish's real address is
--    used). "ATG Team" (a group, not a person) is seeded as a placeholder user.
--  * "Estimates only": estimated_effort_hrs is taken from the "hrs required" column
--    where present (>0), else a nominal 40. No HoursLogEntry rows are seeded, so
--    every project's % Completion starts at 0 until real hours are logged.
--  * Team rows with a blank Allocation or blank Start Date are skipped (ATS has no
--    started work yet; two Pixorex rows have no dates).

-- ---------------------------------------------------------------------------
-- 1. Users  (RI leads active; team-only members pending)
-- ---------------------------------------------------------------------------
insert into public.users (full_name, email, role, is_active, weekly_capacity_hrs) values
  ('Rajesh',            'rajesh@amzur.com',              'Manager-Lead'::public.user_role, true,  40),
  ('Balu',              'balu@amzur.com',                'Manager-Lead'::public.user_role, true,  40),
  ('Siva',              'siva@amzur.com',                'Manager-Lead'::public.user_role, true,  40),
  ('Geetashish Sharma', 'geetashish.sharma@amzur.com',   'Manager-Lead'::public.user_role, true,  40),
  ('Yogitha',           'yogitha@amzur.com',             null::public.user_role,           false, 40),
  ('Pushpa',            'pushpa@amzur.com',              null::public.user_role,           false, 40),
  ('Lavanya',           'lavanya@amzur.com',             null::public.user_role,           false, 40),
  ('Raghu',             'raghu@amzur.com',               null::public.user_role,           false, 40),
  ('Vishnu',            'vishnu@amzur.com',              null::public.user_role,           false, 40),
  ('Murali',            'murali@amzur.com',              null::public.user_role,           false, 40),
  ('Iswarya',           'iswarya@amzur.com',             null::public.user_role,           false, 40),
  ('Teja',              'teja@amzur.com',                null::public.user_role,           false, 40),
  ('Amrutha',           'amrutha@amzur.com',             null::public.user_role,           false, 40),
  ('Suchith',           'suchith@amzur.com',             null::public.user_role,           false, 40),
  ('ATG Team',          'atg.team@amzur.com',            null::public.user_role,           false, 40)
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Lookup lists
-- ---------------------------------------------------------------------------
-- Project types actually used in the source data.
insert into public.project_type_option (label) values
  ('Revenue'), ('Product'), ('POC'), ('Training'), ('RFP')
on conflict (label) do nothing;

-- Clean status categories (superset of what the data maps onto).
insert into public.status_option (label) values
  ('Not Started'), ('In Progress'), ('On Hold'), ('At Risk'), ('Completed')
on conflict (label) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Projects
-- ---------------------------------------------------------------------------
with proj (project_name, stakeholder, type_label, priority, status_label,
           lead_email, start_date, planned_end_date, est, status_detail) as (
  values
    ('F2MX',            'External', 'Revenue',  'High',   'In Progress', 'rajesh@amzur.com',
       date '2026-06-04', date '2026-07-31', 40, null),
    ('MyWork Mate',     'External', 'Product',  'High',   'In Progress', 'balu@amzur.com',
       date '2025-12-15', date '2026-07-30', 160, 'In Internal Testing, working on Feedback'),
    ('Procurement App', 'Internal', 'POC',      'High',   'In Progress', 'siva@amzur.com',
       date '2026-05-21', date '2026-07-17', 64,
       'Need to share demo with Guru, walkthrough the bugs identified. Estimates yet to prepare on reviews and plan for end date. Currently we may need about 80 man hours to fix the edge cases.'),
    ('QAstra',          'Internal', 'POC',      'Medium', 'In Progress', 'siva@amzur.com',
       date '2026-04-10', date '2026-07-31', 160, null),
    ('ATS',             'Internal', 'POC',      'Low',    'Not Started', 'siva@amzur.com',
       date '2026-06-30', date '2026-06-30', 40,
       'Bench sales & Talent Acquisition (Applicant Tracking System). Had high level requirement with Sam on June-30th. Not yet started, need to start work on requirement analysis.'),
    ('AI Forge',        'Internal', 'Training', 'Low',    'Completed',   'siva@amzur.com',
       date '2026-05-01', date '2026-06-30', 40, 'In closure phase'),
    ('AI Live Avatar',  'Internal', 'POC',      'Low',    'Completed',   'geetashish.sharma@amzur.com',
       date '2026-03-06', date '2026-04-22', 40,
       'Explored different services for Live avatar generation, need to explore native rendering solutions. Individual receptionist - Hospitals etc (Local server instead of Cloud). Only research is done.'),
    ('Code Migration',  'Internal', 'POC',      'Medium', 'Completed',   'geetashish.sharma@amzur.com',
       date '2026-04-01', date '2026-06-18', 40, 'Presented to Bala, Moving on to Oracle Forms Migration'),
    ('Sail',            'External', 'RFP',      'Medium', 'Completed',   'geetashish.sharma@amzur.com',
       date '2026-05-14', date '2026-06-10', 40, 'Proposal Presented to SAIL. Waiting for updates.'),
    ('Artefact UAE',    'External', 'RFP',      'Medium', 'Completed',   'geetashish.sharma@amzur.com',
       date '2026-07-02', date '2026-07-06', 16, 'Done'),
    ('USU - Web',       'External', 'RFP',      'Medium', 'Completed',   'geetashish.sharma@amzur.com',
       date '2026-07-02', date '2026-07-03', 8, 'Done'),
    ('Pixorex',         'External', 'Product',  'High',   'Completed',   'geetashish.sharma@amzur.com',
       date '2026-04-04', date '2026-04-16', 40, 'Moving to productization phase')
)
insert into public.project (project_name, stakeholder, project_type_id, priority, status_id,
                            manager_lead_id, start_date, planned_end_date, estimated_effort_hrs, status_detail)
select p.project_name, p.stakeholder, pt.option_id, p.priority::public.project_priority, so.option_id,
       u.user_id, p.start_date, p.planned_end_date, p.est, p.status_detail
from proj p
join public.project_type_option pt on pt.label = p.type_label
join public.status_option        so on so.label = p.status_label
join public.users                u  on lower(u.email) = p.lead_email
on conflict (project_name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Project team members — each a date-range allocation (start_date..end_date)
-- from the source CSV's per-row Start / Planned End dates. The CSV expressed
-- allocation as a % of weekly capacity; we convert to man-hours here:
-- allocated_hours = pct/100 × (weekly_capacity/5 daily) × weekdays in range.
--
-- Over-allocation is now a soft signal (no trigger), so no disable dance and no
-- forced archiving are needed. Several resources are genuinely over-allocated
-- across overlapping projects (e.g. Lavanya on F2MX + Procurement App) — the
-- dashboard Resource Utilization view surfaces that, which is the point.
-- Rows with a blank Allocation or blank dates in the CSV are omitted.
-- ---------------------------------------------------------------------------
with tm (project_name, email, allocation, start_date, end_date) as (
  values
    ('F2MX',            'rajesh@amzur.com',            100, date '2026-06-04', date '2026-07-15'),
    ('F2MX',            'yogitha@amzur.com',           100, date '2026-06-04', date '2026-07-31'),
    ('F2MX',            'pushpa@amzur.com',            100, date '2026-06-04', date '2026-07-31'),
    ('F2MX',            'lavanya@amzur.com',           100, date '2026-06-30', date '2026-07-31'),
    ('F2MX',            'raghu@amzur.com',             100, date '2026-06-30', date '2026-07-31'),
    ('F2MX',            'siva@amzur.com',               25, date '2026-06-04', date '2026-07-08'),
    ('MyWork Mate',     'vishnu@amzur.com',            100, date '2025-12-15', date '2026-06-19'),
    ('MyWork Mate',     'murali@amzur.com',             50, date '2026-03-10', date '2026-07-30'),
    ('MyWork Mate',     'iswarya@amzur.com',           100, date '2026-02-09', date '2026-07-30'),
    ('Procurement App', 'lavanya@amzur.com',           100, date '2026-06-15', date '2026-06-30'),
    ('Procurement App', 'siva@amzur.com',               35, date '2026-05-21', date '2026-07-17'),
    ('QAstra',          'balu@amzur.com',               30, date '2026-04-10', date '2026-07-31'),
    ('QAstra',          'siva@amzur.com',               10, date '2026-04-10', date '2026-07-31'),
    ('QAstra',          'teja@amzur.com',              100, date '2026-04-10', date '2026-07-31'),
    ('AI Forge',        'atg.team@amzur.com',          100, date '2026-05-01', date '2026-06-30'),
    ('AI Live Avatar',  'amrutha@amzur.com',           100, date '2026-03-06', date '2026-04-22'),
    ('Code Migration',  'geetashish.sharma@amzur.com', 100, date '2026-04-01', date '2026-06-18'),
    ('Code Migration',  'suchith@amzur.com',           100, date '2026-04-01', date '2026-06-18'),
    ('Code Migration',  'amrutha@amzur.com',           100, date '2026-06-01', date '2026-06-18'),
    ('Sail',            'geetashish.sharma@amzur.com', 100, date '2026-05-14', date '2026-06-10'),
    ('Artefact UAE',    'geetashish.sharma@amzur.com', 100, date '2026-07-02', date '2026-07-06'),
    ('USU - Web',       'geetashish.sharma@amzur.com', 100, date '2026-07-02', date '2026-07-03'),
    ('Pixorex',         'lavanya@amzur.com',            50, date '2026-04-04', date '2026-04-16')
)
insert into public.project_team_member (project_id, user_id, allocated_hours, start_date, end_date)
select p.project_id, u.user_id,
       round(tm.allocation / 100.0 * (u.weekly_capacity_hrs / 5.0)
             * public.fn_working_days(tm.start_date, tm.end_date), 2),
       tm.start_date, tm.end_date
from tm
join public.project p on p.project_name = tm.project_name
join public.users   u on lower(u.email) = tm.email;
