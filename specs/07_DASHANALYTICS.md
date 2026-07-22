# Spec 07 — Functional Spec: Dashboard & Analytics

**Status:** Draft v1
**Depends on:** Spec 01 (Entity Model), Spec 02 (Calculation Logic), Spec 03 (Access Control)
**Feeds into:** Reporting Spec (shares the same underlying analytics)

---

## 1. Scope
The landing screen after login (post-auth) — a portfolio-style overview of the projects a user has access to, per Spec 03's strict-silo scoping.

---

## 2. Dashboard Layout

The Dashboard is a distinct, lightweight landing screen — separate from the full Project List/management screen (Spec 05 §2). It's an at-a-glance overview; detailed project management (filtering, editing, archiving) happens on the Project List screen instead.

### 2.1 Summary Cards (top of page)
- Count of projects by Status (e.g. "3 In Progress, 1 At Risk, 1 Completed").
- Count of projects by Priority.
- Average % Completion across active (non-archived) visible projects.
- Count of projects with an "OVER" badge (completion >100%) — surfaced prominently since v1 has no dedicated risk-flagging system (per Spec 02 §3).
- **Excludes organizational entries** (`Project.is_organizational = true`, Spec 01 §2.2) — these have no meaningful completion/estimate semantics and would skew the tallies.

### 2.2 Recent/At-a-Glance Project Cards (Manager-Lead) / Manager Summary (Admin)
- **Manager-Lead**: a compact card list of the user's own visible projects (not the full sortable/filterable table — that lives on the Project List screen), showing Name, Status, % Completion, and a link into the Project Detail screen.
- **Admin**: since Admin's project list is org-wide (a card-per-project view doesn't scale/summarize well), this slot instead shows a **Manager/Lead → Project Count** table — how many projects each Manager/Lead currently owns, at a glance. A Manager/Lead's own equivalent would be a trivial one-row view (they only ever see themselves as lead), so they keep the card list instead.
- Both views **exclude organizational entries**, same as §2.1.

### 2.3 Resource Utilization Table
- Grid: Team Members (rows) × **Total Projects** (distinct projects the person is committed to this week, within the visible project set) × **Load (all)** (org-wide committed hours vs. weekly capacity, as a man-hours delta).
- Row highlighting: over-capacity (red tint) or under 80% of capacity (amber tint), based on the Load (all) column.
- **Load (all) is NOT silo'd**: it reflects the person's committed hours across ALL their projects org-wide, including projects the viewing Manager-Lead can't otherwise see or open. This is an intentional exception to the strict-silo policy (Spec 03) — a Manager-Lead can see that someone is, say, over capacity, without being able to see which other project is contributing to it. This surfaces over-allocation risk without leaking other projects' details.

### 2.4 Allocation Timeline (moved to Reports)
- Week-by-week granularity: each project renders as a horizontal row spanning Start Date → Planned End Date, subdivided into weekly segments.
- Each weekly segment is colored by **that project's own assigned color** (deterministic per project, stable across reloads) when staffed that week, faint when in-range-but-unstaffed, and blank outside the project's date range — a legend maps each project to its color. This replaces the earlier heat-intensity-by-allocation-volume shading.
- % Completion progress marker (with "OVER" badge, Spec 02 §8.3) is shown alongside each project's row label.
- **Location**: this view lives in the Reports screen (Spec 08) as an "Allocation" tab, alongside Projects and Logged Hours — not on the Dashboard. Visible to both Admin (all projects) and Manager-Lead (own projects only, same RLS scoping as the rest of Reports).

---

## 3. Data Freshness
- All figures computed live on page load per Spec 02's "calculate on read" principle — no caching/staleness concerns at this scale (~20 projects).

---

## 4. Empty States
- No projects visible to this user yet: friendly empty state ("No projects yet — create your first project" for Manager-Leads with create rights, or a neutral message for a brand-new Admin).
- Project with no team members assigned: Allocation % shows "—" per Spec 02 §7.
- Project with no hours logged: % Completion shows 0%, Pending Hrs = full estimate, per Spec 02 §7.

---

## 5. Permissions Recap
| Element | Admin | Manager-Lead |
|---|---|---|
| Dashboard scope | All projects | Own projects only (strict silo, per Spec 03) |
| Summary cards | Org-wide | Own-projects-only |
| At-a-glance slot (§2.2) | Manager/Lead → Project Count table | Per-project cards |
| Resource utilization table | Org-wide | Limited to people staffed on their own projects |
| Allocation timeline (§2.4, now in Reports) | All projects | Own projects only |

---

## 6. Resolved Decisions (formerly open questions)

1. **Resource utilization "Load (all)" cross-project totals**: a person's row shows their total committed hours across ALL projects org-wide, even ones outside the viewing Manager-Lead's silo — an intentional exception to strict silo, to surface over-allocation risk without exposing other projects' details (see §2.3).
2. **Dashboard vs. Project List**: confirmed as two separate screens — a lightweight Dashboard (summary cards, at-a-glance slot, resource utilization table) and a full-featured Project List (Spec 05 §2) for management/filtering. The Allocation Timeline moved into the Reports screen (see §2.4).
3. **Timeline view granularity**: confirmed week-by-week — the timeline shows weekly staffing changes over the project's duration, not just a static Start→End bar (see §2.4).
4. **Timeline coloring**: switched from heat-intensity (shaded by allocation volume) to a flat, deterministic per-project color — easier to scan "which project is this" at a glance across many projects, at the cost of not showing relative allocation volume per cell (see §2.4).