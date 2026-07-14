-- Migration 0016 — hours log date ranges (replaces the single-entry_date model).
--
-- Product change: each HoursLogEntry row now represents logged hours over a date
-- range (start_date..end_date), mirroring how ProjectTeamMember allocations work
-- (migration 0009). hours_logged is the TOTAL for the whole range (not a per-day
-- rate) — fn_project_logged_hours is a flat sum(hours_logged), so project-level
-- calculations (logged_hours, pct_completion, pending_hours/pct) are unaffected.
--
-- Existing rows are migrated to 1-day ranges (start = end = the old entry_date),
-- which preserves their current meaning exactly.

alter table public.hours_log_entry add column start_date date;
alter table public.hours_log_entry add column end_date date;

update public.hours_log_entry
  set start_date = entry_date,
      end_date   = entry_date;

alter table public.hours_log_entry alter column start_date set not null;
alter table public.hours_log_entry alter column end_date   set not null;
alter table public.hours_log_entry add constraint hle_end_after_start check (end_date >= start_date);

alter table public.hours_log_entry drop column entry_date;

drop index if exists idx_hours_project_user;
create index idx_hours_user_range on public.hours_log_entry (user_id, start_date, end_date);
