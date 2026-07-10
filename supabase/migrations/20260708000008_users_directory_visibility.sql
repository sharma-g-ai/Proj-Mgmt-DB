-- Migration 0008 — make the people directory fully visible to app users.
--
-- Reframes public.users: app-login users are Admin/Manager-Lead rows with
-- is_active = true; everyone else is a tracked *resource* (role NULL) that never
-- logs in but must be visible to Admins and Manager-Leads for allocation, team
-- rosters, and the Spec 07 allocation heatmap.
--
-- The original users_select policy (Spec 03 §4.4) exposed only *active* users,
-- which hid resources (and pending users) from Manager-Leads — so a lead saw
-- "Unknown" instead of a resource's name on their own project's roster.
--
-- Any active app user may now read the full directory. Writes stay Admin-only
-- (users_update, unchanged). The requester-active login gate is preserved via
-- is_active_user(), so pending/deactivated sessions still read nothing.

drop policy if exists users_select on public.users;

create policy users_select on public.users
  for select
  using (public.is_active_user());
