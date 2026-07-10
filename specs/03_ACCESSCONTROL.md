# Spec 03 — Access Control

**Status:** Draft v1
**Depends on:** Spec 01 — Entity & Data Model, Spec 02 — Calculation Logic
**Feeds into:** Functional Specs (all modules)

---

## 1. Scope
Defines the two v1 roles (`Admin`, `Manager-Lead`), what each can do per entity/screen, and how role/identity ties back to Google Auth login. **Enforcement mechanism is Supabase Postgres Row Level Security (RLS) policies**, not an external API layer — every rule below maps to an explicit RLS policy on the relevant table.

---

## 2. Roles

| Role | Summary |
|---|---|
| `Admin` | Full access to all data across the org. Manages users and managed lookup lists. |
| `Manager-Lead` | Operates within their own projects. Can create new projects and manage the ones they lead. Read-only elsewhere. |

There is no `Viewer` role at v1 (per discovery decision) — every logged-in user is either `Admin` or `Manager-Lead`.

**Role storage & RLS lookup:** `role` lives on the `public.users` profile table (see Spec 01 §2.1), keyed by `user_id = auth.uid()`. RLS policies check role via a helper SQL function, e.g.:

```sql
create function is_admin() returns boolean as $$
  select exists (
    select 1 from public.users
    where user_id = auth.uid() and role = 'Admin' and is_active = true
  );
$$ language sql security definer;
```

Policies then reference `is_admin()` or compare `manager_lead_id = auth.uid()` directly.

---

## 3. Login & Identity
- Login is via Google Auth (Supabase Auth's Google provider), restricted to the Amzur email domain.
- On successful Google Auth, `auth.users` is populated by Supabase; the `on_auth_user_created` trigger (Spec 01 §5.1) provisions or links the matching `public.users` profile row.
- If no matching `User` record exists, the system **auto-creates a pending `User` record** (role unset, `is_active = false`) rather than denying access outright. The person sees a "your account is awaiting activation" state until an Admin assigns them a role and activates them.
- The very first Admin account is **seeded directly into the database/config at deployment** (a one-time `UPDATE public.users SET role = 'Admin', is_active = true` after that person's first sign-in, or a seed migration) — there is no in-app setup wizard for bootstrapping the first Admin.
- Pending/inactive users are blocked from all data access by RLS itself — every table policy requires `is_active = true` in its `USING`/`WITH CHECK` clause, so even a valid JWT with no active profile row returns zero rows rather than relying on frontend gating alone.

---

## 4. Permissions Matrix & RLS Mapping

Legend: **C**reate, **R**ead, **U**pdate, **D**elete (soft-delete/deactivate/archive per Spec 01 §5)

### 4.1 `Project`
| Action | Admin | Manager-Lead |
|---|---|---|
| Create | ✅ | ✅ |
| Read — projects they lead | ✅ | ✅ |
| Read — all other projects | ✅ | ❌ (strict silo — no cross-portfolio visibility) |
| Update — projects they lead | ✅ | ✅ |
| Update — projects led by someone else | ✅ | ❌ |
| Archive/Delete | ✅ | Own projects only |
| Reassign `manager_lead_id` to someone else | ✅ | ❌ |

**RLS policies (illustrative):**
```sql
-- SELECT
create policy project_select on project for select
  using (is_admin() or manager_lead_id = auth.uid());

-- INSERT (both roles can create; Manager-Lead can only set themselves as lead)
create policy project_insert on project for insert
  with check (is_admin() or manager_lead_id = auth.uid());

-- UPDATE (own projects only, unless Admin)
create policy project_update on project for update
  using (is_admin() or manager_lead_id = auth.uid());

-- Reassigning manager_lead_id to someone else: enforced in the UPDATE policy's
-- WITH CHECK clause — a Manager-Lead's update must still leave manager_lead_id = auth.uid()
-- unless is_admin().
```

### 4.2 `ProjectTeamMember` (allocation rows)
| Action | Admin | Manager-Lead |
|---|---|---|
| Create/Update/Delete — on projects they lead | ✅ | ✅ |
| Create/Update/Delete — on projects led by others | ✅ | ❌ |
| Read | ✅ (all) | Own projects only |

**RLS:** policies join to `project.manager_lead_id` via a subquery (`project_id in (select project_id from project where manager_lead_id = auth.uid())`) or `is_admin()`. The 100%-allocation hard block (Spec 01 §2.3) is enforced by a separate trigger/constraint function, independent of RLS.

### 4.3 `HoursLogEntry`
| Action | Admin | Manager-Lead |
|---|---|---|
| Create/Update/Delete — on projects they lead | ✅ | ✅ |
| Create/Update/Delete — on projects led by others | ✅ | ❌ |
| Read | ✅ (all) | Own projects only |

**RLS:** same subquery pattern as §4.2. Additionally, `user_id` on insert must correspond to an existing `ProjectTeamMember` row for that project (enforced via a `CHECK`/trigger, not RLS, since it's a cross-row business rule rather than an ownership check).

### 4.4 `User`
| Action | Admin | Manager-Lead |
|---|---|---|
| Create/Update/Deactivate | ✅ | ❌ |
| Change a user's role | ✅ | ❌ |
| Read (directory listing, for assigning team members) | ✅ | ✅ (read-only, needed to add people to their project team) |

**RLS:**
```sql
create policy users_select on public.users for select
  using (is_admin() or is_active = true); -- Manager-Leads can read active users (for team picker)

create policy users_write on public.users for update
  using (is_admin());
```
**Note:** creating/inviting new `User` rows (Spec 06 §3.3, pre-provisioning before first login) requires the Supabase **service-role key**, which bypasses RLS — this action cannot run client-side and must go through a Next.js Server Action or API route that holds the service-role key server-side only.

### 4.5 Lookup lists — `ProjectTypeOption`, `StatusOption`, `Holiday`
| Action | Admin | Manager-Lead |
|---|---|---|
| Create/Update/Deactivate | ✅ | ❌ |
| Read (to populate dropdowns) | ✅ | ✅ |

**RLS:** `select using (true)` (any authenticated active user can read), `write using (is_admin())`.

### 4.6 Dashboard / Reports
| Action | Admin | Manager-Lead |
|---|---|---|
| View dashboard for own/led projects | ✅ | ✅ |
| View portfolio-wide dashboard (all projects) | ✅ | ❌ (strict silo) |
| Generate PDF/XLSX report — own projects | ✅ | ✅ |
| Generate PDF/XLSX report — portfolio-wide | ✅ | ❌ (strict silo) |

**Note:** dashboard/report data is derived from the same RLS-scoped queries as §4.1–§4.3 — no separate permission layer needed, since whatever a Manager-Lead's session can query is exactly what appears on their dashboard/report.

**Exception — heatmap cross-project totals (Spec 07 §2.3):** a Manager-Lead needs to see a team member's *total* allocation across projects they can't otherwise read. Since table-level RLS would block this, it's implemented as a Postgres **function** (`security definer`, bypassing RLS internally) that returns only the aggregated total per person — never row-level project detail — callable by any authenticated active user. This keeps the silo intact for project-level data while allowing the one specific aggregate exception.

---

## 5. Scoping Rule Summary
For Manager-Lead, "own projects" = projects where `Project.manager_lead_id` equals their `user_id` (`auth.uid()`). This is the single scoping key used throughout §4 — no separate per-entity ownership concept needed, since `ProjectTeamMember` and `HoursLogEntry` inherit scope from their parent `Project` via subquery-based RLS policies.

---

## 6. Being a Team Member vs. Being the Manager-Lead
Being *assigned* to a project as a team member (a row in `ProjectTeamMember`) does **not** by itself grant edit rights on that project — only being the `manager_lead_id` does. A Manager-Lead who is staffed on someone else's project (as a contributor) has **no visibility into that project at all** under the confirmed strict-silo policy — they only see projects where they are the `manager_lead_id`. This is a known limitation worth revisiting post-v1 if cross-team staffing becomes common, but it's the confirmed v1 behavior. (The one deliberate exception is the aggregated allocation-total function in §4.6.)

---

## 7. Enforcement Notes
- RLS is the primary and sufficient enforcement layer for read/write scoping — since the Next.js frontend talks to Supabase directly (no FastAPI yet), there is no separate backend to duplicate these checks in. This means RLS policies are the *single source of truth* for access control, not a defense-in-depth layer behind app code.
- Frontend UI (hiding buttons/menus a user can't use) is a UX convenience only — it must never be relied on as the actual access control, since a user could otherwise call the Supabase client directly.
- Admin-only actions that require bypassing RLS entirely (service-role key operations: inviting/pre-provisioning users) must run through Next.js Server Actions or API routes — never exposed to the browser bundle.
- Pending users (auto-created on first Google login with no prior `User` record) should be blocked from all data access — read or write — until an Admin assigns a role and activates them. This falls out naturally from the `is_active = true` condition present in every RLS policy (§3).
- When a FastAPI backend is introduced later (e.g. for JIRA sync), it should either connect using its own scoped Supabase service-role credentials (bypassing RLS deliberately, with its own internal authorization logic) or a dedicated service account role — RLS policies as defined here don't need to change to accommodate it.