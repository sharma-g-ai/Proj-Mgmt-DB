import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";

// Pending activation screen (Spec 04 §4). Shown to a signed-in user who has no
// active profile yet — whether brand-new/pending or deactivated (Spec 04 §7,
// §8.1: both share this one generic state).
export default async function Pending() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("users")
    .select("is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.is_active) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          Your account is awaiting activation
        </h1>
        <p className="mt-3 text-sm text-gray-500">
          Your account ({user.email}) has been created. An administrator needs to
          assign you a role and activate access before you can use the dashboard.
        </p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
