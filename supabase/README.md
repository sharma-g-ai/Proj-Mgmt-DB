# Database layer — Specs 01–03

Supabase Postgres implementation of the PM Dashboard data model, calculation
logic, and access control. Everything here is plain SQL migrations so it applies
identically whether the Next.js frontend talks to Supabase directly or (later) a
FastAPI service does.

## Migrations (apply in order)

| File | Spec | Contents |
|---|---|---|
| `0001_schema.sql` | 01 | Enums, all 7 tables, column constraints, FKs, indexes |
| `0002_functions_triggers.sql` | 01 §5.1, §2.2–2.4 | Identity provisioning trigger, over-allocation hard block, hours-log team-member check, manager-lead role check, `updated_at` |
| `0003_calculations.sql` | 02 | Allocation % / % Completion / % Pending functions, working-days helper, `project_metrics` view |
| `0004_rls.sql` | 03 | `is_admin()` / `is_active_user()` / `leads_project()`, RLS policies on every table, grants, heatmap `fn_person_total_allocation_pct()` |
| `0005_project_status_detail.sql` | 01 (ext.) | Adds `project.status_detail` free-text note (seed-data decision) |

Later migrations (0006–0028) extend metrics, org projects, approvals, designations, and **InfraSpecs/InfraBilling** (`0026` InfraOps role; `0027` providers/resources/invoices/RLS/storage; `0028` index/grant optimizations).

Then load `seed.sql` (data imported from the source project tracker).

## Apply to a hosted Supabase project

Run the four migration files in order. Either via the CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

…or paste each file, in numeric order, into the Supabase dashboard **SQL Editor**
and run them one at a time. Finish by running `seed.sql`.

## Seed data (`seed.sql`)

Imported from the source project tracker CSV. Notable choices (also commented in
the file):

- People in the **RI** column → `Manager-Lead` + active; all other team members →
  pending (`role NULL`, `is_active false`). **No Admin is seeded** — promote one
  yourself (see below). Emails are `<firstname>@amzur.com`.
- **Estimates only**: `estimated_effort_hrs` comes from the "hrs required" column
  (nominal 40 where absent); no hours are logged, so every project's % Completion
  starts at 0.
- Status categories are mapped to clean `StatusOption` labels; the original
  free-text note is preserved in `project.status_detail`.
- The over-allocation trigger is briefly disabled during the team-member insert
  because the source data itself exceeds 100% in one week (Geetashish is 100% on
  both *Artefact UAE* and *USU-Web*, both starting the week of 2026-06-29). The
  real figures are loaded unchanged; validation resumes afterwards.

## Key implementation decisions (where a spec needed a concrete choice)

- **`users.user_id` has no hard FK to `auth.users`.** Spec 01 §5.1 requires an
  Admin to be able to *pre-provision* a profile row before that person's first
  sign-in, and requires the `on_auth_user_created` trigger to *link* it by email
  (adopting the auth UUID). A hard FK to `auth.users` would make pre-provisioning
  impossible. The 1:1 UUID correspondence is maintained by the trigger instead.
- **`is_active` caller guard folded into every policy.** Spec 03 §4 shows
  illustrative policies without the active-user check, but §3/§7 state that
  pending/inactive users must get zero rows everywhere. `is_active_user()` is
  therefore ANDed into each ownership branch (`is_admin()` already requires it).
- **Calculation functions are `SECURITY INVOKER`** so they respect the caller's
  RLS scope. The single documented cross-project exception (§4.6 heatmap total)
  is `SECURITY DEFINER` and returns only an aggregate percent.
- **`project_metrics` view uses `security_invoker = true`** (PG15) so RLS still
  scopes which projects a Manager-Lead sees through it.
- **Pending users** are auto-created with `weekly_capacity_hrs = 40` (the schema
  default) since §5.1 doesn't specify one for the pending state; an Admin adjusts
  it on activation.

## First Admin

There is no in-app bootstrap wizard (Spec 03 §3). After the first person signs in
with Google (the `on_auth_user_created` trigger creates their pending profile),
promote them once:

```sql
update public.users set role = 'Admin', is_active = true
  where lower(email) = lower('first.admin@amzur.com');
```
