import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Refreshes the Supabase session on every request (keeps the access token fresh)
// and guards authenticated-only routes. The pending-vs-active decision is made in
// the page server components (they can query public.users cheaply); middleware only
// enforces "must be signed in" for /dashboard.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() revalidates the token with Supabase Auth. Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protect the app area + API: unauthenticated visitors are sent to login
  // (pages) or get 401 (API). Auth callback / signout stay public.
  const path = request.nextUrl.pathname;
  const isAuthPublic =
    path.startsWith("/auth/callback") || path.startsWith("/auth/signout");
  const isProtectedPage =
    path.startsWith("/dashboard") ||
    path.startsWith("/projects") ||
    path.startsWith("/users") ||
    path.startsWith("/reports") ||
    path.startsWith("/approvals");
  const isProtectedApi = path.startsWith("/api/") && !isAuthPublic;

  if (!user && isProtectedPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  if (!user && isProtectedApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return supabaseResponse;
}
