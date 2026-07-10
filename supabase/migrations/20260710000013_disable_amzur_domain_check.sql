-- ===========================================================================
-- TEMPORARY / TESTING ONLY — disable the @amzur.com domain restriction so that
-- non-Amzur Google accounts can be provisioned and promoted (e.g. to Admin) for
-- UX testing. REVERT with 20260710000014_reinstate_amzur_domain_check.sql once
-- the non-Amzur test users have been removed.
--
-- This relaxes the two DB-side layers:
--   (a) the users_email_amzur_domain CHECK constraint on public.users, and
--   (b) the domain guard inside the on-auth-insert trigger handle_new_auth_user().
--
-- NOTE: A third layer lives OUTSIDE the database — the Google OAuth consent
-- screen / Supabase Auth Google provider. If sign-in is restricted to the Amzur
-- Workspace there, a non-Amzur account cannot authenticate at all and this
-- migration has no effect on its own. Ensure the Google OAuth app allows the
-- external test account (e.g. add it as a Test User, or use an unrestricted app).
-- ===========================================================================

-- (a) Drop the profile-table domain CHECK.
alter table public.users drop constraint if exists users_email_amzur_domain;

-- (b) Re-create the provisioning trigger function WITHOUT the domain check.
--     Identical to migration 0002 except the rejection block is removed.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (1) Domain check DISABLED for testing (see 0013). Non-Amzur emails allowed.

  -- (2) If an Admin pre-created a profile row for this email, link it (preserve
  --     whatever role / is_active the Admin already set) by adopting the auth id.
  update public.users
     set user_id   = new.id,
         full_name = coalesce(nullif(full_name, ''),
                              new.raw_user_meta_data->>'full_name',
                              new.raw_user_meta_data->>'name',
                              new.email)
   where lower(email) = lower(new.email);

  -- Otherwise create a fresh pending profile (role NULL, is_active false).
  if not found then
    insert into public.users (user_id, full_name, email, role, is_active)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name',
               new.raw_user_meta_data->>'name',
               new.email),
      new.email,
      null,
      false
    );
  end if;

  return new;
end;
$$;
