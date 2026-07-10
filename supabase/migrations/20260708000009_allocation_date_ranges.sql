-- Migration 0009 — allocation date ranges (replaces the weekly-row model).
--
-- Product change: each ProjectTeamMember row now represents an allocation over a
-- date range (start_date..end_date) at a given allocation_pct, instead of a single
-- week_start_date. Man-hours for a resource on a project = allocation_pct/100 ×
-- weekly_capacity_hrs × (number of weeks the range spans). Over-allocation stays a
-- per-week rule, now evaluated across every week a range covers.
--
-- Existing rows are migrated to 1-week ranges (start = week_start, end = +6 days),
-- which preserves their current meaning and stays within the 100% rule. Extend them
-- to real ranges via the Team & Allocation UI.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
alter table public.project_team_member add column start_date date;
alter table public.project_team_member add column end_date date;

update public.project_team_member
  set start_date = week_start_date,
      end_date   = week_start_date + 6;

alter table public.project_team_member alter column start_date set not null;
alter table public.project_team_member alter column end_date   set not null;
alter table public.project_team_member add constraint ptm_end_after_start check (end_date >= start_date);

-- Drop the weekly uniqueness + column (this also drops idx_ptm_user_week).
alter table public.project_team_member drop constraint ptm_unique_person_project_week;
alter table public.project_team_member drop column week_start_date;

create index idx_ptm_user_range on public.project_team_member (user_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- 2. Week helper + range-aware calculation functions (Spec 02, revised)
-- ---------------------------------------------------------------------------

-- Number of Monday-weeks a range spans (inclusive). >= 1 for any valid range.
create or replace function public.fn_alloc_weeks(p_start date, p_end date)
returns integer language sql immutable as $$
  select greatest(0,
    (date_trunc('week', p_end)::date - date_trunc('week', p_start)::date) / 7 + 1);
$$;

-- An allocation covers the week whose Monday is p_week iff its range intersects
-- [p_week, p_week + 6].

create or replace function public.fn_project_allocated_hours(p_project uuid, p_week date)
returns numeric language sql stable as $$
  select coalesce(sum(ptm.allocation_pct / 100.0 * u.weekly_capacity_hrs), 0)
  from public.project_team_member ptm
  join public.users u on u.user_id = ptm.user_id
  where ptm.project_id = p_project
    and ptm.start_date <= p_week + 6
    and ptm.end_date   >= p_week;
$$;

-- Capacity uses DISTINCT users covering the week (a user counts once).
create or replace function public.fn_project_capacity_hours(p_project uuid, p_week date)
returns numeric language sql stable as $$
  select coalesce(sum(weekly_capacity_hrs), 0)
  from (
    select distinct ptm.user_id, u.weekly_capacity_hrs
    from public.project_team_member ptm
    join public.users u on u.user_id = ptm.user_id
    where ptm.project_id = p_project
      and ptm.start_date <= p_week + 6
      and ptm.end_date   >= p_week
  ) d;
$$;

create or replace function public.fn_project_allocation_pct_week(p_project uuid, p_week date)
returns numeric language sql stable as $$
  select case
    when public.fn_project_capacity_hours(p_project, p_week) = 0 then null
    else public.fn_project_allocated_hours(p_project, p_week)
       / public.fn_project_capacity_hours(p_project, p_week) * 100
  end;
$$;

-- Rolled-up total = hours-weighted across each member's covered weeks:
-- Σ(pct/100 × cap × weeks) ÷ Σ(cap × weeks) × 100.
create or replace function public.fn_project_total_allocation_pct(p_project uuid)
returns numeric language sql stable as $$
  select case
    when coalesce(sum(u.weekly_capacity_hrs * public.fn_alloc_weeks(ptm.start_date, ptm.end_date)), 0) = 0 then null
    else sum(ptm.allocation_pct / 100.0 * u.weekly_capacity_hrs * public.fn_alloc_weeks(ptm.start_date, ptm.end_date))
       / sum(u.weekly_capacity_hrs * public.fn_alloc_weeks(ptm.start_date, ptm.end_date)) * 100
  end
  from public.project_team_member ptm
  join public.users u on u.user_id = ptm.user_id
  where ptm.project_id = p_project;
$$;

-- Heatmap cross-project person total for a week (range coverage), still the
-- Spec 03 §4.6 security-definer exception.
create or replace function public.fn_person_total_allocation_pct(p_user uuid, p_week date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(ptm.allocation_pct), 0)
  from public.project_team_member ptm
  join public.project p on p.project_id = ptm.project_id
  where ptm.user_id = p_user
    and p.is_archived = false
    and ptm.start_date <= p_week + 6
    and ptm.end_date   >= p_week;
$$;

-- ---------------------------------------------------------------------------
-- 3. Over-allocation hard block — now per-week across each covered week.
-- ---------------------------------------------------------------------------
create or replace function public.trg_check_overallocation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  w date;
  v_other numeric;
begin
  for w in
    select generate_series(
      date_trunc('week', new.start_date)::date,
      date_trunc('week', new.end_date)::date,
      interval '1 week')::date
  loop
    select coalesce(sum(ptm.allocation_pct), 0)
      into v_other
      from public.project_team_member ptm
      join public.project p on p.project_id = ptm.project_id
     where ptm.user_id       = new.user_id
       and ptm.assignment_id <> new.assignment_id
       and p.is_archived      = false
       and ptm.start_date    <= w + 6
       and ptm.end_date      >= w;

    if v_other + new.allocation_pct > 100 then
      raise exception
        'Over-allocation blocked: user % would reach %%% in the week of % (limit 100%%)',
        new.user_id, v_other + new.allocation_pct, w;
    end if;
  end loop;
  return new;
end;
$$;

-- (Trigger check_overallocation on project_team_member is unchanged — it now
--  runs this revised function.)
