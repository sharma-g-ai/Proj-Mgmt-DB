-- Migration 0004 — Access Control / RLS (implements Spec 03)
--
-- RLS is the single source of truth for access scoping (Spec 03 §7). Every
-- policy also honors the global rule from §3: only ACTIVE users get data access.
-- The illustrative policies in §4 omit the is_active guard for brevity; we fold
-- it in via is_active_user() so pending/inactive users see zero rows everywhere,
-- exactly as §3 / §7 require.

-- ---------------------------------------------------------------------------
-- Helper functions (Spec 03 §2). SECURITY DEFINER so policy predicates can read
-- public.users / public.project without recursively triggering RLS.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where user_id = auth.uid() and role = 'Admin' and is_active = true
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where user_id = auth.uid() and is_active = true
  );
$$;

-- "own projects" scoping key (Spec 03 §5): caller is the project's manager_lead.
create or replace function public.leads_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project
    where project_id = p_project and manager_lead_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Spec 03 §4.6 (exception) — heatmap cross-project total allocation.
-- SECURITY DEFINER so a Manager-Lead can see a person's TOTAL weekly allocation
-- across projects they cannot otherwise read. Returns only the aggregate percent
-- (sum of allocation_pct across active projects) — never row-level project detail.
-- ---------------------------------------------------------------------------
create or replace function public.fn_person_total_allocation_pct(p_user uuid, p_week date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(ptm.allocation_pct), 0)
  from public.project_team_member ptm
  join public.project p on p.project_id = ptm.project_id
  where ptm.user_id = p_user
    and ptm.week_start_date = p_week
    and p.is_archived = false;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table.
-- ---------------------------------------------------------------------------
alter table public.users               enable row level security;
alter table public.project             enable row level security;
alter table public.project_team_member enable row level security;
alter table public.hours_log_entry     enable row level security;
alter table public.project_type_option enable row level security;
alter table public.status_option       enable row level security;
alter table public.holiday             enable row level security;

-- ---------------------------------------------------------------------------
-- Base privileges. RLS narrows these; without the GRANTs the authenticated role
-- would have no access at all. anon (unauthenticated) gets nothing — login is
-- required. Profile INSERT/user provisioning happens via the security-definer
-- trigger or the service-role key (which bypass RLS), so no client INSERT grant
-- on public.users.
-- ---------------------------------------------------------------------------
grant select, update on public.users to authenticated;
grant select, insert, update, delete on public.project to authenticated;
grant select, insert, update, delete on public.project_team_member to authenticated;
grant select, insert, update, delete on public.hours_log_entry to authenticated;
grant select, insert, update, delete on public.project_type_option to authenticated;
grant select, insert, update, delete on public.status_option to authenticated;
grant select, insert, update, delete on public.holiday to authenticated;
grant select on public.project_metrics to authenticated;

grant execute on function public.is_admin(),
                          public.is_active_user(),
                          public.leads_project(uuid),
                          public.fn_person_total_allocation_pct(uuid, date),
                          public.fn_working_days(date, date),
                          public.fn_project_allocated_hours(uuid, date),
                          public.fn_project_capacity_hours(uuid, date),
                          public.fn_project_allocation_pct_week(uuid, date),
                          public.fn_project_total_allocation_pct(uuid),
                          public.fn_project_logged_hours(uuid),
                          public.fn_project_pct_completion(uuid),
                          public.fn_project_pending_hours(uuid),
                          public.fn_project_pending_pct(uuid)
  to authenticated;

-- ===========================================================================
-- 4.4  User
-- ===========================================================================
-- SELECT: Admins see all; Manager-Leads read active users (team picker). Literal
-- per §4.4 `using (is_admin() or is_active = true)`, additionally gated so the
-- CALLER must be active (§3) — pending users read nothing.
create policy users_select on public.users
  for select
  using (is_admin() or (public.is_active_user() and is_active = true));

-- UPDATE: Admins only (role changes, activation, edits).
create policy users_update on public.users
  for update
  using (public.is_admin())
  with check (public.is_admin());
-- (No client INSERT/DELETE policy: provisioning is trigger/service-role only;
--  users are soft-deactivated via UPDATE, never hard-deleted — Spec 01 §5.)

-- ===========================================================================
-- 4.1  Project
-- ===========================================================================
create policy project_select on public.project
  for select
  using (public.is_admin() or (public.is_active_user() and manager_lead_id = auth.uid()));

-- INSERT: both roles create; a Manager-Lead may only set themselves as lead.
create policy project_insert on public.project
  for insert
  with check (public.is_admin() or (public.is_active_user() and manager_lead_id = auth.uid()));

-- UPDATE: own projects only unless Admin. WITH CHECK stops a Manager-Lead from
-- reassigning manager_lead_id to someone else (§4.1 last row).
create policy project_update on public.project
  for update
  using (public.is_admin() or (public.is_active_user() and manager_lead_id = auth.uid()))
  with check (public.is_admin() or (public.is_active_user() and manager_lead_id = auth.uid()));

-- DELETE/Archive: own projects only unless Admin (soft-archive is an UPDATE, but
-- the DELETE policy is provided for completeness / hard-delete by Admin tooling).
create policy project_delete on public.project
  for delete
  using (public.is_admin() or (public.is_active_user() and manager_lead_id = auth.uid()));

-- ===========================================================================
-- 4.2  ProjectTeamMember — scope inherited from parent project.
-- ===========================================================================
create policy ptm_select on public.project_team_member
  for select
  using (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

create policy ptm_insert on public.project_team_member
  for insert
  with check (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

create policy ptm_update on public.project_team_member
  for update
  using (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)))
  with check (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

create policy ptm_delete on public.project_team_member
  for delete
  using (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

-- ===========================================================================
-- 4.3  HoursLogEntry — same scope as §4.2. (team-member CHECK is a trigger.)
-- ===========================================================================
create policy hours_select on public.hours_log_entry
  for select
  using (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

create policy hours_insert on public.hours_log_entry
  for insert
  with check (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

create policy hours_update on public.hours_log_entry
  for update
  using (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)))
  with check (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

create policy hours_delete on public.hours_log_entry
  for delete
  using (public.is_admin() or (public.is_active_user() and public.leads_project(project_id)));

-- ===========================================================================
-- 4.5  Lookup lists — read by any active user; write Admin-only.
-- ===========================================================================
-- project_type_option
create policy pto_select on public.project_type_option
  for select using (public.is_active_user());
create policy pto_insert on public.project_type_option
  for insert with check (public.is_admin());
create policy pto_update on public.project_type_option
  for update using (public.is_admin()) with check (public.is_admin());
create policy pto_delete on public.project_type_option
  for delete using (public.is_admin());

-- status_option
create policy so_select on public.status_option
  for select using (public.is_active_user());
create policy so_insert on public.status_option
  for insert with check (public.is_admin());
create policy so_update on public.status_option
  for update using (public.is_admin()) with check (public.is_admin());
create policy so_delete on public.status_option
  for delete using (public.is_admin());

-- holiday
create policy holiday_select on public.holiday
  for select using (public.is_active_user());
create policy holiday_insert on public.holiday
  for insert with check (public.is_admin());
create policy holiday_update on public.holiday
  for update using (public.is_admin()) with check (public.is_admin());
create policy holiday_delete on public.holiday
  for delete using (public.is_admin());
