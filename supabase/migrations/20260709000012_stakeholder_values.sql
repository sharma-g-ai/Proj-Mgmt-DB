-- Migration 0012 — constrain project.stakeholder to Internal | External.
--
-- The stakeholder is now a fixed two-value field (the free-text detail lives in
-- stakeholder_description). Enforce the allowed values at the DB level so the rule
-- holds regardless of entry path, matching the UI dropdown.
-- (Existing seed data already uses only 'Internal' / 'External'.)

alter table public.project
  add constraint project_stakeholder_values
  check (stakeholder in ('Internal', 'External'));
