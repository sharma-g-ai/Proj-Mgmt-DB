import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignInButton } from "@/components/SignInButton";

// Login screen / landing page (Spec 04 §2). Also acts as the post-auth router:
// signed-in + active -> /dashboard, signed-in + pending -> /pending.
export default async function Home({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // A pending/inactive user's own row is hidden by RLS, so an empty result
    // means "not active yet" (Spec 04 §4 note). Active users see their row.
    const { data: profile } = await supabase
      .from("users")
      .select("is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile?.is_active) redirect("/dashboard");
    redirect("/pending");
  }

  const hasError = Boolean(searchParams?.error);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 border-t-4 border-t-brand-600 bg-white p-8 text-center shadow-sm">
        <img src="/amzur-logo.jpg" alt="Amzur" className="mx-auto h-9 w-auto" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">PM Dashboard</h1>
        <p className="mt-2 text-sm text-gray-500">
          Sign in with your Amzur account to continue.
        </p>

        {hasError && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Sign-in failed. Please use your Amzur (@amzur.com) Google account.
          </p>
        )}

        <div className="mt-6 flex justify-center">
          <SignInButton />
        </div>
      </div>
    </main>
  );
}
