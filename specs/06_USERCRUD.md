# Spec 06 — Functional Spec: User CRUD

**Status:** Draft v1
**Depends on:** Spec 01 (Entity Model), Spec 03 (Access Control), Spec 04 (Auth & Login)
**Feeds into:** Project CRUD Spec (team member selection draws from this list)

---

## 1. Scope
Admin-only screens for managing the `public.users` profile table — including the activation flow for pending users created via the auto-provisioning login path (Spec 04 §3–§5). **Implementation note:** most of this module is standard RLS-protected CRUD from the Next.js frontend (Admins can read/write `public.users` per Spec 03 §4.4), except manual pre-creation of a user *before* their first login (§3.3), which requires the Supabase service-role key and must run through a Next.js Server Action or API route rather than the client-side Supabase client.

---

## 2. User List Screen (Admin only)
- Columns: Full Name, Email, Role, Weekly Capacity (Hrs), Status (Active / Pending / Deactivated).
- **Pending users are visually flagged** (e.g. badge) and typically sorted/filterable to the top, since they need action.
- Filters: Role, Status.
- Action: "+ New User" button (manual creation, not requiring the person to have logged in first).
- Manager-Leads do not see this screen at all — per Spec 03 §4.4, their access to `User` data is limited to a read-only picker when assigning team members on their own projects (not a full management screen).

---

## 3. Create / Edit User Form (Admin only)

### 3.1 Fields
- Full Name (required)
- Email (required, unique, must be Amzur domain — validated same as login domain check)
- Role: `Admin` or `Manager-Lead` (required)
- Weekly Capacity Hrs (required, > 0, default suggestion e.g. 40)
- Active toggle (`is_active`)

### 3.2 Activating a Pending User
- For a `User` row created via auto-provisioning (role unset, `is_active = false`), the Edit form is where the Admin assigns a `role` and flips `is_active = true`.
- Once activated, the person's next login (or session refresh) grants access per their assigned role.

### 3.3 Manual Creation (before first login)
- Admins can also pre-create a `User` record for someone who hasn't logged in yet (e.g. onboarding ahead of their start date) — sets up the role/capacity in advance so their first Google login lands them directly in an active account rather than the pending-activation screen.
- **Implementation:** since this creates a `public.users` row (and optionally a corresponding `auth.users` invite) ahead of any Supabase Auth session existing for that person, it cannot go through client-side RLS-protected writes alone. Two options, either viable at this scale:
  1. Insert only a `public.users` row (with a generated placeholder `user_id`, or deferred until first login) keyed by email — the `on_auth_user_created` trigger (Spec 01 §5.1) matches on email at first login and links to this pre-created row rather than creating a new pending one.
  2. Use Supabase Auth's Admin API (`inviteUserByEmail`), which creates the `auth.users` row immediately and sends an invite — requires the **service-role key**, called from a Next.js Server Action, never from the browser.
  - Recommendation: option 1 is simpler and matches the "duplicate email" resolution in §6 below without needing service-role invite emails; option 2 is worth revisiting if Amzur wants a formal invite-email flow later.

---

## 4. Deactivating a User
- "Deactivate" action on an active user — sets `is_active = false` via a standard RLS-permitted Admin update.
- Per Spec 01 §5, this is a soft action — the `User` record and their historical `ProjectTeamMember`/`HoursLogEntry` rows remain intact for reporting purposes.
- A deactivated user attempting to log in sees the "awaiting activation" screen per Spec 04 §7 (shared gate with pending) — enforced automatically since every RLS policy requires `is_active = true` (Spec 03 §3), no extra application logic needed.
- **Blocking rule**: if a user is currently `manager_lead_id` on any active (non-archived) project, deactivation is **blocked**. The Admin must first reassign those projects to a different Manager-Lead (via Project Edit, per Spec 05 §3) before deactivation is allowed. Implementable as a Postgres constraint trigger on the `public.users` update (checking for referencing `project` rows) or as an application-level check before the update is issued. The Deactivate action should surface which project(s) are blocking it.

---

## 5. Permissions Recap (from Spec 03)
| Action | Admin | Manager-Lead |
|---|---|---|
| View user list | ✅ | ❌ (no dedicated screen) |
| Create/Edit/Deactivate user | ✅ | ❌ |
| Assign/change role | ✅ | ❌ |
| Read-only user picker (for team assignment on own projects) | ✅ | ✅ |

---

## 6. Resolved Decisions (formerly open questions)

1. **Deactivating a project's Manager-Lead**: **blocked** — the system prevents deactivating a user who is currently `manager_lead_id` on one or more active (non-archived) projects. The Admin must reassign those projects to a different Manager-Lead first; the deactivation UI should surface which projects are blocking and link to reassignment.
2. **Role downgrade mid-project**: confirmed out of scope for v1 — not applicable with only two roles today.
3. **Duplicate email edge case**: confirmed — a manually pre-created `User` record (with its email) prevents the auto-provisioning pending-user path from firing when that person later logs in via Google, since email is unique. Their Google login simply matches the existing record and proceeds per whatever `role`/`is_active` state the Admin already set.