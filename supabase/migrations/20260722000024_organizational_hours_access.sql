-- Migration 0024 — org-wide hours logging on Organizational Entries.
--
-- Any active user (not just Admins, and not just a formal team roster) may now
-- view an organizational entry and log hours against it, for anyone. Editing
-- or deleting an existing hours entry on an organizational project stays
-- Admin-only — hours_log_entry has no "logged by" column, so there's no way
-- to scope "your own entries only" to a Manager-Lead.

create or replace function public.project_is_organizational(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_organizational from public.project where project_id = p_project), false);
$$;

grant execute on function public.project_is_organizational(uuid) to authenticated;

-- project_select: any active user can now see an organizational entry.
drop policy project_select on public.project;
create policy project_select on public.project
  for select
  using (
    public.is_admin()
    or (public.is_active_user() and manager_lead_id = auth.uid())
    or (public.is_active_user() and is_organizational)
  );

-- hours_select / hours_insert: any active user may view and log hours on an
-- organizational project. hours_update / hours_delete are untouched
-- (leader-or-admin only — Admin-only in practice for org entries, since they
-- have no leader).
drop policy hours_select on public.hours_log_entry;
create policy hours_select on public.hours_log_entry
  for select
  using (
    public.is_admin()
    or (public.is_active_user() and public.leads_project(project_id))
    or (public.is_active_user() and public.project_is_organizational(project_id))
  );

drop policy hours_insert on public.hours_log_entry;
create policy hours_insert on public.hours_log_entry
  for insert
  with check (
    public.is_admin()
    or (public.is_active_user() and public.leads_project(project_id))
    or (public.is_active_user() and public.project_is_organizational(project_id))
  );

-- trg_check_hours_member: skip the "must be a team member" check for
-- organizational projects — hours can be logged for any person there, no
-- roster setup required.
create or replace function public.trg_check_hours_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.project where project_id = new.project_id and is_organizational) then
    return new;
  end if;
  if not exists (
    select 1 from public.project_team_member
     where project_id = new.project_id
       and user_id    = new.user_id
  ) then
    raise exception
      'user % must be a team member of project % before hours can be logged',
      new.user_id, new.project_id;
  end if;
  return new;
end;
$$;
