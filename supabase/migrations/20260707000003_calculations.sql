-- Migration 0003 — Calculation Logic (implements Spec 02)
--
-- All values are computed on read, never stored (Spec 02 §1).
-- These functions run SECURITY INVOKER (the default) so they honor the caller's
-- RLS scope — a Manager-Lead only aggregates over projects they can read.
-- The ONE deliberate cross-project exception (heatmap person total) is defined
-- as a security-definer function in the RLS migration (0004), per Spec 03 §4.6.
--
-- Rounding (Spec 02 §6): functions return FULL precision. Round to 1 decimal
-- only at the final display step in the frontend.

-- ---------------------------------------------------------------------------
-- Spec 01 §4 / Spec 02 §5 — Working days between two dates (inclusive),
-- excluding weekends (Sat/Sun) and Holiday-table dates. Informational only;
-- NOT an input to the three ratio formulas. Returns 0 when p_end < p_start.
-- ---------------------------------------------------------------------------
create or replace function public.fn_working_days(p_start date, p_end date)
returns integer
language sql
stable
as $$
  select coalesce(count(*), 0)::int
  from generate_series(p_start, p_end, interval '1 day') as g(d)
  where extract(dow from g.d) not in (0, 6)          -- 0 = Sunday, 6 = Saturday
    and g.d::date not in (select date from public.holiday);
$$;

-- ---------------------------------------------------------------------------
-- Spec 02 §2 — Allocation %
-- ---------------------------------------------------------------------------

-- §2.2 numerator: Σ (allocation_pct/100 × weekly_capacity_hrs) for a week.
create or replace function public.fn_project_allocated_hours(p_project uuid, p_week date)
returns numeric
language sql
stable
as $$
  select coalesce(sum(ptm.allocation_pct / 100.0 * u.weekly_capacity_hrs), 0)
  from public.project_team_member ptm
  join public.users u on u.user_id = ptm.user_id
  where ptm.project_id = p_project
    and ptm.week_start_date = p_week;
$$;

-- §2.2 denominator: Σ weekly_capacity_hrs of members assigned that week.
create or replace function public.fn_project_capacity_hours(p_project uuid, p_week date)
returns numeric
language sql
stable
as $$
  select coalesce(sum(u.weekly_capacity_hrs), 0)
  from public.project_team_member ptm
  join public.users u on u.user_id = ptm.user_id
  where ptm.project_id = p_project
    and ptm.week_start_date = p_week;
$$;

-- §2.2 project-level Allocation % for a given week.
-- Undefined (NULL -> display "—") when no members assigned that week (§7).
create or replace function public.fn_project_allocation_pct_week(p_project uuid, p_week date)
returns numeric
language sql
stable
as $$
  select case
    when public.fn_project_capacity_hours(p_project, p_week) = 0 then null
    else public.fn_project_allocated_hours(p_project, p_week)
         / public.fn_project_capacity_hours(p_project, p_week) * 100
  end;
$$;

-- §2.3 rolled-up total Allocation % — hours-weighted average across all weeks
-- with data (Σ allocated_hours ÷ Σ capacity_hours × 100), NOT a simple average
-- of weekly percentages. Weeks with no members contribute 0 to both sums and are
-- naturally excluded. NULL when the project has no allocation rows at all.
create or replace function public.fn_project_total_allocation_pct(p_project uuid)
returns numeric
language sql
stable
as $$
  select case
    when coalesce(sum(u.weekly_capacity_hrs), 0) = 0 then null
    else sum(ptm.allocation_pct / 100.0 * u.weekly_capacity_hrs)
         / sum(u.weekly_capacity_hrs) * 100
  end
  from public.project_team_member ptm
  join public.users u on u.user_id = ptm.user_id
  where ptm.project_id = p_project;
$$;

-- ---------------------------------------------------------------------------
-- Spec 02 §3 — % of Completion (Hrs). NOT capped at 100% (overruns visible).
-- Zero-estimate edge case (§3): returns NULL -> display "—".
-- ---------------------------------------------------------------------------
create or replace function public.fn_project_logged_hours(p_project uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(hours_logged), 0)
  from public.hours_log_entry
  where project_id = p_project;
$$;

create or replace function public.fn_project_pct_completion(p_project uuid)
returns numeric
language sql
stable
as $$
  select case
    when p.estimated_effort_hrs = 0 then null
    else public.fn_project_logged_hours(p_project) / p.estimated_effort_hrs * 100
  end
  from public.project p
  where p.project_id = p_project;
$$;

-- ---------------------------------------------------------------------------
-- Spec 02 §4 — % of Pending Hrs. Both go negative on overrun (not clamped),
-- keeping pending_pct = 100 − pct_completion exactly consistent.
-- pending_pct is NULL when pct_completion is NULL (zero-estimate case).
-- ---------------------------------------------------------------------------
create or replace function public.fn_project_pending_hours(p_project uuid)
returns numeric
language sql
stable
as $$
  select p.estimated_effort_hrs - public.fn_project_logged_hours(p_project)
  from public.project p
  where p.project_id = p_project;
$$;

create or replace function public.fn_project_pending_pct(p_project uuid)
returns numeric
language sql
stable
as $$
  select case
    when public.fn_project_pct_completion(p_project) is null then null
    else 100 - public.fn_project_pct_completion(p_project)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Convenience view rolling every computed field up per project. Uses
-- security_invoker so RLS (Spec 03) still scopes which projects appear.
-- "current week" = calendar week containing today (Spec 02 §8.1); week_start_date
-- rows are Monday-based, matching date_trunc('week', ...) (ISO, Monday).
-- ---------------------------------------------------------------------------
create or replace view public.project_metrics
with (security_invoker = true) as
select
  p.project_id,
  p.project_name,
  p.manager_lead_id,
  p.status_id,
  p.priority,
  p.is_archived,
  p.start_date,
  p.planned_end_date,
  p.estimated_effort_hrs,
  public.fn_project_logged_hours(p.project_id)                                    as logged_hours,
  public.fn_project_pct_completion(p.project_id)                                  as pct_completion,
  public.fn_project_pending_hours(p.project_id)                                   as pending_hours,
  public.fn_project_pending_pct(p.project_id)                                     as pending_pct,
  public.fn_project_total_allocation_pct(p.project_id)                            as total_allocation_pct,
  public.fn_project_allocation_pct_week(
    p.project_id, date_trunc('week', current_date)::date)                         as current_week_allocation_pct,
  public.fn_working_days(current_date, p.planned_end_date)                        as working_days_remaining
from public.project p;
