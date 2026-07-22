-- Migration 0023 — Organizational entries don't need Project Type, Priority,
-- Status, or Manager/Lead. Relax those four columns to nullable; manager_lead_id
-- may only be NULL when is_organizational is true (enforced below, not just by
-- the app layer, since the role-check trigger already owns this invariant).

alter table public.project alter column project_type_id drop not null;
alter table public.project alter column priority        drop not null;
alter table public.project alter column status_id        drop not null;
alter table public.project alter column manager_lead_id  drop not null;

create or replace function public.trg_check_manager_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.manager_lead_id is null then
    if new.is_organizational then
      return new;
    end if;
    raise exception 'manager_lead_id is required unless the project is an organizational entry';
  end if;
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
