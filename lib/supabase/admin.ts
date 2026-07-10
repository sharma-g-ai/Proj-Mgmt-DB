import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client — BYPASSES RLS. Server-only (the `server-only`
// import makes the build fail if this is ever pulled into a client bundle).
// Used solely for actions that cannot go through RLS, e.g. pre-creating a
// public.users row before that person has an auth session (Spec 06 §3.3,
// Spec 03 §4.4). Every caller MUST verify the acting user is an Admin first.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  }
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
