# Spec 08 — Functional Spec: Reporting (PDF/XLSX)

**Status:** Draft v1
**Depends on:** Spec 01 (Entity Model), Spec 02 (Calculation Logic), Spec 03 (Access Control), Spec 07 (Dashboard & Analytics — shares underlying data)

---

## 1. Scope
Generating downloadable PDF and XLSX reports from the same live-calculated data shown on the dashboard, per the "live calculation at generation time" decision (Spec 02 §8.2). **Implementation note:** with no FastAPI backend yet, report generation runs through a **Next.js Server Action or API route** (server-side, using the user's session to respect RLS scoping) rather than a dedicated backend service. Data queries reuse the same RLS-scoped Postgres access as the dashboard — a Manager-Lead's report generation can only ever pull their own projects, enforced by the same policies as Spec 03 §4.6, not by separate report-layer logic.

---

## 2. Report Scope Options
User selects, before generating:
- **Scope**: Single Project / All My Projects (Manager-Lead) or All Projects (Admin) — no cross-Manager-Lead scope selection since silo is strict (Spec 03).
- **Format**: PDF, XLSX, or both in one action (two files generated).
- **Include archived projects**: toggle, default off.

No date-range filter at v1 (live snapshot only, not historical point-in-time — consistent with Spec 02 §8.2).

---

## 3. Report Contents

### 3.1 PDF Report
- **Cover/header**: report title, generated-by user, generated-at timestamp, scope description (e.g. "All Projects — Admin View").
- **Portfolio Summary section**: same summary cards as Dashboard §2.1 (counts by Status/Priority, average % Completion, count of OVER projects), plus the Timeline view (Spec 07 §2.4) rendered as a static chart image.
- **Per-Project Detail section** (one block per project in scope): all core fields (Spec 01 §2.2), calculated fields (Allocation %, % Completion with OVER badge, Pending Hrs), and team roster with individual allocation.
- Charts: status distribution (pie/bar), allocation by team member (bar) — rendered as static images in the PDF.

### 3.2 XLSX Report
- **Sheet 1 — Portfolio Summary**: one row per project with all core + calculated fields (pivot-table-ready, raw numbers not formatted charts).
- **Sheet 2 — Team Allocation Detail**: one row per `ProjectTeamMember` entry (Project, Person, Week, Allocation %, Allocated Hours). **Defaults to current + recent N weeks** (N to be defined during implementation, e.g. last 12 weeks) rather than full history, to keep the sheet manageable — with an option to expand to full history if needed.
- **Sheet 3 — Hours Log Detail**: one row per `HoursLogEntry` (Project, Person, Date, Hours, Source).
- No embedded charts in XLSX at v1 (charts are a PDF-only feature); XLSX is the raw-data/analysis format.

---

## 4. Generation Flow
1. User clicks "Generate Report" (available from Dashboard or Project List, per Spec 05/07).
2. Selects scope + format options (§2).
3. Frontend calls a Next.js Server Action, which queries Supabase **using the calling user's session** (not the service-role key) — this ensures RLS naturally restricts the data to what that user is allowed to see, so no separate scope-enforcement logic is needed in the report generator itself. The Server Action computes all figures live (per Spec 02 principles) at the moment of generation and builds the PDF/XLSX file.
4. File(s) download directly to the browser, named per the pattern `PM-Dashboard-Report-{scope}-{date}.{ext}` (e.g. `PM-Dashboard-Report-AllProjects-2026-07-07.pdf`) — no report history/storage of past-generated reports at v1 (consistent with "no audit trail" decision).

---

## 5. Permissions Recap
| Action | Admin | Manager-Lead |
|---|---|---|
| Generate report — own projects | ✅ | ✅ |
| Generate report — all/other projects | ✅ | ❌ (strict silo, per Spec 03 §4.6) |

---

## 6. Resolved Decisions (formerly open questions)

1. **Chart rendering approach**: left as an implementation detail — no preference on server-side vs. client-side rendering for PDF chart images.
2. **Large XLSX row counts**: Team Allocation Detail sheet scopes to current + recent N weeks by default (see §3.2), not always full history.
3. **Report naming convention**: fixed pattern `PM-Dashboard-Report-{scope}-{date}.{ext}` (see §4).