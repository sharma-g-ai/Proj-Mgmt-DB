-- ===========================================================================
-- Designations (managed job-title lookup) + Employee ID on users.
--
-- These are admin-managed, DESCRIPTIVE fields, independent of ACCESS. `role`
-- stays the sole access gate (is_admin() / manager_lead trigger) — unchanged.
--   * designation_id → a job title (Technical Lead, Software Engineer, …)
--   * employee_id    → external id like 'AMZ/IND/187'
-- ===========================================================================

-- Managed job-title list (mirrors project_type_option / status_option).
create table public.designation_option (
  option_id  uuid    primary key default gen_random_uuid(),
  label      text    not null unique,
  is_active  boolean not null default true
);

alter table public.designation_option enable row level security;

-- Read by any active user; write Admin-only (mirrors the other lookup lists).
create policy do_select on public.designation_option
  for select using (public.is_active_user());
create policy do_insert on public.designation_option
  for insert with check (public.is_admin());
create policy do_update on public.designation_option
  for update using (public.is_admin()) with check (public.is_admin());
create policy do_delete on public.designation_option
  for delete using (public.is_admin());

-- New user fields. Both nullable and access-independent. Deactivate a title
-- (is_active=false) rather than delete it, so no ON DELETE cascade is needed.
alter table public.users
  add column employee_id    text unique,
  add column designation_id uuid references public.designation_option(option_id) on update cascade;

-- Seed the job titles.
insert into public.designation_option (label) values
  ('Technical Lead'),
  ('Technical Architect'),
  ('Head'),
  ('Sr Software Engineer'),
  ('Software Engineer'),
  ('Sr UI/UX Designer'),
  ('Software Trainee')
on conflict (label) do nothing;
