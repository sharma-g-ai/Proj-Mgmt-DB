-- Migration 0007 — block deactivating a user who still leads an active project.
--
-- Spec 06 §4 / §6.1: if a user is currently manager_lead_id on any non-archived
-- project, deactivation (is_active true -> false) is rejected. The Admin must
-- reassign those projects first. This is the authoritative DB-level guard; the
-- User CRUD server action also pre-checks so it can name the blocking projects.
-- security definer so it sees all projects regardless of the caller's RLS scope.

create or replace function public.trg_block_deactivate_active_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projects text;
begin
  if old.is_active = true and new.is_active = false then
    select string_agg(project_name, ', ' order by project_name)
      into v_projects
      from public.project
      where manager_lead_id = new.user_id
        and is_archived = false;

    if v_projects is not null then
      raise exception
        'Cannot deactivate: still Manager-Lead on active project(s): %. Reassign these first.',
        v_projects;
    end if;
  end if;
  return new;
end;
$$;

create trigger block_deactivate_active_lead
  before update of is_active on public.users
  for each row execute function public.trg_block_deactivate_active_lead();
