# Spec 10 — Functional Spec: Project Change Approval Flow

**Status:** Draft v1
**Depends on:** Spec 01 (Entity Model), Spec 03 (Access Control), Spec 05 (Project CRUD)

---

## 1. Scope

A Manager-Lead's edit to a project's **Estimated Effort Hrs** (any change, up or down) is always
staged. For **resource allocation**, the project's *first* round of allocations (adding team
members to an otherwise-unstaffed project) applies immediately — everything after that, whether
adding a new member or editing an existing allocation row, is staged. In both cases the change only
takes effect once an Admin approves it, and the Manager-Lead must supply a short reason at
submission time, shown to the Admin alongside the change. Admin's own edits to these same fields
are never gated — an Admin is the approver, so there is no one to approve their own change.

---

## 2. Entity — `ProjectChangeRequest`

| Field | Type | Constraints |
|---|---|---|
| `request_id` | UUID / PK | Auto-generated |
| `project_id` | FK → `Project` | Required |
| `requested_by` | FK → `User` | Required — the Manager-Lead who submitted the change |
| `kind` | Enum | `EstimatedHours` \| `Allocation` |
| `payload` | JSONB | The proposed change. `EstimatedHours`: `{ new_estimated_effort_hrs }`. `Allocation`: `{ adds: NewMember[], updates: TeamMemberEdit[] }` — one batch can contain both new team members and edits to existing rows (the Team & Allocation table has a single "Save Changes" action for both), same shape the direct write uses, so approval-time application is a direct pass-through |
| `summary` | Text | Human-readable description, precomputed at submit time for the review screen. Multi-line for `Allocation` requests — one line per added/edited person (name, hours old → new if changed, dates old → new if changed) plus a trailing "Planned total: X/Yh" line; single line for `EstimatedHours` (e.g. "Estimated Effort Hrs: 160 → 200") |
| `reason` | Text | Required — the Manager-Lead's stated reason for the change, collected at submission time and shown to the Admin on the review screen |
| `status` | Enum | `Pending` \| `Approved` \| `Rejected` — default `Pending` |
| `reviewed_by` | FK → `User` | Nullable — the Admin who reviewed it |
| `reviewed_at` | Timestamp | Nullable |
| `review_note` | Text | Nullable — optional reason on rejection |
| `created_at` | Timestamp | System-managed |

**Constraint:** at most one `Pending` request per `project_id` at a time (partial unique index) —
keeps review simple (no stacked/conflicting proposals) and blocks a Manager-Lead from resubmitting
while one is still unreviewed; they see a clear message instead of a raw DB error.

---

## 3. Trigger Conditions

1. **Estimated Effort Hrs**: a Manager-Lead submitting the Edit Project form with a different
   `estimated_effort_hrs` value than the project's current one stages an `EstimatedHours` request.
   Every *other* field on the form still saves immediately — only the estimate itself is held back.
2. **Resource allocation — first save is free**: the Team & Allocation table has one batched "Save
   Changes (N)" action covering both newly added rows and edits to existing rows. If a Manager-Lead's
   batch only *adds* members and the project currently has *zero* `ProjectTeamMember` rows, it applies
   immediately — this is the project's initial staffing pass, done once right after creation.
3. **Resource allocation — everything after is staged**: once a project has at least one saved
   `ProjectTeamMember` row, or the batch includes any edit to an existing row, the whole batch (adds
   and edits together) stages one `Allocation` request instead of writing directly, regardless of
   whether the resulting total planned hours stays within or exceeds the project's
   `estimated_effort_hrs`.
4. In both cases (2 and 3 above with staging, and 1), the Manager-Lead must type a `reason` before
   the request can be submitted — the UI blocks submission with a prompt until one is given.
5. Admin edits to either field always write directly — never staged, regardless of the project's
   current staffing state.

---

## 4. Review Flow

1. Admin sees a "N changes awaiting your approval" banner on the Dashboard (linking to `/approvals`)
   and, per-project, a banner on the Project Detail page naming any Pending request for that project
   (visible to both the Admin and the requesting Manager-Lead).
2. `/approvals` (Admin-only) lists every Pending request — project name, requester, kind, the
   precomputed `summary`, and the Manager-Lead's `reason` — with **Approve** and **Reject** actions.
3. **Approve**: applies the exact staged change (updates `Project.estimated_effort_hrs`, or
   inserts/updates the `ProjectTeamMember` row(s)) using the same write paths as a direct edit, then
   marks the request `Approved`.
4. **Reject**: marks the request `Rejected` with an optional note; no write is applied. The
   Manager-Lead's original value is untouched — they may resubmit.

---

## 5. Permissions Recap

| Action | Admin | Manager-Lead |
|---|---|---|
| Edit Estimated Effort Hrs — applies immediately | ✅ | ❌ (staged for approval) |
| First allocation pass on an unstaffed project — applies immediately | ✅ | ✅ |
| Any allocation change after that (add or edit) — applies immediately | ✅ | ❌ (staged for approval) |
| View pending requests for own project | ✅ (all) | ✅ (own projects only) |
| Approve / Reject | ✅ | ❌ |

RLS mirrors the standard `is_admin() or (is_active_user() and leads_project(project_id))` shape for
select/insert on `ProjectChangeRequest`; update (review) is Admin-only.

---

## 6. Out of Scope (v1)

- No notification/email system — approval awareness is surfaced only via in-app banners.
- No approval history/audit page beyond the `ProjectChangeRequest` rows themselves.
- No partial approval of a batched allocation request — it is approved or rejected as a whole.
