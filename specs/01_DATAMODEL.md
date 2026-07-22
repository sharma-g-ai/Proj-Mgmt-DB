# Spec 01 — Entity & Data Model

**Status:** Draft v1
**Depends on:** None (foundational spec)
**Feeds into:** Calculation Spec, Access Control Spec, Functional Specs

---

## 1. Scope
Defines all persistent entities, their fields, relationships, and constraints for the PM Dashboard v1. Assumes small scale (~20 projects, ~15 people), manual hour entry, and the confirmed stack: **Next.js frontend + Supabase (Postgres, Auth) for the database and identity layer**, with a FastAPI backend planned as a future addition once complexity grows (e.g. JIRA sync).

---

## 1.1 Stack Implementation Notes
- All entities below are Postgres tables in the Supabase project.
- `User` is implemented as a `public.users` **profile table**, not a standalone identity store — its primary key is the same UUID as the corresponding `auth.users.id` row that Supabase Auth creates automatically on first Google sign-in. This is Supabase's standard pattern and avoids maintaining two separate identity records.
- Row-level access scoping (Admin vs. Manager-Lead, per Spec 03) is enforced via **Postgres Row Level Security (RLS) policies**, not an external API layer — RLS is Supabase's primary enforcement mechanism and applies whether the query comes from the Next.js frontend directly or (later) from FastAPI.

---

## 2. Entities

### 2.1 `User`
Managed user profile table — no external directory sync at v1. **Implemented as `public.users`, with `user_id` = the corresponding `auth.users.id` from Supabase Auth (1:1, same UUID) rather than an independently generated key.**

| Field | Type | Constraints |
|---|---|---|
| `user_id` | UUID / PK | **Same value as `auth.users.id`** — not independently generated |
| `full_name` | Text | Required |
| `email` | Text | Required, unique, must match `@amzur.com` — mirrors `auth.users.email`, enforced redundantly at the profile-table level as a defensive check |
| `role` | Enum | `Admin` \| `Manager-Lead` — Required once activated; `NULL` while pending (see §5.1) |
| `weekly_capacity_hrs` | Decimal | Required — standard hrs/week (e.g. 40). Used as denominator for Allocation % |
| `is_active` | Boolean | Default `false` (pending) until an Admin activates. Soft-deactivate instead of hard delete (preserves history on projects they're linked to) |
| `created_at` / `updated_at` | Timestamp | System-managed |

**CRUD:** Full CRUD screen for Admins (create/edit/deactivate users). Manager-Leads: read-only.

**Domain restriction:** `@amzur.com` is enforced at two layers — (1) the Google OAuth consent screen, restricted to internal Amzur Workspace users if applicable, and (2) a Postgres trigger on `auth.users` insert (see §5.1) as a backstop that rejects/deletes any auth record with a non-matching email domain.

---

### 2.2 `Project`

| Field | Type | Constraints |
|---|---|---|
| `project_id` | UUID / PK | Auto-generated |
| `project_name` | Text | Required, unique |
| `stakeholder` | Text | Required |
| `project_type_id` | FK → `ProjectTypeOption` | Required unless `is_organizational = true`, in which case left `NULL` |
| `priority` | Enum | `High` \| `Medium` \| `Low` — required unless `is_organizational = true`, in which case left `NULL` |
| `status_id` | FK → `StatusOption` | Required unless `is_organizational = true`, in which case left `NULL` |
| `manager_lead_id` | FK → `User` | Required and must reference a `User` with role `Manager-Lead` or `Admin`, unless `is_organizational = true`, in which case may be left `NULL` — enforced by `trg_check_manager_lead`, not just app-layer validation |
| `start_date` | Date | Required. See §4 Calendar Rules |
| `planned_end_date` | Date | Required. Must be ≥ `start_date`. See §4 |
| `estimated_effort_hrs` | Decimal | Required. Total estimated hours for the project — denominator for % Completion |
| `is_archived` | Boolean | Default `false`. Soft-delete via archive rather than hard delete, to preserve reporting history |
| `is_organizational` | Boolean | Default `false`. Marks a company-wide, non-billable placeholder (e.g. "Company Holidays", "All-Hands") rather than a real deliverable. Reusable — any Admin can flag any project. Excluded from portfolio-health dashboard widgets (Summary Cards, Manager/Lead project-count, At-a-Glance); still requires the normal `ProjectTeamMember` roster to log hours against, and still counts toward staffing/utilization (Spec 07 §2.3). Project Type, Priority, Status, and Manager/Lead are not meaningful for an organizational entry and are left blank in the form and `NULL` in the DB |
| `created_at` / `updated_at` | Timestamp | System-managed |

**Relationships:**
- 1 `Project` → many `ProjectTeamMember` (the team roster + allocation)
- 1 `Project` → many `HoursLogEntry` (manual completed-hours entries)

**CRUD:** Full CRUD for both Admin and Manager-Lead roles. Both roles can create new projects. Manager-Lead edit/delete access is scoped to projects where they are the `manager_lead_id`; Admins have unrestricted access to all projects. Enforced via Postgres RLS policies keyed on `manager_lead_id = auth.uid()` (see Access Control Spec for the full policy definitions).

---

### 2.3 `ProjectTeamMember` (join entity — Team + Allocation)

Represents a person's assignment and man-hours allocation to a project over a date range.

| Field | Type | Constraints |
|---|---|---|
| `assignment_id` | UUID / PK | Auto-generated |
| `project_id` | FK → `Project` | Required |
| `user_id` | FK → `User` | Required |
| `start_date` / `end_date` | Date | Required. The date range this allocation covers (`end_date >= start_date`) |
| `allocated_hours` | Decimal (≥ 0) | Required. Total man-hours allocated to this project across the range (spread evenly across the range's weekdays for weekly/monthly views) |
| `created_at` / `updated_at` | Timestamp | System-managed |

**Constraints:**
- `end_date >= start_date`.
- Over-allocation is a soft signal computed on read (not a save-time hard block): a person's summed committed hours across all active projects for a given week is compared against their weekly capacity to flag over-allocation, but saving is never blocked.

**Rollup:** Total allocation for a project = sum of `allocated_hours` across its `ProjectTeamMember` rows (formula detail belongs in the Calculation Spec).

---

### 2.4 `HoursLogEntry` (manual completed-hours entry)

Logged like an allocation — a date range plus a total, rather than one row per day.

| Field | Type | Constraints |
|---|---|---|
| `entry_id` | UUID / PK | Auto-generated |
| `project_id` | FK → `Project` | Required |
| `user_id` | FK → `User` | Required — restricted to users who are formal `ProjectTeamMember`s on that project, **except** on an organizational entry (`Project.is_organizational = true`), where any active `User` may be logged — enforced by `trg_check_hours_member`, which skips its roster check entirely for those projects |
| `start_date` / `end_date` | Date | Required. The date range the hours apply to (`end_date >= start_date`) |
| `hours_logged` | Decimal | Required, > 0 — the total for the whole `[start_date, end_date]` range (not a per-day rate) |
| `category` | Enum | `Collaboration` \| `Implementation` — Required. Defaults to `Implementation`. Fixed 2-value set (mirrors `Priority`), not an admin-managed lookup |
| `source` | Enum | `Manual` \| `JIRA` — Required. Defaults to `Manual` at v1; `JIRA` reserved for future sync (see §7) |
| `created_at` | Timestamp | System-managed |

**Note:** Kept as discrete log entries (not a single running total) so history is auditable-by-data even though we're not building a formal audit trail feature at v1.

---

### 2.5 `ProjectTypeOption` (managed lookup list)

| Field | Type | Constraints |
|---|---|---|
| `option_id` | UUID / PK | Auto-generated |
| `label` | Text | Required, unique (e.g. "Fixed Bid", "T&M", "Internal", "POC") |
| `is_active` | Boolean | Default `true` — deactivate instead of delete if in use |

**CRUD:** Admin-managed list.

---

### 2.6 `StatusOption` (managed lookup list)

| Field | Type | Constraints |
|---|---|---|
| `option_id` | UUID / PK | Auto-generated |
| `label` | Text | Required, unique (e.g. "Not Started", "In Progress", "On Hold", "At Risk", "Completed") |
| `is_active` | Boolean | Default `true` |

**CRUD:** Admin-managed list.

---

### 2.7 `Holiday` (org calendar, for working-day calculations)

| Field | Type | Constraints |
|---|---|---|
| `holiday_id` | UUID / PK | Auto-generated |
| `date` | Date | Required, unique |
| `label` | Text | Optional (e.g. "Independence Day") |

**CRUD:** Admin-managed list. Needed to support weekend/holiday exclusion in hour calculations (per your decision in §4).

---

## 3. Entity Relationship Summary

```
User ─────────────┬──< ProjectTeamMember >──── Project ──< HoursLogEntry
  (Manager-Lead)   │                              │
                    └──< HoursLogEntry             ├── ProjectTypeOption (FK)
                                                    ├── StatusOption (FK)
                                                    └── Priority (fixed enum, no table)

Holiday (standalone reference table, used in calculations only)
```

---

## 4. Calendar Rules

- `planned_end_date` ≥ `start_date` (hard validation on save).
- Working-day calculations (used by the Calculation Spec for Allocation % and Pending Hrs conversions) exclude:
  - Weekends (Saturday/Sunday — confirmed as the standard org weekend)
  - Dates present in the `Holiday` table
- Baseline vs. current end date: **not** in scope for v1 per your "no re-forecast logic" decision — only one `planned_end_date` is stored, no baseline snapshot.

---

## 5. Data Retention / Deletion Rules

- `User`: soft-deactivate (`is_active = false`), never hard-delete, to preserve referential integrity on historical `Project`/`HoursLogEntry` records.
- `Project`: soft-archive (`is_archived = true`), never hard-delete, to preserve reporting history.
- `ProjectTypeOption` / `StatusOption`: soft-deactivate if referenced by any project.
- No audit trail table at v1 (per your decision) — meaning field-level change history is *not* captured, only the current state of each record plus its own `created_at`/`updated_at`.

### 5.1 Identity Provisioning (Supabase-specific)
- On first successful Google sign-in, Supabase Auth automatically inserts a row into `auth.users`.
- A Postgres trigger (`on_auth_user_created`, firing `AFTER INSERT ON auth.users`) performs two jobs:
  1. **Domain check**: if the new row's email is not `@amzur.com`, the trigger rejects/deletes the auth record (backstop behind the Google OAuth consent screen restriction).
  2. **Profile provisioning**: if the domain check passes, insert a corresponding `public.users` row with `user_id = auth.users.id`, `email`/`full_name` copied from the Google profile, `role = NULL`, `is_active = false` — this is the "pending user awaiting Admin activation" state.
- If an Admin has already manually pre-created a `public.users` row for that email (see User CRUD spec), the trigger matches on email and links to the existing profile row instead of creating a duplicate, preserving whatever `role`/`is_active` state the Admin already set.

---

## 6. Resolved Decisions (formerly open questions)

1. **Over-allocation validation**: hard-block. Saving a `ProjectTeamMember` row that would push a person's total allocation over 100% for that week is rejected outright.
2. **Manager-Lead project creation**: both Admins and Manager-Leads can create new projects.
3. **Org week definition**: Saturday/Sunday confirmed as the standard weekend.
4. **Estimated effort changes mid-project**: editing `estimated_effort_hrs` directly shifts the % Completion denominator — no separate original-estimate field is preserved (consistent with the "no re-forecast logic" decision from discovery).

---

## 7. Deferred to Future Integration Spec
- `HoursLogEntry.source = 'JIRA'` — schema already supports it; sync logic, field mapping, and conflict resolution (e.g. what happens if both manual and JIRA entries exist for the same date) are out of scope here. This is the leading candidate for where a **FastAPI backend** gets introduced — a dedicated sync service polling/webhooking JIRA and writing into Supabase via its service-role key, decoupled from the Next.js frontend.