# Spec 02 — Calculation Logic

**Status:** Draft v1
**Depends on:** Spec 01 — Entity & Data Model
**Feeds into:** Functional Specs (Dashboard/Analytics, Reporting)

---

## 1. Scope
Defines the exact formulas for the three dynamically calculated fields — **Allocation %**, **% of Completion**, **% of Pending Hrs** — and where working-day/holiday rules apply. All calculations are computed on read, never stored.

---

## 2. Allocation %

### 2.1 Per-person, per-week allocated hours
For a given `ProjectTeamMember` row:

```
allocated_hours(person, week) = allocation_pct / 100 × weekly_capacity_hrs
```

Uses the person's `weekly_capacity_hrs` from `User`, not a working-day-adjusted figure — capacity is a standing weekly figure regardless of holidays that week (see §5 for where holidays *do* apply).

### 2.2 Project-level Allocation % for a given week
```
project_allocated_hours(project, week) = Σ allocated_hours(person, week) for all team members assigned that week

project_capacity_hours(project, week) = Σ weekly_capacity_hrs for all team members assigned that week

project_allocation_pct(project, week) = project_allocated_hours / project_capacity_hours × 100
```

This answers: "of the capacity the assigned team brings this week, what % is going to this project?" — it's a team-utilization view, not a percent-of-total-org-capacity view.

### 2.3 Rolled-up total Allocation % (project-to-date or project-lifetime)
```
total_allocation_pct(project) = Σ project_allocated_hours(project, w) for all weeks w with data
                                  ÷ Σ project_capacity_hours(project, w) for all weeks w with data
                                  × 100
```
i.e., an hours-weighted average across weeks, not a simple average of weekly percentages — this avoids skew from weeks with very few assigned people.

**Display:** dashboard shows both — current week's Allocation % *and* the rolled-up total, so a PM can see instantaneous load vs. average load.

---

## 3. % of Completion (Hrs)

```
logged_hours(project) = Σ HoursLogEntry.hours_logged for that project (all entries, source = Manual or JIRA)

pct_completion(project) = logged_hours(project) / Project.estimated_effort_hrs × 100
```

**Overrun handling:** this value is **not capped at 100%** — if `logged_hours` exceeds `estimated_effort_hrs`, % Completion displays above 100% (e.g. 112%) to make overruns visible, since v1 has no separate risk-flag mechanism. The dashboard should style anything >100% distinctly (e.g. red text) so it reads as a signal without building dedicated risk logic.

**Zero-estimate edge case:** if `estimated_effort_hrs = 0` (shouldn't happen given it's required, but defensively), % Completion is undefined — display "—" rather than dividing by zero.

---

## 4. % of Pending Hrs

Two representations, both shown per your original spec ("Pending Hrs" as hours, plus implied as %):

```
pending_hours(project) = Project.estimated_effort_hrs − logged_hours(project)

pending_pct(project) = 100 − pct_completion(project)
```

**Negative values (overrun):** if `logged_hours > estimated_effort_hrs`, both values go negative. Display as negative (e.g. "-8 hrs pending") rather than clamping to zero — this is consistent with not capping % Completion at 100%, and keeps the two figures mathematically consistent (`pending_pct` always equals `100 − pct_completion` exactly).

---

## 5. Where Calendar/Holiday Rules Apply

Per Spec 01 §4, Saturday/Sunday + `Holiday` table dates are excluded from working-day calculations. In v1, that rule applies specifically to:

- **Project duration display**: e.g. showing "18 working days remaining until Planned End Date" as contextual information on the dashboard/report — a read-only informational figure, not an input to any of the three calculated fields above.
- **Date range validation**: ensuring `start_date`/`planned_end_date` logic and any date-range filters on reports account for working days where relevant (e.g. a "days elapsed" stat).

**It does *not* apply to:**
- `weekly_capacity_hrs` (a standing figure, not adjusted per short/holiday weeks)
- The Allocation %, % Completion, or % Pending Hrs formulas themselves — those are pure hours ratios and don't need calendar adjustment.

This keeps the core formulas simple while still giving PMs calendar-aware context (working days remaining) elsewhere on the dashboard.

---

## 6. Rounding & Display

- All percentages: round to 1 decimal place for display (e.g. `67.3%`), calculate in full precision internally.
- All hour figures: round to 1 decimal place for display.
- No rounding applied before division — round only at final display step to avoid compounding rounding error.

---

## 7. Edge Cases Summary

| Scenario | Behavior |
|---|---|
| No team members assigned to a project for a given week | `project_allocation_pct` for that week = undefined ("—"), excluded from rolled-up total's sum |
| No `HoursLogEntry` rows yet | `pct_completion = 0%`, `pending_hours = estimated_effort_hrs`, `pending_pct = 100%` |
| Project archived (`is_archived = true`) | Values remain computable from historical data but excluded from active-portfolio dashboard views by default |
| `logged_hours` exceeds `estimated_effort_hrs` | % Completion >100%, Pending Hrs/pct go negative — not clamped (see §3, §4) |

---

## 8. Resolved Decisions (formerly open questions)

1. **Dashboard default view**: "current week" Allocation % defaults to the calendar week containing today's date (not the most recent week with data).
2. **Report snapshot timing**: reports use live calculations computed at generation time — no point-in-time snapshot mechanism at v1.
3. **>100% display styling**: overrun projects get a distinct badge/label (e.g. "OVER"), not just red text — to be specified precisely in the Dashboard/Reporting functional specs.