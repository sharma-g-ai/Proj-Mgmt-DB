-- seed_dummy.sql — synthetic dummy/test data for a CLONE database.
--
-- Distinct from supabase/seed.sql (which is real, production-derived data).
-- This file is entirely fictional and exercises every feature added since
-- the original seed was written: hours categories, organizational entries
-- (no type/priority/status/lead, no JIRA/Drive links, org-wide hours
-- logging), JIRA/Drive links on regular projects, and the approval flow
-- (Pending/Approved/Rejected change requests, approval notes, the
-- reviewed-request notification banner).
--
-- Run AFTER every migration in supabase/migrations/ has been applied to a
-- FRESH test database (not the production one). NOT meant to be combined
-- with the real supabase/seed.sql — pick one or the other for a given DB.
-- Executes as the postgres role (SQL Editor / db push), which bypasses RLS;
-- triggers (manager-lead role check, hours-team-member check) still run and
-- are satisfied by this data.
--
-- All dates are computed relative to the current date (this week's Monday,
-- `date_trunc('week', current_date)`), so the data looks "current" no matter
-- when this script is actually run, and every date lands on a weekday
-- (Mon–Fri) as the app's own validation expects.
--
-- Idempotency: the lookup tables, `users`, and `project` use
-- ON CONFLICT DO NOTHING (safe to re-run). `project_team_member`,
-- `hours_log_entry`, and `project_change_request` are NOT guarded — this
-- script is meant to run exactly once against an empty test database.

-- ---------------------------------------------------------------------------
-- 1. Users — 1 Admin, 4 Manager-Leads, 4 resources (no login), 2 pending
--    (unactivated) users, so every state in the Admin Users screen is
--    represented.
-- ---------------------------------------------------------------------------
with u (full_name, email, role, is_active, weekly_capacity_hrs, employee_id, designation) as (
  values
    ('Test Admin',    'admin.test@amzur.com',    'Admin',        true,  40, 'TEST/ADM/001', null),
    ('Alice Anderson','alice.anderson@amzur.com','Manager-Lead', true,  40, 'TEST/ML/001',  'Technical Lead'),
    ('Bob Brown',     'bob.brown@amzur.com',     'Manager-Lead', true,  40, 'TEST/ML/002',  'Technical Architect'),
    ('Carol Chen',    'carol.chen@amzur.com',    'Manager-Lead', true,  40, 'TEST/ML/003',  'Head'),
    ('Dave Diaz',     'dave.diaz@amzur.com',     'Manager-Lead', true,  20, 'TEST/ML/004',  'Sr Software Engineer'),
    ('Erin Evans',    'erin.evans@amzur.com',    null,           false, 40, 'TEST/RES/001', 'Software Engineer'),
    ('Frank Foster',  'frank.foster@amzur.com',  null,           false, 40, 'TEST/RES/002', 'Software Trainee'),
    ('Grace Garcia',  'grace.garcia@amzur.com',  null,           false, 40, 'TEST/RES/003', 'Sr UI/UX Designer'),
    ('Henry Hughes',  'henry.hughes@amzur.com',  null,           false, 40, 'TEST/RES/004', 'Software Engineer'),
    ('Ivy Ibarra',    'ivy.ibarra@amzur.com',    null,           false, 40, null,           null),
    ('Jack Jensen',   'jack.jensen@amzur.com',   null,           false, 40, null,           null)
)
insert into public.users (full_name, email, role, is_active, weekly_capacity_hrs, employee_id, designation_id)
select u.full_name, u.email, u.role::public.user_role, u.is_active, u.weekly_capacity_hrs, u.employee_id, d.option_id
from u
left join public.designation_option d on d.label = u.designation
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Lookup lists
-- ---------------------------------------------------------------------------
insert into public.project_type_option (label) values
  ('Revenue'), ('Product'), ('POC'), ('Training'), ('RFP')
on conflict (label) do nothing;

insert into public.status_option (label) values
  ('Not Started'), ('In Progress'), ('On Hold'), ('At Risk'), ('Completed')
on conflict (label) do nothing;

insert into public.holiday (date, label) values
  (date_trunc('week', current_date)::date + 21, 'Test Holiday One'),
  (date_trunc('week', current_date)::date + 35, 'Test Holiday Two')
on conflict (date) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Projects — 4 regular (one single-day, one archived) + 2 organizational
--    entries (single-day and multi-day), covering every project_metrics field
--    added since the original seed, including NULL type/priority/status/lead
--    and NULL jira/drive links on the organizational ones.
-- ---------------------------------------------------------------------------
with proj (project_name, stakeholder, type_label, priority, status_label, lead_email,
           start_date, end_date, est, jira_url, drive_url, description, stakeholder_description, status_detail,
           is_organizational) as (
  values
    ('Portal Revamp', 'External', 'Product', 'High', 'In Progress', 'alice.anderson@amzur.com',
       date_trunc('week', current_date)::date - 28, date_trunc('week', current_date)::date + 56, 200,
       'https://yourorg.atlassian.net/browse/PORTAL-101', 'https://drive.google.com/drive/folders/test-portal',
       'Full revamp of the customer portal UI and backend APIs.', 'Key external client, high visibility.', null,
       false),
    ('Client Analytics Dashboard', 'External', 'POC', 'Medium', 'In Progress', 'bob.brown@amzur.com',
       date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date + 42, 80,
       null, 'https://drive.google.com/drive/folders/test-analytics',
       null, null, 'Waiting on client data samples before finalizing schema.',
       false),
    ('Vendor Kickoff Workshop', 'Internal', 'Training', 'Low', 'Completed', 'alice.anderson@amzur.com',
       date_trunc('week', current_date)::date - 14, date_trunc('week', current_date)::date - 14, 8,
       null, null, 'One-day kickoff workshop with the new vendor.', null, 'Done',
       false),
    ('Legacy CRM Sunset', 'Internal', 'POC', 'Low', 'Completed', 'carol.chen@amzur.com',
       date_trunc('week', current_date)::date - 84, date_trunc('week', current_date)::date - 42, 60,
       null, null, null, null, 'Decommissioned, data archived.',
       false)
)
insert into public.project (project_name, stakeholder, project_type_id, priority, status_id, manager_lead_id,
                            start_date, planned_end_date, estimated_effort_hrs, jira_url, drive_url,
                            description, stakeholder_description, status_detail, is_organizational)
select p.project_name, p.stakeholder, pt.option_id, p.priority::public.project_priority, so.option_id, u.user_id,
       p.start_date, p.end_date, p.est, p.jira_url, p.drive_url, p.description, p.stakeholder_description,
       p.status_detail, p.is_organizational
from proj p
join public.project_type_option pt on pt.label = p.type_label
join public.status_option        so on so.label = p.status_label
join public.users                u  on lower(u.email) = p.lead_email
on conflict (project_name) do nothing;

-- Legacy CRM Sunset is archived (set separately — is_archived isn't in the CTE above).
update public.project set is_archived = true where project_name = 'Legacy CRM Sunset';

-- Organizational entries: no type/priority/status/lead/jira/drive.
insert into public.project (project_name, stakeholder, estimated_effort_hrs, start_date, planned_end_date,
                            is_organizational, description)
values
  ('Company All-Hands', 'Internal', 8,
     date_trunc('week', current_date)::date + 7, date_trunc('week', current_date)::date + 7,
     true, 'Quarterly company-wide all-hands meeting.'),
  ('Festive Holiday Break', 'Internal', 24,
     date_trunc('week', current_date)::date + 28, date_trunc('week', current_date)::date + 30,
     true, 'Office closed for the festive break.')
on conflict (project_name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Team & Allocation — regular projects only. The two organizational
--    entries are deliberately left unstaffed, to demonstrate that hours can
--    still be logged against them by anyone (no roster required, §5 below).
-- ---------------------------------------------------------------------------
with tm (project_name, email, hours, start_date, end_date) as (
  values
    ('Portal Revamp', 'alice.anderson@amzur.com', 120,
       date_trunc('week', current_date)::date - 28, date_trunc('week', current_date)::date + 56),
    ('Portal Revamp', 'erin.evans@amzur.com',       80,
       date_trunc('week', current_date)::date - 14, date_trunc('week', current_date)::date + 14),
    ('Portal Revamp', 'frank.foster@amzur.com',     24,
       date_trunc('week', current_date)::date,      date_trunc('week', current_date)::date + 14),
    ('Client Analytics Dashboard', 'bob.brown@amzur.com',   60,
       date_trunc('week', current_date)::date - 7,  date_trunc('week', current_date)::date + 21),
    ('Client Analytics Dashboard', 'grace.garcia@amzur.com', 30,
       date_trunc('week', current_date)::date,      date_trunc('week', current_date)::date + 21),
    ('Vendor Kickoff Workshop', 'alice.anderson@amzur.com',  8,
       date_trunc('week', current_date)::date - 14, date_trunc('week', current_date)::date - 14),
    ('Vendor Kickoff Workshop', 'henry.hughes@amzur.com',    8,
       date_trunc('week', current_date)::date - 14, date_trunc('week', current_date)::date - 14),
    ('Legacy CRM Sunset', 'carol.chen@amzur.com', 60,
       date_trunc('week', current_date)::date - 84, date_trunc('week', current_date)::date - 42),
    ('Legacy CRM Sunset', 'erin.evans@amzur.com',  40,
       date_trunc('week', current_date)::date - 84, date_trunc('week', current_date)::date - 56)
)
insert into public.project_team_member (project_id, user_id, allocated_hours, start_date, end_date)
select p.project_id, u.user_id, tm.hours, tm.start_date, tm.end_date
from tm
join public.project p on p.project_name = tm.project_name
join public.users   u on lower(u.email) = tm.email;

-- ---------------------------------------------------------------------------
-- 5. Hours Log — regular projects log hours only for their own team members
--    (trg_check_hours_member); "Company All-Hands" logs hours for people who
--    are NOT staffed anywhere near it, demonstrating the organizational-entry
--    carve-out (any active user, no roster needed). "Festive Holiday Break"
--    is left with no hours logged, to show that empty state too.
-- ---------------------------------------------------------------------------
with h (project_name, email, hours, category, start_date, end_date) as (
  values
    ('Portal Revamp', 'alice.anderson@amzur.com', 40, 'Implementation',
       date_trunc('week', current_date)::date - 28, date_trunc('week', current_date)::date - 24),
    ('Portal Revamp', 'erin.evans@amzur.com',      24, 'Collaboration',
       date_trunc('week', current_date)::date - 14, date_trunc('week', current_date)::date - 10),
    ('Portal Revamp', 'frank.foster@amzur.com',    16, 'Implementation',
       date_trunc('week', current_date)::date,      date_trunc('week', current_date)::date + 4),
    ('Client Analytics Dashboard', 'bob.brown@amzur.com',    20, 'Implementation',
       date_trunc('week', current_date)::date - 7,  date_trunc('week', current_date)::date - 3),
    ('Client Analytics Dashboard', 'grace.garcia@amzur.com', 10, 'Collaboration',
       date_trunc('week', current_date)::date,      date_trunc('week', current_date)::date + 4),
    ('Vendor Kickoff Workshop', 'alice.anderson@amzur.com', 8, 'Implementation',
       date_trunc('week', current_date)::date - 14, date_trunc('week', current_date)::date - 14),
    ('Vendor Kickoff Workshop', 'henry.hughes@amzur.com',   8, 'Collaboration',
       date_trunc('week', current_date)::date - 14, date_trunc('week', current_date)::date - 14),
    ('Legacy CRM Sunset', 'carol.chen@amzur.com', 60, 'Implementation',
       date_trunc('week', current_date)::date - 84, date_trunc('week', current_date)::date - 70),
    ('Legacy CRM Sunset', 'erin.evans@amzur.com',  40, 'Implementation',
       date_trunc('week', current_date)::date - 84, date_trunc('week', current_date)::date - 70),
    -- Organizational entry — none of these three are on any team roster.
    ('Company All-Hands', 'carol.chen@amzur.com', 4, 'Collaboration',
       date_trunc('week', current_date)::date + 7, date_trunc('week', current_date)::date + 7),
    ('Company All-Hands', 'dave.diaz@amzur.com',   4, 'Collaboration',
       date_trunc('week', current_date)::date + 7, date_trunc('week', current_date)::date + 7),
    ('Company All-Hands', 'erin.evans@amzur.com',  4, 'Collaboration',
       date_trunc('week', current_date)::date + 7, date_trunc('week', current_date)::date + 7)
)
insert into public.hours_log_entry (project_id, user_id, hours_logged, category, start_date, end_date, source)
select p.project_id, u.user_id, h.hours, h.category::public.hours_category, h.start_date, h.end_date, 'Manual'::public.hours_source
from h
join public.project p on p.project_name = h.project_name
join public.users   u on lower(u.email) = h.email;

-- ---------------------------------------------------------------------------
-- 6. Approval flow — one Pending (safe to actually click Approve/Reject on in
--    the test UI), one Approved and one Rejected Allocation request still
--    unacknowledged (so they show up on the requester's Dashboard banner),
--    and one older Approved request already acknowledged (so it does NOT
--    show up — demonstrating the dismissed state).
-- ---------------------------------------------------------------------------

-- Pending — EstimatedHours on Client Analytics Dashboard (currently 80).
insert into public.project_change_request (project_id, requested_by, kind, payload, summary, reason, status)
select p.project_id, u.user_id, 'EstimatedHours'::public.change_request_kind,
       jsonb_build_object('new_estimated_effort_hrs', 100),
       'Estimated Effort Hrs: 80 → 100',
       'Client requested an additional reporting module — scope increased.',
       'Pending'::public.change_request_status
from public.project p, public.users u
where p.project_name = 'Client Analytics Dashboard' and lower(u.email) = 'bob.brown@amzur.com';

-- Approved — Allocation update on Portal Revamp (Frank's hours 24 -> 40),
-- unacknowledged (shows on Alice's Dashboard banner).
insert into public.project_change_request
  (project_id, requested_by, kind, payload, summary, reason, status, reviewed_by, reviewed_at, review_note)
select
  p.project_id, req.user_id, 'Allocation'::public.change_request_kind,
  jsonb_build_object(
    'adds', '[]'::jsonb,
    'updates', jsonb_build_array(jsonb_build_object(
      'assignment_id', ptm.assignment_id,
      'start_date', ptm.start_date,
      'end_date', ptm.end_date,
      'allocated_hours', 40
    )),
    'removes', '[]'::jsonb
  ),
  'Frank Foster: 24h → 40h, ' || ptm.start_date || '–' || ptm.end_date,
  'Frank needs more hours to finish the API integration module.',
  'Approved'::public.change_request_status, admin.user_id, now() - interval '2 days', 'Approved — makes sense given the added scope.'
from public.project p
join public.project_team_member ptm on ptm.project_id = p.project_id
join public.users req   on lower(req.email) = 'alice.anderson@amzur.com'
join public.users admin on lower(admin.email) = 'admin.test@amzur.com'
join public.users fu    on fu.user_id = ptm.user_id and lower(fu.email) = 'frank.foster@amzur.com'
where p.project_name = 'Portal Revamp';

-- Rejected — Allocation add on Vendor Kickoff Workshop (already completed by
-- the time this was requested), unacknowledged.
insert into public.project_change_request
  (project_id, requested_by, kind, payload, summary, reason, status, reviewed_by, reviewed_at, review_note)
select
  p.project_id, req.user_id, 'Allocation'::public.change_request_kind,
  jsonb_build_object(
    'adds', jsonb_build_array(jsonb_build_object(
      'user_id', grace.user_id,
      'start_date', p.start_date,
      'end_date', p.planned_end_date,
      'allocated_hours', 16
    )),
    'updates', '[]'::jsonb,
    'removes', '[]'::jsonb
  ),
  '+ Grace Garcia: 16h, ' || p.start_date || '–' || p.planned_end_date,
  'Need design support for the workshop follow-up.',
  'Rejected'::public.change_request_status, admin.user_id, now() - interval '1 day', 'Workshop already completed — no longer needed.'
from public.project p
join public.users req   on lower(req.email) = 'alice.anderson@amzur.com'
join public.users admin on lower(admin.email) = 'admin.test@amzur.com'
join public.users grace on lower(grace.email) = 'grace.garcia@amzur.com'
where p.project_name = 'Vendor Kickoff Workshop';

-- Approved — EstimatedHours on Legacy CRM Sunset, already acknowledged (does
-- NOT show on Carol's Dashboard banner — demonstrates the dismissed state).
insert into public.project_change_request
  (project_id, requested_by, kind, payload, summary, reason, status, reviewed_by, reviewed_at, review_note, acknowledged_at)
select
  p.project_id, req.user_id, 'EstimatedHours'::public.change_request_kind,
  jsonb_build_object('new_estimated_effort_hrs', 60),
  'Estimated Effort Hrs: 50 → 60',
  'Underestimated the original decommissioning scope.',
  'Approved'::public.change_request_status, admin.user_id, now() - interval '30 days', 'Approved.', now() - interval '29 days'
from public.project p
join public.users req   on lower(req.email) = 'carol.chen@amzur.com'
join public.users admin on lower(admin.email) = 'admin.test@amzur.com'
where p.project_name = 'Legacy CRM Sunset';
