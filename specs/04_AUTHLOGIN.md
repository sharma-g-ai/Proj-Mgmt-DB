# Spec 04 — Functional Spec: Auth & Login

**Status:** Draft v1
**Depends on:** Spec 03 — Access Control
**Feeds into:** All other functional specs (every screen requires an authenticated session)

---

## 1. Scope
Defines the login screen, session behavior, and the pending-user activation flow, implemented via **Supabase Auth's Google OAuth provider**. This is the landing page for the application per the original requirement.

---

## 2. Login Screen (Landing Page)

- Single screen, shown to any unauthenticated visitor.
- One action: **"Sign in with Google"**, wired to `supabase.auth.signInWithOAuth({ provider: 'google' })` from the Next.js frontend.
- No username/password fields — Google OAuth is the only auth method at v1.
- Branding: Amzur-styled (logo, app name) — visual details TBD in a design pass, not this spec.

---

## 3. Auth Flow

1. User clicks "Sign in with Google."
2. Supabase Auth's Google OAuth consent flow runs; Supabase receives the user's verified email and creates/updates the corresponding `auth.users` row.
3. **Domain check**: enforced at two layers —
   - Preferentially, the Google Cloud OAuth consent screen is configured to restrict sign-in to internal Amzur Workspace users only (if Amzur's Google Workspace supports this), rejecting non-`@amzur.com` accounts before Supabase ever sees them.
   - As a backstop, the `on_auth_user_created` Postgres trigger (Spec 01 §5.1) checks the email domain on insert into `auth.users` and rejects/deletes the record if it doesn't match `@amzur.com`. If rejected, the frontend shows "Please sign in with your Amzur account" and returns to the login screen. No `public.users` profile is created for non-Amzur domains.
4. **User lookup / provisioning** (handled by the trigger, not application code):
   - **Match found, `is_active = true`, role assigned** → Supabase session is created; Next.js redirects to the dashboard, with all subsequent queries scoped per Spec 03's RLS policies (Admin → full access; Manager-Lead → their own projects).
   - **Match found, but `is_active = false` / pending** → session exists (valid Supabase JWT), but RLS blocks all data queries; the frontend shows the "awaiting activation" screen.
   - **No match found** → the trigger auto-creates a pending `public.users` record (email + name from the Google profile, `role = NULL`, `is_active = false`), then the frontend shows the same "awaiting activation" screen.
5. Session persists per Supabase Auth's default JWT/refresh-token behavior (access token short-lived, refresh token long-lived, auto-refreshed by the Supabase client SDK). No custom session duration configuration needed at v1 — Supabase's defaults are used as-is.

---

## 4. Pending Activation Screen
- Shown to any authenticated-but-not-yet-activated user (detected client-side by checking the `public.users` row for the current session, or simply by RLS returning empty results for dashboard queries).
- Message: account created, awaiting Admin to assign a role and activate.
- No navigation to any data screens is available from here.
- No self-service way to request activation faster at v1 (e.g. no "notify admin" button) — consistent with the "no notifications" decision from discovery.

---

## 5. Admin Activation Flow
- Lives inside the User CRUD module (Spec 06), not this spec — but the trigger point is: Admin sees pending users in the User list (e.g. filtered/badged as "Pending"), assigns a `role`, sets `is_active = true` via a standard RLS-permitted update (Admins can update `public.users` per Spec 03 §4.4). Next time that person's session refreshes (or on their next page load), they get full access per their role.

---

## 6. Logout
- Standard "Sign out" action (`supabase.auth.signOut()`), available from any authenticated screen (e.g. header/nav).
- Clears the Supabase session; returns to Login Screen.

---

## 7. Error States
| Scenario | Behavior |
|---|---|
| Non-Amzur domain email | Rejected at step 3, clear message, no `public.users` record created |
| Google OAuth fails/cancelled | Supabase returns an error to the client; return to login screen, no error persisted |
| Deactivated existing user (Admin deactivated them) tries to log in | Same as pending — "awaiting activation" screen (deactivation and pending share the same `is_active = false` gate) |

---

## 8. Resolved Decisions (formerly open questions)

1. **Deactivated vs. pending messaging**: confirmed to share one generic "awaiting activation" message — no distinct "access revoked" state at v1.
2. **Session duration**: no specific requirement — Supabase Auth's default session/refresh-token behavior is used as-is, with no custom configuration needed.