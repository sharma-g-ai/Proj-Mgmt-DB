-- Migration 0019 — hours log category (Collaboration vs Implementation).
--
-- A fixed 2-value classification of logged work, mirroring the plain-enum
-- pattern used for project_priority rather than a new admin-managed lookup
-- table (this is a small, closed set, not an open-ended admin-editable list).

create type public.hours_category as enum ('Collaboration', 'Implementation');

alter table public.hours_log_entry
  add column category public.hours_category not null default 'Implementation';
