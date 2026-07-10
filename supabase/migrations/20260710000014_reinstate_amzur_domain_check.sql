-- ===========================================================================
-- Reinstate the @amzur.com domain restriction after testing (reverses 0013).
--
-- IMPORTANT: run this ONLY after removing every non-@amzur.com user, otherwise
-- the CHECK constraint below will fail to validate the existing rows. To find
-- and remove them first:
--
--   select user_id, email from public.users
--    where lower(email) not like '%@amzur.com';
--   -- reassign/unlink anything they own, then:
--   delete from public.users
--    where lower(email) not like '%@amzur.com';
--   -- also delete the matching auth.users rows (via Supabase Studio > Authentication,
--   -- or: delete from auth.users where lower(email) not like '%@amzur.com';)
-- ===========================================================================

-- (b) Restore the provisioning trigger function WITH the domain check
--     (identical to migration 0002).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (1) Domain check — reject records outside the Amzur domain.
  if new.email is null or lower(new.email) not like '%@amzur.com' then
    raise exception 'Email domain not allowed for %; only @amzur.com accounts may sign in', new.email;
  end if;

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

-- (a) Re-add the profile-table domain CHECK.
alter table public.users
  add constraint users_email_amzur_domain check (lower(email) like '%@amzur.com');
