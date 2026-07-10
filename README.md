# PM Dashboard

Next.js (App Router) + Supabase (Postgres, Auth, RLS) project-management dashboard
for Amzur. See [`specs/`](specs/) for the full specs and [`supabase/`](supabase/)
for the database layer (schema, calculations, RLS, seed).

## Status

| Spec | Area | State |
|---|---|---|
| 01 | Data model | ✅ migrations `0001`, `0005` |
| 02 | Calculation logic | ✅ migration `0003` |
| 03 | Access control (RLS) | ✅ migration `0004` |
| 04 | Auth & login | ✅ this app (login, callback, pending, sign-out) |
| 05 | Project CRUD | ✅ list, create/edit, detail (overview + team + hours + archive) — needs migration `0006` |
| 06 | User CRUD (Admin) | ✅ list, create (service-role), edit/activate/deactivate — needs migration `0007` + `SUPABASE_SERVICE_ROLE_KEY` |
| 07 | Dashboard & Analytics | ✅ summary cards, glance cards, allocation heatmap, timeline — needs migration `0008` |
| 08 | Reporting | ✅ PDF + XLSX via `/api/report` (RLS-scoped), scope/format/archived options |

> **Data-model note (migration 0008):** `public.users` holds both *app-login users*
> (Admin/Manager-Lead, `is_active = true`) and *resources* (`role = NULL`, tracked
> for allocation but never log in). Any active app user can read the full people
> directory so resources are visible on rosters and the heatmap; writes stay
> Admin-only and the requester-active login gate is unchanged.
>
> **Allocation model (migration 0010):** allocation is measured purely in **man-hours**.
> Each `project_team_member` row stores `allocated_hours` over a `start_date..end_date`
> range; hours are spread across **weekdays (Mon–Fri)** — start/end must be weekdays,
> and holidays are ignored for now. A resource is **over/under-allocated** by comparing
> their committed hours vs. capacity (`weekly_capacity_hrs/5` per weekday) across all
> projects for a week — surfaced on the dashboard Resource Utilization view (soft signal,
> not a hard block). Time logging lives on its own page (`/projects/[id]/hours`).

## Prerequisites

1. The database migrations and seed are applied to your Supabase project
   (see [`supabase/README.md`](supabase/README.md)).
2. Google OAuth is enabled in the Supabase dashboard (Authentication → Providers →
   Google) with a Client ID/secret from Google Cloud Console.

## Environment

Copy the example and fill in the anon key (Supabase dashboard → Project Settings →
API):

```bash
cp .env.local.example .env.local
```

`.env.local` (never committed):

```
NEXT_PUBLIC_SUPABASE_URL=https://zgrqegsucbfcqaniddfo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
```

## Supabase redirect URLs (required for login to return to the app)

In the Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** add `http://localhost:3000/**` (or at minimum
  `http://localhost:3000/auth/callback`)

Google OAuth flows through Supabase's own callback
(`…supabase.co/auth/v1/callback`, already registered in Google Cloud), then
Supabase redirects back to our `/auth/callback` route — which must be allow-listed
above or the login round-trip fails.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

## Auth flow (Spec 04)

- **`/`** — login screen (single "Sign in with Google" button). Also the
  post-auth router: signed-in + active → `/dashboard`; signed-in + pending →
  `/pending`.
- **`/auth/callback`** — exchanges the OAuth code for a session; on any provider
  error (e.g. the non-`@amzur.com` trigger backstop) redirects back to `/` with a
  message.
- **`/pending`** — "awaiting activation" screen for signed-in users with no active
  profile (covers both brand-new and deactivated users — Spec 04 §7/§8.1).
- **`/dashboard`** — minimal authenticated view listing RLS-scoped projects; the
  full dashboard is Spec 07. Includes sign-out (`POST /auth/signout`).

Route protection is in `middleware.ts` (refreshes the session, guards
`/dashboard`); the pending-vs-active branch is decided in each page's server
component. RLS remains the real access-control boundary — the UI only routes.

## First Admin

There's no setup wizard (Spec 03 §3). After your first Google sign-in creates your
pending profile, promote yourself in the Supabase SQL Editor:

```sql
update public.users set role = 'Admin', is_active = true
  where lower(email) = lower('geetashish.sharma@amzur.com');
```

Then reload `/dashboard`. (The seed already makes you an active `Manager-Lead`, so
you'd reach the dashboard either way — but Admin is needed for user management in
Spec 06.)

## Notes

- Pinned to Next.js `14.2.x` (App Router, React 18, synchronous `cookies()`), which
  keeps the `@supabase/ssr` server client simple. `npm audit` still flags some
  Next advisories only fixed in 15/16 — moving there is a major bump (React 19 +
  async `cookies()`), deferred as its own task.
- The service-role key is intentionally **not** wired in; it's only needed for user
  pre-provisioning (Spec 06) and must stay server-side.
