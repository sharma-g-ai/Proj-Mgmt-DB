import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Sign out (Spec 04 §6). POST so it isn't triggered by prefetch/GET.
export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
