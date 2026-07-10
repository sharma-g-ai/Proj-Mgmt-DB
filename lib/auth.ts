import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Fetches the auth user + profile once per request. React cache() dedupes the
// getUser() + users lookup so multiple guards/pages in one render don't repeat
// the two Supabase round-trips.
const getSessionProfile = cache(
  async (): Promise<{ userId: string; email: string; profile: Profile | null } | null> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("users")
      .select("user_id, full_name, email, role, weekly_capacity_hrs, is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    return { userId: user.id, email: user.email ?? profile?.email ?? "", profile: (profile ?? null) as Profile | null };
  }
);

// Guard for authenticated app pages. Mirrors the routing rules from Spec 04:
// no session -> login; signed in but not active -> pending. Returns the session
// user id and the active profile (with role, used for Admin-only UI gating).
export async function requireActiveUser(): Promise<{
  userId: string;
  email: string;
  profile: Profile;
}> {
  const session = await getSessionProfile();
  if (!session) redirect("/");
  if (!session.profile?.is_active) redirect("/pending");
  return { userId: session.userId, email: session.email, profile: session.profile };
}

// Admin-only page guard (Spec 03 §4.4 / Spec 06). Non-Admins are bounced to the
// project list rather than shown a forbidden screen.
export async function requireAdmin(): Promise<{ userId: string; profile: Profile }> {
  const { userId, profile } = await requireActiveUser();
  if (profile.role !== "Admin") redirect("/projects");
  return { userId, profile };
}

