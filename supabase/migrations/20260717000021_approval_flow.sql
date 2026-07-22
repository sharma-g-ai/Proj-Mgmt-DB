-- Migration 0021 — project change-request approval flow.
--
-- Manager-Lead edits to a project's Estimated Effort Hrs (any change), and any
-- resource-allocation change beyond the project's first staffing pass, are
-- staged here instead of writing directly, and only take effect once an Admin
-- approves. Admin's own edits are never gated (app-layer check in
-- app/projects/actions.ts) — they are the approver. See migration 0022 for the
-- requester-side `reason` column added alongside this table.

create type public.change_request_kind as enum ('EstimatedHours', 'Allocation');
create type public.change_request_status as enum ('Pending', 'Approved', 'Rejected');

create table public.project_change_request (
  request_id   uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.project(project_id) on delete cascade,
  requested_by uuid not null references public.users(user_id) on update cascade,
  kind         public.change_request_kind not null,
  payload      jsonb not null,
  summary      text not null,
  status       public.change_request_status not null default 'Pending',
  reviewed_by  uuid references public.users(user_id) on update cascade,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz not null default now()
);

create index idx_change_request_project on public.project_change_request (project_id);
create index idx_change_request_status  on public.project_change_request (status);

-- One pending request per project at a time — keeps review simple (no stacked
-- proposals) and blocks a Manager-Lead from resubmitting while one's unreviewed.
create unique index one_pending_request_per_project
  on public.project_change_request (project_id) where status = 'Pending';

alter table public.project_change_request enable row level security;

grant select, insert, update on public.project_change_request to authenticated;

-- Read: Admin (all, to review) or the project's own Manager-Lead (their own requests).
create policy pcr_select on public.project_change_request
  for select
  using (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

-- Insert: same scope — a Manager-Lead can only submit a request for a project
-- they lead (Admin edits never go through this table, per the app-layer gate).
create policy pcr_insert on public.project_change_request
  for insert
  with check (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

-- Update: Admin only (reviewing/approving/rejecting) — a Manager-Lead cannot
-- edit or self-approve their own submitted request.
create policy pcr_update on public.project_change_request
  for update
  using (public.is_admin())
  with check (public.is_admin());
