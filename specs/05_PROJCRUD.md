# Spec 05 — Functional Spec: Project CRUD

**Status:** Draft v1
**Depends on:** Spec 01 (Entity Model), Spec 02 (Calculation Logic), Spec 03 (Access Control)
**Feeds into:** Dashboard/Analytics Spec, Reporting Spec

---

## 1. Scope
Screens and behavior for creating, viewing, editing, and archiving `Project` records, plus managing their `ProjectTeamMember` (allocation) and `HoursLogEntry` (manual hours) sub-data.

---

## 2. Project List Screen
- Default view: active projects only (`is_archived = false`), scoped per Spec 03 (Admin sees all; Manager-Lead sees only projects where they are `manager_lead_id`).
- Columns: Project Name, Stakeholder, Project Type, Priority, Status, Manager/Lead, current-week Allocation %, % Completion (with "OVER" badge if >100%), Planned End Date.
- Filters: Status, Priority, Project Type, Manager/Lead (Admin only, since Manager-Lead is already silo'd to themselves).
- Sort: any column; default sort by Planned End Date ascending.
- Toggle: "Show archived" (reveals `is_archived = true` projects, read-only).
- Action: "+ New Project" button → opens Create form.

---

## 3. Create / Edit Project Form

### 3.1 Fields
All core fields from Spec 01 §2.2: Project Name, Stakeholder, Project Type (dropdown from `ProjectTypeOption`), Priority (fixed High/Medium/Low), Status (dropdown from `StatusOption`), Manager/Lead (dropdown from active `User`s), Start Date, Planned End Date, Estimated Effort Hrs.

### 3.2 Validation
- Project Name: required, unique (real-time check on blur).
- Planned End Date ≥ Start Date (per Spec 01 §4) — inline validation error if violated.
- Estimated Effort Hrs: required, > 0.
- Manager/Lead: required; if the creator is a Manager-Lead (not Admin), this field defaults to themselves and — per Spec 03 §4.1 — **cannot** be reassigned to someone else on create (only Admins can set a different manager/lead).

### 3.3 On Save
- Create: new `Project` row, creator becomes editor of record (Manager-Lead) or as specified (Admin).
- Edit: standard update; if `estimated_effort_hrs` changes, dashboard/report values recalculate immediately per Spec 02 §3 (direct denominator shift, no historical preservation).

---

## 4. Project Detail Screen
Tabs or sections:

### 4.1 Overview
- All core fields (editable inline or via "Edit" button, per permissions).
- Calculated fields displayed: current-week Allocation %, rolled-up total Allocation %, % Completion (with OVER badge if applicable), Pending Hrs (and %) — all per Spec 02 formulas.
- Contextual info: working days remaining until Planned End Date (calendar-adjusted per Spec 01 §4 / Spec 02 §5).

### 4.2 Team & Allocation
- Table of `ProjectTeamMember` rows: Person, Week, Allocation %, Allocated Hours (calculated).
- "+ Add Team Member" — select `User` (active users only), set weekly `allocation_pct`.
- Edit/remove existing allocation rows.
- **Hard-block enforcement**: on save, if a person's total allocation across all their projects for that week would exceed 100%, save is rejected with an inline error showing the conflicting total (per Spec 01 §2.3, Spec 03 §4.2).

### 4.3 Hours Log
- Table of `HoursLogEntry` rows: Person, Start Date, End Date, Hours Logged (total for the range), Source (Manual/JIRA — JIRA rows read-only once sync exists, not applicable at v1).
- "+ Log Hours" — person picker is **restricted to that project's `ProjectTeamMember`s only** (not any active user org-wide), Start Date, End Date, Hours. Same weekday-only + end-date-on-or-after-start-date rule as Team & Allocation (Spec 01 §2.3).
- Edit/delete existing manual entries — fully open-ended, no age-based locking (no restriction beyond project-edit permission, no separate approval workflow at v1).

### 4.4 Archive
- "Archive Project" action (soft-delete per Spec 01 §5) — available to Admin (any project) and Manager-Lead (own projects only).
- Confirmation dialog required before archiving.
- Archived projects become read-only everywhere except an Admin-only "Unarchive" action.

---

## 5. Permissions Recap (from Spec 03, applied here)
| Action | Admin | Manager-Lead |
|---|---|---|
| See project in list/detail | All | Own only |
| Create | ✅ | ✅ (self as manager/lead only) |
| Edit core fields | Own or any | Own only |
| Manage Team & Allocation | Own or any | Own only |
| Manage Hours Log | Own or any | Own only |
| Archive/Unarchive | Any | Archive own only (no unarchive) |

---

## 6. Resolved Decisions (formerly open questions)

1. **Hours Log entry restriction**: hours can only be logged for people who are formal `ProjectTeamMember`s on that project — not any active user, and not a one-off contributor. This should be enforced as a validation on the "+ Log Hours" action (person picker limited to that project's team members, per §4.3).
2. **Editing past hours entries**: no restriction — `HoursLogEntry` rows remain fully editable/deletable regardless of age, consistent with the "no audit trail" decision from discovery.
3. **Unarchive**: confirmed Admin-only with no in-app path for Manager-Leads — they contact an Admin directly outside the system.