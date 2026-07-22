-- Migration 0022 — requester-side reason on project_change_request.
--
-- The Manager-Lead now states a reason when a change is staged for approval
-- (surfaced to the Admin on /approvals alongside the precomputed summary).
-- Existing rows (none in practice, table is new) backfill to '' via the default.

alter table public.project_change_request
  add column reason text not null default '';
