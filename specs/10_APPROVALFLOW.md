# Spec 10 — Functional Spec: Project Change Approval Flow

**Status:** Draft v1
**Depends on:** Spec 01 (Entity Model), Spec 03 (Access Control), Spec 05 (Project CRUD)

---

## 1. Scope

A Manager-Lead's edit to a project's **Estimated Effort Hrs** (any change, up or down) is always
staged. For **resource allocation**, the project's *first* round of allocations (adding team
members to an otherwise-unstaffed project) applies immediately — everything after that, whether
adding a new member, editing an existing allocation row, or **removing** a team member, is staged.
In both cases the change only takes effect once an Admin approves it, and the Manager-Lead must
supply a short reason at submission time, shown to the Admin alongside the change. Admin's own
edits to these same fields are never gated — an Admin is the approver, so there is no one to
approve their own change.

Once an Admin reviews a request (Approve or Reject), the requesting Manager-Lead is notified via a
dismissible banner on their Dashboard — see §4a. The Admin may also attach an optional note on
Approve, not just Reject (parity — a note is useful either way).

---

## 2. Entity — `ProjectChangeRequest`

| Field | Type | Constraints |
|---|---|---|
| `request_id` | UUID / PK | Auto-generated |
| `project_id` | FK → `Project` | Required |
| `requested_by` | FK → `User` | Required — the Manager-Lead who submitted the change |
| `kind` | Enum | `EstimatedHours` \| `Allocation` |
| `payload` | JSONB | The proposed change. `EstimatedHours`: `{ new_estimated_effort_hrs }`. `Allocation`: `{ adds: NewMember[], updates: TeamMemberEdit[], removes: assignment_id[] }` — one batch can contain new team members, edits to existing rows, and removals together (the Team & Allocation table has a single "Save Changes" action for all three), same shape the direct write uses, so approval-time application is a direct pass-through |
| `summary` | Text | Human-readable description, precomputed at submit time for the review screen. Multi-line for `Allocation` requests — one line per added/edited/removed person (name, hours old → new if changed, dates old → new if changed, or "removed") plus a trailing "Planned total: X/Yh" line; single line for `EstimatedHours` (e.g. "Estimated Effort Hrs: 160 → 200") |
| `reason` | Text | Required — the Manager-Lead's stated reason for the change, collected at submission time and shown to the Admin on the review screen |
| `status` | Enum | `Pending` \| `Approved` \| `Rejected` — default `Pending` |
| `reviewed_by` | FK → `User` | Nullable — the Admin who reviewed it |
| `reviewed_at` | Timestamp | Nullable |
| `review_note` | Text | Nullable — optional note from the Admin, on either Approve or Reject |
| `acknowledged_at` | Timestamp | Nullable — set when the requesting Manager-Lead dismisses the reviewed-request notification (§4a); `null` means still unseen |
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
   `ProjectTeamMember` row, or the batch includes any edit to or removal of an existing row, the
   whole batch (adds, edits, and removals together) stages one `Allocation` request instead of
   writing directly, regardless of whether the resulting total planned hours stays within or exceeds
   the project's `estimated_effort_hrs`. Removal in particular is *never* part of a "first pass" — it
   only ever applies to an already-existing row, so it always forces staging for a non-admin.
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
   precomputed `summary`, and the Manager-Lead's `reason` — with **Approve** and **Reject** actions,
   each revealing an optional note field before confirming (parity between the two outcomes).
3. **Approve**: applies the exact staged change (updates `Project.estimated_effort_hrs`, or
   inserts/updates/deletes the `ProjectTeamMember` row(s)) using the same write paths as a direct
   edit, records the Admin's optional note in `review_note`, then marks the request `Approved`.
4. **Reject**: marks the request `Rejected` with an optional note; no write is applied. The
   Manager-Lead's original value is untouched — they may resubmit.

---

## 4a. Reviewed-Request Notification

Since a request simply leaving `Pending` status gives the requesting Manager-Lead no feedback on its
own, every reviewed-but-unacknowledged request they submitted (`requested_by = auth.uid()`, `status
in ('Approved','Rejected')`, `acknowledged_at is null`) surfaces as a dismissible banner on their
Dashboard — outcome (Approved/Rejected), the `summary`, and the Admin's `review_note` if present.
"Dismiss" sets `acknowledged_at` via a narrow security-definer RPC
(`fn_acknowledge_change_request`) scoped to `requested_by = auth.uid()`, rather than reopening the
Admin-only `ProjectChangeRequest` UPDATE policy. This is in-app only (no email/push) and only
surfaces on next Dashboard load — same constraint as the existing pending-approval banner.

---

## 5. Permissions Recap

| Action | Admin | Manager-Lead |
|---|---|---|
| Edit Estimated Effort Hrs — applies immediately | ✅ | ❌ (staged for approval) |
| First allocation pass on an unstaffed project — applies immediately | ✅ | ✅ |
| Any allocation change after that (add, edit, or remove) — applies immediately | ✅ | ❌ (staged for approval) |
| View pending requests for own project | ✅ (all) | ✅ (own projects only) |
| Approve / Reject (with optional note either way) | ✅ | ❌ |
| Acknowledge/dismiss own reviewed request | N/A | ✅ (via `fn_acknowledge_change_request`) |

RLS mirrors the standard `is_admin() or (is_active_user() and leads_project(project_id))` shape for
select/insert on `ProjectChangeRequest`; update (review) is Admin-only.

---

## 6. Out of Scope (v1)

- No email/push notification system — reviewed-request awareness is surfaced only via the in-app
  Dashboard banner (§4a), same as the existing pending-approval banner.
- No approval history/audit page beyond the `ProjectChangeRequest` rows themselves.
- No partial approval of a batched allocation request — it is approved or rejected as a whole.
