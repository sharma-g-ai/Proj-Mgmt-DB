-- Migration 0001 — Schema (implements Spec 01 §2 Entities, §2 Constraints)
-- PM Dashboard v1. Supabase Postgres.
--
-- Notes on identity (Spec 01 §1.1, §5.1):
--   public.users.user_id holds the SAME UUID as the corresponding auth.users.id.
--   We intentionally do NOT declare a hard FK users.user_id -> auth.users(id):
--   Spec §5.1 requires that an Admin can pre-provision a public.users profile row
--   *before* that person's first Google sign-in (so no auth.users row exists yet),
--   and that the on_auth_user_created trigger later "links" it by setting
--   user_id = auth.users.id. A hard FK to auth.users would make that pre-provision
--   step impossible. The 1:1 correspondence is maintained by the provisioning
--   trigger (migration 0002) rather than a referential constraint.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role       as enum ('Admin', 'Manager-Lead');
create type public.project_priority as enum ('High', 'Medium', 'Low');
create type public.hours_source     as enum ('Manual', 'JIRA');

-- ---------------------------------------------------------------------------
-- 2.1 User  (public.users profile table)
-- ---------------------------------------------------------------------------
create table public.users (
  user_id             uuid        primary key default gen_random_uuid(),
  full_name           text        not null,
  email               text        not null unique,
  role                public.user_role,                       -- NULL while pending (§5.1)
  weekly_capacity_hrs numeric     not null default 40,        -- denominator for Allocation %
  is_active           boolean     not null default false,     -- pending until Admin activates
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Domain restriction backstop (§2.1 "Domain restriction"). auth-side check in 0002.
  constraint users_email_amzur_domain check (lower(email) like '%@amzur.com'),
  constraint users_weekly_capacity_nonneg check (weekly_capacity_hrs >= 0)
);

comment on table public.users is 'Spec 01 §2.1 — user profile; user_id mirrors auth.users.id (1:1, maintained by trigger).';

-- ---------------------------------------------------------------------------
-- 2.5 ProjectTypeOption  (managed lookup)
-- ---------------------------------------------------------------------------
create table public.project_type_option (
  option_id  uuid    primary key default gen_random_uuid(),
  label      text    not null unique,
  is_active  boolean not null default true
);

-- ---------------------------------------------------------------------------
-- 2.6 StatusOption  (managed lookup)
-- ---------------------------------------------------------------------------
create table public.status_option (
  option_id  uuid    primary key default gen_random_uuid(),
  label      text    not null unique,
  is_active  boolean not null default true
);

-- ---------------------------------------------------------------------------
-- 2.7 Holiday  (org calendar for working-day calculations)
-- ---------------------------------------------------------------------------
create table public.holiday (
  holiday_id uuid primary key default gen_random_uuid(),
  date       date not null unique,
  label      text
);

-- ---------------------------------------------------------------------------
-- 2.2 Project
-- ---------------------------------------------------------------------------
create table public.project (
  project_id            uuid        primary key default gen_random_uuid(),
  project_name          text        not null unique,
  stakeholder           text        not null,
  project_type_id       uuid        not null references public.project_type_option(option_id),
  priority              public.project_priority not null,
  status_id             uuid        not null references public.status_option(option_id),
  -- manager_lead_id must reference a User with role Manager-Lead or Admin.
  -- Role check is a cross-row rule enforced by a trigger (migration 0002).
  manager_lead_id       uuid        not null references public.users(user_id) on update cascade,
  start_date            date        not null,
  planned_end_date      date        not null,
  estimated_effort_hrs  numeric     not null,                  -- denominator for % Completion
  is_archived           boolean     not null default false,   -- soft-delete via archive
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint project_end_after_start check (planned_end_date >= start_date),      -- §4 Calendar Rules
  constraint project_estimated_effort_nonneg check (estimated_effort_hrs >= 0)
);

-- ---------------------------------------------------------------------------
-- 2.3 ProjectTeamMember  (team roster + weekly allocation)
-- ---------------------------------------------------------------------------
create table public.project_team_member (
  assignment_id   uuid        primary key default gen_random_uuid(),
  project_id      uuid        not null references public.project(project_id) on delete cascade,
  user_id         uuid        not null references public.users(user_id) on update cascade,
  allocation_pct  numeric     not null,                        -- % of weekly_capacity_hrs
  week_start_date date        not null,                        -- which week this row applies to
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- one allocation row per person per project per week (§2.3)
  constraint ptm_unique_person_project_week unique (project_id, user_id, week_start_date),
  constraint ptm_allocation_range check (allocation_pct >= 0 and allocation_pct <= 100)
);
-- Cross-project 100% hard-block (§2.3, §6.1) enforced by trigger in migration 0002.

-- ---------------------------------------------------------------------------
-- 2.4 HoursLogEntry  (manual completed-hours entries)
-- ---------------------------------------------------------------------------
create table public.hours_log_entry (
  entry_id     uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references public.project(project_id) on delete cascade,
  user_id      uuid        not null references public.users(user_id) on update cascade,
  hours_logged numeric     not null,
  entry_date   date        not null,
  source       public.hours_source not null default 'Manual',
  created_at   timestamptz not null default now(),
  constraint hours_logged_positive check (hours_logged > 0)
);
-- user_id must be a ProjectTeamMember of the same project (§2.4, §4.3):
-- cross-row rule enforced by trigger in migration 0002.

-- ---------------------------------------------------------------------------
-- Helpful indexes for the calculation queries (Spec 02) and RLS subqueries.
-- ---------------------------------------------------------------------------
create index idx_project_manager_lead     on public.project (manager_lead_id);
create index idx_ptm_project              on public.project_team_member (project_id);
create index idx_ptm_user_week            on public.project_team_member (user_id, week_start_date);
create index idx_hours_project            on public.hours_log_entry (project_id);
create index idx_hours_project_user       on public.hours_log_entry (project_id, user_id);
