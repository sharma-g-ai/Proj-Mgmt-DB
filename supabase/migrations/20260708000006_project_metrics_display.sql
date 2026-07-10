-- Migration 0006 — enrich project_metrics for the Project CRUD screens (Spec 05).
--
-- Adds the display fields the list/detail screens need (stakeholder, lookup
-- labels, manager-lead name, status_detail) alongside the Spec 02 computed fields,
-- so the list can be sourced from a single RLS-scoped query. LEFT JOINs are used
-- so a project still appears even if a joined lookup/lead row is hidden from the
-- viewer by RLS. security_invoker keeps the whole view scoped to the caller.

drop view if exists public.project_metrics;

create view public.project_metrics
with (security_invoker = true) as
select
  p.project_id,
  p.project_name,
  p.stakeholder,
  p.project_type_id,
  pt.label                                                                         as project_type_label,
  p.priority,
  p.status_id,
  so.label                                                                         as status_label,
  p.status_detail,
  p.manager_lead_id,
  ml.full_name                                                                     as manager_lead_name,
  p.start_date,
  p.planned_end_date,
  p.estimated_effort_hrs,
  p.is_archived,
  public.fn_project_logged_hours(p.project_id)                                     as logged_hours,
  public.fn_project_pct_completion(p.project_id)                                   as pct_completion,
  public.fn_project_pending_hours(p.project_id)                                    as pending_hours,
  public.fn_project_pending_pct(p.project_id)                                      as pending_pct,
  public.fn_project_total_allocation_pct(p.project_id)                             as total_allocation_pct,
  public.fn_project_allocation_pct_week(
    p.project_id, date_trunc('week', current_date)::date)                          as current_week_allocation_pct,
  public.fn_working_days(current_date, p.planned_end_date)                         as working_days_remaining
from public.project p
left join public.project_type_option pt on pt.option_id = p.project_type_id
left join public.status_option        so on so.option_id = p.status_id
left join public.users                ml on ml.user_id   = p.manager_lead_id;

grant select on public.project_metrics to authenticated;
