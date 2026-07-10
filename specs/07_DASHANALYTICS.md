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

### 2.2 Recent/At-a-Glance Project Cards
- A compact card list of the user's visible projects (not the full sortable/filterable table — that lives on the Project List screen), showing Name, Status, % Completion, and a link into the Project Detail screen.

### 2.3 Allocation Heatmap
- Grid: Team Members (rows) × Projects (columns, or vice versa), cell = current-week Allocation % for that person on that project.
- Project axis is scoped to the visible project set (Admin: all; Manager-Lead: own projects only).
- **Person totals are NOT silo'd**: each team member's row also shows their **total allocation across ALL their projects org-wide**, including projects the viewing Manager-Lead can't otherwise see or open. This is an intentional exception to the strict-silo policy (Spec 03) — a Manager-Lead can see that someone is, say, at 120% total load, without being able to see which other project is contributing to it. This surfaces over-allocation risk without leaking other projects' details.

### 2.4 Timeline View
- Week-by-week granularity: each project renders as a horizontal row spanning Start Date → Planned End Date, subdivided into weekly segments.
- Each weekly segment reflects that week's Allocation % (e.g. shaded intensity or a small label) so a PM can see staffing changes over time, not just a static bar.
- % Completion progress marker overlaid on the same timeline.
- Visually distinguishes "OVER" projects (badge/color per Spec 02 §8.3 resolution).

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
| Allocation heatmap | Org-wide | Limited to people staffed on their own projects |
| Filter by Manager/Lead | ✅ | N/A (already silo'd to self) |

---

## 6. Resolved Decisions (formerly open questions)

1. **Heatmap cross-project totals**: a person's row in the heatmap shows their total allocation across ALL projects org-wide, even ones outside the viewing Manager-Lead's silo — an intentional exception to strict silo, to surface over-allocation risk without exposing other projects' details (see §2.3).
2. **Dashboard vs. Project List**: confirmed as two separate screens — a lightweight Dashboard (summary cards, at-a-glance project cards, heatmap, timeline) and a full-featured Project List (Spec 05 §2) for management/filtering.
3. **Timeline view granularity**: confirmed week-by-week — the timeline shows weekly allocation changes over the project's duration, not just a static Start→End bar (see §2.4).