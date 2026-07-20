-- Migration 0018 — project Google Drive reference link.
--
-- A project may reference its Google Drive folder/doc via a plain URL. Nullable,
-- no constraint. Appended to project_metrics via CREATE OR REPLACE (grant
-- preserved) — new columns must be appended at the end of the select list, not
-- inserted in the middle, or Postgres rejects the view replacement.

alter table public.project add column drive_url text;

create or replace view public.project_metrics
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
  public.fn_working_days(current_date, p.planned_end_date) as working_days_remaining,
  case
    when p.estimated_effort_hrs = 0 then null
    else public.fn_project_planned_hours(p.project_id) / p.estimated_effort_hrs * 100
  end                                                   as allocation_pct,
  p.jira_url,
  p.drive_url
from public.project p
left join public.project_type_option pt on pt.option_id = p.project_type_id
left join public.status_option        so on so.option_id = p.status_id
left join public.users                ml on ml.user_id   = p.manager_lead_id;
