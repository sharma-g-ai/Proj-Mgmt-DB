-- Migration 0010 — man-hours-only allocation + project description fields.
--
-- Product change: allocation is now measured purely in man-hours. Each
-- project_team_member row stores allocated_hours over a date range; the tool
-- reports whether a resource is over/under-allocated across all projects as a
-- man-hours delta over BUSINESS (weekday) working days. allocation_pct and the
-- project-level percentage functions are removed, and over-allocation is now a
-- soft signal (no hard-block trigger).
--
-- "Working days" = weekdays (Mon–Fri). Holidays are ignored for now, so the
-- existing fn_working_days (which excludes weekends + the Holiday table) equals a
-- weekday-only count while Holiday is empty.

-- ---------------------------------------------------------------------------
-- 1. Drop the over-allocation hard block FIRST (now a soft, surfaced signal).
-- Must happen before the backfill UPDATE below, otherwise that UPDATE re-fires
-- this trigger on the intentionally over-allocated source rows and is rejected.
-- ---------------------------------------------------------------------------
drop trigger if exists check_overallocation on public.project_team_member;
drop function if exists public.trg_check_overallocation();

-- ---------------------------------------------------------------------------
-- 2. Schema
-- ---------------------------------------------------------------------------
alter table public.project_team_member add column allocated_hours numeric;

-- Backfill from the old percentage: pct% of daily capacity over the weekdays in range.
update public.project_team_member ptm
   set allocated_hours = round(
         ptm.allocation_pct / 100.0
         * (u.weekly_capacity_hrs / 5.0)
         * public.fn_working_days(ptm.start_date, ptm.end_date), 2)
  from public.users u
 where u.user_id = ptm.user_id;

update public.project_team_member set allocated_hours = 0 where allocated_hours is null;

alter table public.project_team_member alter column allocated_hours set not null;
alter table public.project_team_member add constraint ptm_allocated_hours_nonneg check (allocated_hours >= 0);

alter table public.project_team_member drop constraint ptm_allocation_range;
alter table public.project_team_member drop column allocation_pct;

-- New project narrative fields.
alter table public.project add column description text;
alter table public.project add column stakeholder_description text;

-- ---------------------------------------------------------------------------
-- 3. Drop project-level percentage calc functions (no longer used).
-- Drop the view first — it depends on these functions (recreated in step 6).
-- ---------------------------------------------------------------------------
drop view if exists public.project_metrics;

drop function if exists public.fn_project_allocation_pct_week(uuid, date);
drop function if exists public.fn_project_total_allocation_pct(uuid);
drop function if exists public.fn_project_allocated_hours(uuid, date);
drop function if exists public.fn_project_capacity_hours(uuid, date);

-- ---------------------------------------------------------------------------
-- 4. Cross-project committed-hours per person for a week (Spec 03 §4.6 exception).
-- Distributes each allocation's hours over its weekdays and sums the weekday
-- overlap with the target week, across all non-archived projects. Aggregate only.
-- ---------------------------------------------------------------------------
drop function if exists public.fn_person_total_allocation_pct(uuid, date);

create or replace function public.fn_all_person_committed_hours(p_week date)
returns table (user_id uuid, committed numeric)
language sql
stable
security definer
set search_path = public
as $$
  select ptm.user_id,
         coalesce(sum(
           ptm.allocated_hours
           / nullif(public.fn_working_days(ptm.start_date, ptm.end_date), 0)
           * public.fn_working_days(greatest(ptm.start_date, p_week), least(ptm.end_date, p_week + 6))
         ), 0) as committed
  from public.project_team_member ptm
  join public.project p on p.project_id = ptm.project_id
  where p.is_archived = false
    and ptm.start_date <= p_week + 6
    and ptm.end_date   >= p_week
  group by ptm.user_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. Project planned hours = Σ allocated_hours.
-- ---------------------------------------------------------------------------
create or replace function public.fn_project_planned_hours(p_project uuid)
returns numeric language sql stable as $$
  select coalesce(sum(allocated_hours), 0)
  from public.project_team_member
  where project_id = p_project;
$$;

-- ---------------------------------------------------------------------------
-- 6. Recreate project_metrics: drop the two allocation-% columns; add
-- planned_hours + description + stakeholder_description.
-- ---------------------------------------------------------------------------
drop view if exists public.project_metrics;

create view public.project_metrics
with (security_invoker = true) as
select
  p.project_id,
  p.project_name,
  p.stakeholder,
  p.stakeholder_description,
  p.description,
  p.project_type_id,
  pt.label                                              as project_type_label,
  p.priority,
  p.status_id,
  so.label                                              as status_label,
  p.status_detail,
  p.manager_lead_id,
  ml.full_name                                          as manager_lead_name,
  p.start_date,
  p.planned_end_date,
  p.estimated_effort_hrs,
  p.is_archived,
  public.fn_project_logged_hours(p.project_id)          as logged_hours,
  public.fn_project_pct_completion(p.project_id)        as pct_completion,
  public.fn_project_pending_hours(p.project_id)         as pending_hours,
  public.fn_project_pending_pct(p.project_id)           as pending_pct,
  public.fn_project_planned_hours(p.project_id)         as planned_hours,
  public.fn_working_days(current_date, p.planned_end_date) as working_days_remaining
from public.project p
left join public.project_type_option pt on pt.option_id = p.project_type_id
left join public.status_option        so on so.option_id = p.status_id
left join public.users                ml on ml.user_id   = p.manager_lead_id;

grant select on public.project_metrics to authenticated;

grant execute on function public.fn_all_person_committed_hours(date),
                          public.fn_project_planned_hours(uuid)
  to authenticated;
