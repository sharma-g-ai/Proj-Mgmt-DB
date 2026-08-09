-- Migration 0026 — add InfraOps to user_role enum (own transaction).
-- Must commit before later migrations reference the new value.
alter type public.user_role add value if not exists 'InfraOps';
