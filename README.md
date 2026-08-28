# PM Dashboard

A project-management dashboard for Amzur: project/team/hours tracking with role-based
approval flows, plus an **InfraOps** module for per-project cloud/SaaS inventory and
billing-invoice reconciliation.

**Stack:** Next.js 14 (App Router) + Supabase (Postgres, Auth, Storage). No separate
backend — **Postgres Row-Level Security (RLS) is the entire access-control layer**; the
frontend talks to Supabase directly. A FastAPI service is planned later only for JIRA
sync, not part of v1.

Full functional specs live in [`specs/`](specs/), in dependency order: 01 (data model) →
02 (calculations) → 03 (access control/RLS) → 04–08, 10 (core PM features, any order) →
11 (InfraOps). **Read the relevant spec before changing a feature** — 01 and 03 define
the schema and RLS policies exactly; don't improvise field names or policy logic.

---

## 1. Who uses this and what they can do

Three roles, stored on `public.users.role`:

| Role | Home base | Can do |
|---|---|---|
| **Admin** | Whole app | Everything, org-wide: all projects, user management, lookup lists, approve/reject staged changes, InfraSpecs/billing for any project |
| **Manager-Lead** | Their own projects | Create projects; full CRUD on projects where they're `manager_lead_id`; **no visibility into other Manager-Leads' projects at all** (strict silo — being staffed as a team member on someone else's project grants no access to it); some edits are staged for Admin approval instead of applying immediately (§4) |
| **InfraOps** | `/projects/{id}/infra` | Full read/write on InfraSpecs inventory + billing invoices for **any** project, org-wide (bypasses the PM silo for infra data only); no PM-side project edit rights |

There's no self-service signup. Login is Google OAuth restricted to `@amzur.com`; a new
sign-in creates a **pending** profile (`role = NULL`, `is_active = false`) that shows an
"awaiting activation" screen until an Admin assigns a role (Spec 04, Spec 06). The very
first Admin is bootstrapped with a one-off SQL update (§7 below).

RLS enforces all of this at the database layer — the UI hides buttons a role can't use,
but that's convenience only, not the actual boundary.

---

## 2. Core PM concepts

- **Project** — the unit of work. Has a type, priority, status, a `manager_lead_id`
  owner, a date range, and `estimated_effort_hrs` (the denominator for % Completion).
  Soft-deleted via `is_archived`, never hard-deleted.
- **Organizational entry** (`is_organizational = true`) — a non-billable placeholder
  project (e.g. "Company Holidays", "All-Hands") rather than real deliverable work. Has
  no Project Type/Priority/Status/Manager-Lead (left blank), is excluded from portfolio
  dashboard metrics, hides the JIRA/Drive link fields, and — unlike normal projects —
  **any active user can log hours against it**, not just its team roster (there is no
  roster concept for these). Editing/deleting an *existing* hours entry there is
  Admin-only even for whoever logged it, since there's no "logged by" ownership to key
  off of.
- **Team & Allocation** (`project_team_member`) — who's staffed on a project, how many
  man-hours, over what date range. Allocation is measured in raw hours, not %, spread
  across weekdays. A person's total committed hours across *all* their projects for a
  given week is checked against their `weekly_capacity_hrs`; **exceeding 100% is a hard
  block on save**, not just a warning.
- **Hours Log** (`hours_log_entry`) — manually logged completed hours (a date range +
  total, not one row per day), each categorized `Collaboration`/`Implementation`. Drives
  % Completion (`logged_hours / estimated_effort_hrs`, not capped at 100% — overruns
  show an "OVER" badge). `source` is `Manual` today; `JIRA` is reserved schema for a
  future sync, unimplemented.
- **Calculated, never stored**: Allocation %, % Completion, Pending Hrs/% are all
  computed live on read (Spec 02) — no caching, no snapshotting, no baseline/re-forecast
  tracking.

---

## 3. PM user flows

### Dashboard (`/dashboard`) — landing page after login
Lightweight portfolio overview, scoped by role (org-wide for Admin, own-projects-only
for Manager-Lead): summary cards (status/priority counts, avg % completion, OVER count),
an at-a-glance project list (Manager-Lead) or a Manager→project-count table (Admin), and
a Resource Utilization table flagging over/under-capacity people — the one deliberate
exception to the silo: a Manager-Lead can see that someone is over capacity org-wide
without seeing which other project is causing it. Also surfaces two notification
banners: pending approvals awaiting an Admin, and reviewed-request outcomes for a
Manager-Lead's own past submissions (§4).

### Project List (`/projects`) → Project Detail (`/projects/[id]`)
Full sortable/filterable project table, then a detail page with Overview, Team &
Allocation, Hours Log, and Archive sections/tabs. Team & Allocation edits (add/edit/
remove) batch into a single "Save Changes (N)" action rather than saving row-by-row.

### Approval flow (`/approvals`, Admin-only) — Spec 10
Manager-Leads can edit freely, but two kinds of changes are **staged** instead of
applying immediately, and require a stated reason:
- Any change to a project's **Estimated Effort Hrs** (every other field on the Edit form
  still saves right away).
- Any **resource allocation** change *after* the project's initial staffing pass — i.e.
  the very first round of adding team members to an unstaffed project applies
  immediately, but every add/edit/**removal** after that is staged.

Admin's own edits to these same fields are never gated. `/approvals` lists every
`Pending` request with its precomputed human-readable summary and the requester's
reason; Approve/Reject both accept an optional note. Once reviewed, the requesting
Manager-Lead sees a dismissible outcome banner on their Dashboard.

### User management (`/users`, Admin-only) — Spec 06
Admin-only CRUD on `public.users`: activate pending users (assign role + flip
`is_active`), deactivate (blocked if the user is still `manager_lead_id` on any active
project — reassign first), pre-create a user ahead of their first login. Manager-Leads
only get a read-only picker (for staffing their own projects), no management screen.

### Reports (`/reports`) — Spec 08
On-demand PDF/XLSX export of the same RLS-scoped, live-calculated data as the dashboard
(no report history, no point-in-time snapshots). Sheets/sections: Portfolio Summary,
Team Allocation, Hours Log, an Allocation timeline tab (project rows × week columns,
color-coded per project), and — if the viewer can see infra data — an **InfraBilling**
matrix (§5).

---

## 4. Data model & access control at a glance

- `public.users` — profile table, 1:1 with `auth.users` via matching UUID. Role lives
  here (`Admin` / `Manager-Lead` / `InfraOps`).
- `project`, `project_team_member`, `hours_log_entry` — the core PM tables (§2).
- `project_change_request` — the approval-flow staging table (Spec 10): `kind`
  (`EstimatedHours`/`Allocation`), JSONB `payload`, `status`, `reason`, `review_note`,
  `acknowledged_at`.
- `project_type_option`, `status_option` — Admin-managed lookup lists.
- Every table's access is a Postgres RLS policy — see `supabase/migrations/`
  (chronological, filename-numbered) for the literal policy definitions and
  `specs/03_ACCESSCONTROL.md` for the reasoning. Helper functions like `is_admin()`,
  `leads_project(project_id)`, `is_infraops()` back most policies instead of repeating
  role logic inline.

---

## 5. InfraOps: cloud/SaaS inventory & billing — Spec 11

A per-project module, separate from the PM approval flow above, for tracking authorized
cloud/SaaS resources and reconciling billing invoices against them. Not multi-account
AWS Cost Explorer — invoices are uploaded as files and matched by **service/resource
type**, not linked-account ID.

**Access:** Admin and InfraOps have full read/write on any project's infra data (view,
edit, upload, extract, resolve discrepancies); Manager-Lead gets **view-only** access,
scoped to projects they lead.

**Entry point:** `/projects/{id}/infra` (Resources + Billing invoices), invoice detail at
`/projects/{id}/infra/invoices/{invoiceId}`.

### Workflow
1. **Billing setup gate** — first visit requires picking a billing tool
   (`project.provider_id`, one per project) and optionally turning on an account
   allow-list (`project.enforce_billing_accounts` + `project_billing_account` rows); if
   restricted, uploaded invoices whose account isn't allow-listed are rejected outright.
2. **Maintain Resources** (`infra_resource`) — the authorized inventory (name, resource
   type, optional external/cloud ID, typed JSONB attributes). Do this *before* uploading
   invoices: an empty inventory means every non-zero invoice line is flagged out-of-scope
   by default.
3. **Upload an invoice** (PDF/image/text) — stored in the private `infra-invoices`
   bucket, `infra_invoice` row created with `processing_status` pending → processing →
   parsed/failed.
4. **Extract** — an LLM call (via LiteLLM, see `lib/infra/llm.ts`) pulls structured
   header + line-item data out of the file; on failure, retry or paste raw text to parse
   instead.
5. **Review & fix** on the invoice detail page — file preview alongside extracted data,
   one edit form for header + all line items, single Save.
6. **Discrepancy detection** (`lib/infra/discrepancies`, deterministic — no invented
   data) — flags out-of-scope charges (service/type not in inventory, via known AWS-style
   service aliases), duplicate invoice numbers/periods, amount mismatches. Adding missing
   resource types or fixing bad extracted lines and re-checking clears flags.
7. **Reporting** — month/tool totals roll into the Reports workbook's **InfraBilling**
   sheet (USD, converted via reporting FX rates), pivoted by tool/stakeholder/project/
   month.

### Key tables (migrations `026`–`031`)
`infra_provider`, `infra_resource_type`, `billing_ownership_option` (lookups) ·
`infra_resource` (inventory) · `infra_invoice` / `infra_invoice_line` (uploaded bills) ·
`infra_billing_discrepancy` (flags) · `project_billing_account` (per-project account
allow-list) · plus `project.provider_id`, `project.enforce_billing_accounts`. RLS helpers:
`is_infraops()`, `can_manage_infra()`, `can_view_infra(project_id)`.

---

## 6. Repo map

```
app/                    Next.js App Router pages (routes ≈ user flows above)
  dashboard/  projects/  approvals/  users/  reports/  auth/
  projects/[id]/infra/   InfraOps pages
components/             UI, incl. components/infra/ and components/report/
lib/
  infra/                Discrepancy detection, LiteLLM extraction client (llm.ts)
  report/               PDF (pdfkit) + XLSX (ExcelJS) builders
  supabase/             Server/browser Supabase client helpers
supabase/
  migrations/           Source of truth for schema + RLS, chronological, never edit past ones
  seed.sql              Production-derived seed
  seed_dummy.sql         Synthetic test data for a fresh clone DB (run after migrations)
specs/                  Functional specs — read before changing behavior they cover
```

---

## 7. Local setup

**Prerequisites**
1. Migrations + seed applied to your Supabase project (`supabase/README.md`).
2. Google OAuth provider enabled in Supabase (Authentication → Providers → Google),
   restricted to `@amzur.com`.
3. For InfraOps invoice extraction: a LiteLLM gateway endpoint + API key (ask an
   existing InfraOps team member for the current key — see `.env.local.example`).

**Environment**
```bash
cp .env.local.example .env.local
```
Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase dashboard →
Project Settings → API), and — only if you're working on User CRUD pre-provisioning or
InfraOps extraction — `SUPABASE_SERVICE_ROLE_KEY` / `LITELLM_*`. Never commit
`.env.local`; the service-role key and LiteLLM key must stay server-side only (see Spec
03 §7 — service-role operations run through Server Actions, never the browser bundle).

**Supabase redirect URLs** (Authentication → URL Configuration): Site URL
`http://localhost:3000`, Redirect URLs including `http://localhost:3000/**` (or at least
`/auth/callback`) — the OAuth round-trip fails without this.

**Run**
```bash
npm install
npm run dev        # http://localhost:3000
```

**First Admin** — no setup wizard; after your first Google sign-in creates a pending
profile, promote yourself via the Supabase SQL Editor:
```sql
update public.users set role = 'Admin', is_active = true
  where lower(email) = lower('you@amzur.com');
```

---

## 8. Notes for maintainers

- Pinned to Next.js `14.2.x` (synchronous `cookies()`, simpler `@supabase/ssr` server
  client). Moving to 15/16 is a deliberate future task (React 19 + async `cookies()`),
  not done opportunistically.
- No audit-trail table anywhere — only current state + `created_at`/`updated_at`. Field-
  level history isn't tracked by design (v1 decision), so don't assume it exists when
  debugging a "what changed" question.
- Migrations are strictly append-only and applied in filename order — never edit a past
  migration; add a new one. One gotcha specific to this repo: `ALTER TYPE ... ADD VALUE`
  (migration `026`, adding the `InfraOps` role) must commit in its own transaction before
  any migration that *uses* the new enum value (`027`) — don't batch them together when
  applying manually.
