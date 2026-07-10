-- Migration 0005 — add Project.status_detail
--
-- Extends Spec 01 §2.2 per a seed-data decision: the source project tracker keeps
-- a free-text status note (e.g. "In Internal Testing, working on Feedback") that
-- doesn't fit the clean StatusOption lookup. status_id holds the categorical
-- status; status_detail preserves the descriptive note alongside it.

alter table public.project add column status_detail text;

comment on column public.project.status_detail is
  'Free-text status note (imported from the source tracker). Complements the '
  'categorical status_id. Added per the seed-data "keep notes" decision.';
