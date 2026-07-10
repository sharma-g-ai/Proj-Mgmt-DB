-- Migration 0002 — Functions & Triggers
-- Implements: Spec 01 §5.1 (identity provisioning), §2.3/§6.1 (over-allocation hard block),
-- §2.4/§4.3 (hours-log team-member check), §2.2 (manager_lead role check),
-- and system-managed updated_at.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.trg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.users
  for each row execute function public.trg_set_updated_at();
create trigger set_updated_at before update on public.project
  for each row execute function public.trg_set_updated_at();
create trigger set_updated_at before update on public.project_team_member
  for each row execute function public.trg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Spec 01 §5.1 — Identity provisioning on first Google sign-in.
-- AFTER INSERT ON auth.users:
--   1. Domain check: reject non-@amzur.com emails (backstop behind OAuth restriction).
--   2. Provision or link the public.users profile row.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (1) Domain check — reject records outside the Amzur domain.
  if new.email is null or lower(new.email) not like '%@amzur.com' then
    raise exception 'Email domain not allowed for %; only @amzur.com accounts may sign in', new.email;
  end if;

  -- (2) If an Admin pre-created a profile row for this email, link it (preserve
  --     whatever role / is_active the Admin already set) by adopting the auth id.
  update public.users
     set user_id   = new.id,
         full_name = coalesce(nullif(full_name, ''),
                              new.raw_user_meta_data->>'full_name',
                              new.raw_user_meta_data->>'name',
                              new.email)
   where lower(email) = lower(new.email);

  -- Otherwise create a fresh pending profile (role NULL, is_active false).
  if not found then
    insert into public.users (user_id, full_name, email, role, is_active)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name',
               new.raw_user_meta_data->>'name',
               new.email),
      new.email,
      null,
      false
    );
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Spec 01 §2.2 — Project.manager_lead_id must reference a User whose role is
-- 'Manager-Lead' or 'Admin'. Cross-row rule -> trigger, not a column constraint.
-- ---------------------------------------------------------------------------
create or replace function public.trg_check_manager_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users
     where user_id = new.manager_lead_id
       and role in ('Admin', 'Manager-Lead')
  ) then
    raise exception 'manager_lead_id % must reference a User with role Admin or Manager-Lead', new.manager_lead_id;
  end if;
  return new;
end;
$$;

create trigger check_manager_lead
  before insert or update of manager_lead_id on public.project
  for each row execute function public.trg_check_manager_lead();

-- ---------------------------------------------------------------------------
-- Spec 01 §2.3 / §6.1 — Over-allocation HARD BLOCK.
-- A person's summed allocation_pct across all ACTIVE (non-archived) projects for
-- a given week_start_date must not exceed 100%. Runs security definer so the
-- check spans projects the acting Manager-Lead cannot otherwise see (RLS bypass
-- limited to this validation).
-- ---------------------------------------------------------------------------
create or replace function public.trg_check_overallocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other_total numeric;
begin
  select coalesce(sum(ptm.allocation_pct), 0)
    into v_other_total
    from public.project_team_member ptm
    join public.project p on p.project_id = ptm.project_id
   where ptm.user_id         = new.user_id
     and ptm.week_start_date = new.week_start_date
     and p.is_archived       = false
     and ptm.assignment_id  <> new.assignment_id;   -- exclude the row being updated

  if v_other_total + new.allocation_pct > 100 then
    raise exception
      'Over-allocation blocked: user % would reach %%% for week % (limit 100%%)',
      new.user_id, v_other_total + new.allocation_pct, new.week_start_date;
  end if;

  return new;
end;
$$;

create trigger check_overallocation
  before insert or update on public.project_team_member
  for each row execute function public.trg_check_overallocation();

-- ---------------------------------------------------------------------------
-- Spec 01 §2.4 / Spec 03 §4.3 — HoursLogEntry.user_id must belong to an existing
-- ProjectTeamMember row for the same project. Cross-row business rule -> trigger.
-- ---------------------------------------------------------------------------
create or replace function public.trg_check_hours_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

create trigger check_hours_member
  before insert or update on public.hours_log_entry
  for each row execute function public.trg_check_hours_member();
