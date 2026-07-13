"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable, type ColumnDef } from "@/components/report/DataTable";
import { fmtPct, fmtHours, fmtDate, round1, committedInMonth, monthsInRange, fmtMonthLabel } from "@/lib/format";
import type {
  ReportTeamRow,
  ReportHoursRow,
  ReportProjectRow,
  FinanceRow,
  FinancePerson,
  FinanceAllocation,
} from "@/lib/report/types";

type Tab = "projects" | "hours" | "finance";

// Interactive, Excel-like report. Loads the full RLS-scoped dataset once, filters
// and sorts client-side, and exports exactly the rows currently shown (Spec 08).
export function ReportWorkbook({
  projectRows,
  team,
  hours,
  financePeople,
  financeAllocations,
  financeProjects,
  scopeLabel,
  isAdmin,
}: {
  projectRows: ReportProjectRow[];
  team: ReportTeamRow[]; // not shown as a tab; forwarded to the export for PDF rosters
  hours: ReportHoursRow[];
  financePeople: FinancePerson[]; // admin-only
  financeAllocations: FinanceAllocation[]; // admin-only; pivoted per month on the client
  financeProjects: string[]; // ordered project-name columns for the Finance pivot
  scopeLabel: string;
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<Tab>("projects");
  const [busy, setBusy] = useState<"pdf" | "xlsx" | "both" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest resolved (filtered + sorted) rows per tab, kept in refs so export reads
  // the current view without re-rendering on every keystroke.
  const resolvedProjects = useRef<ReportProjectRow[]>(projectRows);
  const resolvedHours = useRef<ReportHoursRow[]>(hours);
  const resolvedFinance = useRef<FinanceRow[]>([]); // populated by FinanceTab
  const financeMonthLabel = useRef<string>("");

  const onProjects = useCallback((r: ReportProjectRow[]) => {
    resolvedProjects.current = r;
  }, []);
  const onHours = useCallback((r: ReportHoursRow[]) => {
    resolvedHours.current = r;
  }, []);
  const onFinance = useCallback((r: FinanceRow[]) => {
    resolvedFinance.current = r;
  }, []);
  const onFinanceMonth = useCallback((label: string) => {
    financeMonthLabel.current = label;
  }, []);

  // Visible column keys per tab (drives which columns the export includes).
  const visibleProjects = useRef<string[]>(projectColumns.map((c) => c.key));
  const visibleHours = useRef<string[]>(hoursColumns.map((c) => c.key));
  const visibleFinance = useRef<string[]>([]); // set by FinanceTab's DataTable on mount
  const onProjectsCols = useCallback((k: string[]) => {
    visibleProjects.current = k;
  }, []);
  const onHoursCols = useCallback((k: string[]) => {
    visibleHours.current = k;
  }, []);
  const onFinanceCols = useCallback((k: string[]) => {
    visibleFinance.current = k;
  }, []);

  async function fetchAndSave(format: "pdf" | "xlsx") {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format,
        scopeLabel,
        projectRows: resolvedProjects.current,
        team, // full roster, for the PDF's per-project team lists
        hours: resolvedHours.current,
        finance: resolvedFinance.current,
        financeProjects,
        financeMonthLabel: financeMonthLabel.current,
        visibleColumns: {
          projects: visibleProjects.current,
          hours: visibleHours.current,
          finance: visibleFinance.current,
        },
      }),
    });
    if (!res.ok) throw new Error(`Report failed (${res.status})`);
    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition") ?? "";
    const match = disp.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] ?? `PM-Dashboard-Report.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function download(kind: "pdf" | "xlsx" | "both") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "both") {
        await fetchAndSave("pdf");
        await fetchAndSave("xlsx");
      } else {
        await fetchAndSave(kind);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report generation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs + download actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 text-sm">
          <TabButton active={tab === "projects"} onClick={() => setTab("projects")}>
            Projects
          </TabButton>
          <TabButton active={tab === "hours"} onClick={() => setTab("hours")}>
            Logged Hours
          </TabButton>
          {isAdmin && (
            <TabButton active={tab === "finance"} onClick={() => setTab("finance")}>
              Finance
            </TabButton>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => download("xlsx")} disabled={busy !== null}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy === "xlsx" ? "Generating…" : "Download XLSX"}
          </button>
          <button onClick={() => download("pdf")} disabled={busy !== null}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy === "pdf" ? "Generating…" : "Download PDF"}
          </button>
          <button onClick={() => download("both")} disabled={busy !== null}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy === "both" ? "Generating…" : "Both"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-gray-500">
        Sort by any column header, filter under it. Downloads match the current view —
        {isAdmin ? " scoped to all projects." : " scoped to the projects you lead."}
      </p>

      {/* All tabs mounted; hide inactive so each keeps its filters/sort and reports
          its resolved rows for export. */}
      <div className={tab === "projects" ? "" : "hidden"}>
        <DataTable
          rows={projectRows}
          columns={projectColumns}
          initialFilters={{ is_archived: "No" }}
          onResolved={onProjects}
          onVisibleColumnsChange={onProjectsCols}
          groupBy={(r) => r.project_id}
          emptyMessage="No projects match."
        />
      </div>
      <div className={tab === "hours" ? "" : "hidden"}>
        <DataTable
          rows={hours}
          columns={hoursColumns}
          onResolved={onHours}
          onVisibleColumnsChange={onHoursCols}
          emptyMessage="No hours logged."
        />
      </div>
      {isAdmin && (
        <div className={tab === "finance" ? "" : "hidden"}>
          <FinanceTab
            people={financePeople}
            allocations={financeAllocations}
            projects={financeProjects}
            onResolved={onFinance}
            onVisibleColumnsChange={onFinanceCols}
            onMonthLabel={onFinanceMonth}
          />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 font-medium ${
        active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

// Finance tab — a month-scoped person × project allocated-man-hours pivot (admin).
// The month `<select>` recomputes each person's per-project hours from the raw
// allocations (weekday-spread into the month) plus a Total.
const ALL_TIME = "all";
function FinanceTab({
  people,
  allocations,
  projects,
  onResolved,
  onVisibleColumnsChange,
  onMonthLabel,
}: {
  people: FinancePerson[];
  allocations: FinanceAllocation[];
  projects: string[];
  onResolved: (r: FinanceRow[]) => void;
  onVisibleColumnsChange: (k: string[]) => void;
  onMonthLabel: (label: string) => void;
}) {
  const months = useMemo(() => {
    if (allocations.length === 0) return [];
    let min = allocations[0].start_date;
    let max = allocations[0].end_date;
    for (const a of allocations) {
      if (a.start_date < min) min = a.start_date;
      if (a.end_date > max) max = a.end_date;
    }
    return monthsInRange(min, max);
  }, [allocations]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState<string>(() =>
    months.includes(currentMonth) ? currentMonth : months[months.length - 1] ?? ALL_TIME
  );

  const label = month === ALL_TIME ? "All time" : fmtMonthLabel(month);
  useEffect(() => {
    onMonthLabel(label);
  }, [label, onMonthLabel]);

  const rows = useMemo(
    () => buildFinanceRows(people, allocations, month === ALL_TIME ? null : month),
    [people, allocations, month]
  );
  const columns = useMemo(() => buildFinanceColumns(projects), [projects]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-600">
        Month
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonthLabel(m)}
            </option>
          ))}
          <option value={ALL_TIME}>All time</option>
        </select>
      </label>
      <DataTable
        rows={rows}
        columns={columns}
        onResolved={onResolved}
        onVisibleColumnsChange={onVisibleColumnsChange}
        emptyMessage="No people to show."
      />
    </div>
  );
}

// Pivot allocations for a month (or all-time when month is null) into one row per
// person: hours[project_name] and a Total.
function buildFinanceRows(
  people: FinancePerson[],
  allocations: FinanceAllocation[],
  month: string | null
): FinanceRow[] {
  const byUser = new Map<string, Record<string, number>>();
  for (const a of allocations) {
    const hrs = month ? committedInMonth(a, month) : a.allocated_hours;
    if (hrs <= 0) continue;
    const rec = byUser.get(a.user_id) ?? {};
    rec[a.project_name] = (rec[a.project_name] ?? 0) + hrs;
    byUser.set(a.user_id, rec);
  }
  return people.map((p) => {
    const rec = byUser.get(p.user_id) ?? {};
    const hoursOut: Record<string, number> = {};
    let total = 0;
    for (const k in rec) {
      hoursOut[k] = round1(rec[k]);
      total += rec[k];
    }
    return {
      employee_id: p.employee_id,
      name: p.name,
      role_label: p.role_label,
      hours: hoursOut,
      total: round1(total),
    };
  });
}

const dash = (s: string | null | undefined) => s ?? "—";
const numSort = (v: number | null | undefined) => (v === null || v === undefined ? -Infinity : v);

// Projects tab — mirrors the Portfolio Summary sheet (lib/report/xlsx.ts), expanded
// to one row per resource. Project-level columns are `group: true` so they collapse
// to the first row of each project's block; Resource + Man-hours vary per row.
const projectColumns: ColumnDef<ReportProjectRow>[] = [
  { key: "project_name", label: "Project", filter: "text", group: true, sortValue: (p) => p.project_name, display: (p) => p.project_name, filterText: (p) => p.project_name },
  { key: "person", label: "Resource", filter: "text", sortValue: (p) => p.person, display: (p) => p.person, filterText: (p) => p.person },
  { key: "allocated_hours", label: "Man-hours", align: "right", filter: "text", sortValue: (p) => numSort(p.allocated_hours), display: (p) => (p.allocated_hours === null ? "—" : fmtHours(p.allocated_hours)), filterText: (p) => (p.allocated_hours === null ? "" : fmtHours(p.allocated_hours)) },
  { key: "stakeholder", label: "Stakeholder", filter: "select", group: true, sortValue: (p) => p.stakeholder, display: (p) => p.stakeholder, filterText: (p) => p.stakeholder },
  { key: "project_type_label", label: "Type", filter: "select", group: true, sortValue: (p) => dash(p.project_type_label), display: (p) => dash(p.project_type_label), filterText: (p) => dash(p.project_type_label) },
  { key: "priority", label: "Priority", filter: "select", group: true, sortValue: (p) => p.priority, display: (p) => p.priority, filterText: (p) => p.priority },
  { key: "status_label", label: "Status", filter: "select", group: true, sortValue: (p) => dash(p.status_label), display: (p) => dash(p.status_label), filterText: (p) => dash(p.status_label) },
  { key: "manager_lead_name", label: "Manager/Lead", filter: "text", group: true, sortValue: (p) => dash(p.manager_lead_name), display: (p) => dash(p.manager_lead_name), filterText: (p) => dash(p.manager_lead_name) },
  { key: "start_date", label: "Start", filter: "text", group: true, sortValue: (p) => p.start_date, display: (p) => fmtDate(p.start_date), filterText: (p) => fmtDate(p.start_date) },
  { key: "planned_end_date", label: "Planned End", filter: "text", group: true, sortValue: (p) => p.planned_end_date, display: (p) => fmtDate(p.planned_end_date), filterText: (p) => fmtDate(p.planned_end_date) },
  { key: "estimated_effort_hrs", label: "Est. Hrs", align: "right", filter: "text", group: true, sortValue: (p) => numSort(p.estimated_effort_hrs), display: (p) => fmtHours(p.estimated_effort_hrs), filterText: (p) => fmtHours(p.estimated_effort_hrs) },
  { key: "logged_hours", label: "Logged Hrs", align: "right", filter: "text", group: true, sortValue: (p) => numSort(p.logged_hours), display: (p) => fmtHours(p.logged_hours), filterText: (p) => fmtHours(p.logged_hours) },
  { key: "pct_completion", label: "% Compl.", align: "right", filter: "text", group: true, sortValue: (p) => numSort(p.pct_completion), display: (p) => fmtPct(p.pct_completion), filterText: (p) => fmtPct(p.pct_completion) },
  { key: "pending_hours", label: "Pending Hrs", align: "right", filter: "text", group: true, sortValue: (p) => numSort(p.pending_hours), display: (p) => fmtHours(p.pending_hours), filterText: (p) => fmtHours(p.pending_hours) },
  { key: "pending_pct", label: "Pending %", align: "right", filter: "text", group: true, sortValue: (p) => numSort(p.pending_pct), display: (p) => fmtPct(p.pending_pct), filterText: (p) => fmtPct(p.pending_pct) },
  { key: "planned_hours", label: "Planned Hrs", align: "right", filter: "text", group: true, sortValue: (p) => numSort(p.planned_hours), display: (p) => fmtHours(p.planned_hours), filterText: (p) => fmtHours(p.planned_hours) },
  { key: "allocation_pct", label: "Alloc. %", align: "right", filter: "text", group: true, sortValue: (p) => numSort(p.allocation_pct), display: (p) => fmtPct(p.allocation_pct), filterText: (p) => fmtPct(p.allocation_pct) },
  { key: "working_days_remaining", label: "Days Left", align: "right", filter: "text", group: true, sortValue: (p) => numSort(p.working_days_remaining), display: (p) => String(p.working_days_remaining), filterText: (p) => String(p.working_days_remaining) },
  { key: "is_archived", label: "Archived", filter: "select", group: true, sortValue: (p) => (p.is_archived ? "Yes" : "No"), display: (p) => (p.is_archived ? "Yes" : "No"), filterText: (p) => (p.is_archived ? "Yes" : "No") },
];

// Logged Hours tab — mirrors the Logged Hours sheet.
const hoursColumns: ColumnDef<ReportHoursRow>[] = [
  { key: "project_name", label: "Project", filter: "text", sortValue: (r) => r.project_name, display: (r) => r.project_name, filterText: (r) => r.project_name },
  { key: "person", label: "Person", filter: "text", sortValue: (r) => r.person, display: (r) => r.person, filterText: (r) => r.person },
  { key: "entry_date", label: "Date", filter: "text", sortValue: (r) => r.entry_date, display: (r) => fmtDate(r.entry_date), filterText: (r) => fmtDate(r.entry_date) },
  { key: "hours_logged", label: "Logged Hours", align: "right", filter: "text", sortValue: (r) => numSort(r.hours_logged), display: (r) => fmtHours(r.hours_logged), filterText: (r) => fmtHours(r.hours_logged) },
  { key: "source", label: "Source", filter: "select", sortValue: (r) => r.source, display: (r) => r.source, filterText: (r) => r.source },
];

// Finance tab — Employee ID · Employee Name · Role · one column per project · Total.
function buildFinanceColumns(projectNames: string[]): ColumnDef<FinanceRow>[] {
  const fixed: ColumnDef<FinanceRow>[] = [
    { key: "employee_id", label: "Employee ID", filter: "text", sortValue: (r) => r.employee_id ?? "", display: (r) => r.employee_id ?? "—", filterText: (r) => r.employee_id ?? "" },
    { key: "name", label: "Employee Name", filter: "text", sortValue: (r) => r.name, display: (r) => r.name, filterText: (r) => r.name },
    { key: "role_label", label: "Role", filter: "select", sortValue: (r) => r.role_label, display: (r) => r.role_label, filterText: (r) => r.role_label },
  ];
  const projectCols: ColumnDef<FinanceRow>[] = projectNames.map((name) => ({
    key: name,
    label: name,
    align: "right",
    filter: "text",
    sortValue: (r) => r.hours[name] ?? 0,
    display: (r) => (r.hours[name] ? fmtHours(r.hours[name]) : "—"),
    filterText: (r) => (r.hours[name] ? fmtHours(r.hours[name]) : ""),
  }));
  const total: ColumnDef<FinanceRow> = {
    key: "total",
    label: "Total",
    align: "right",
    filter: "text",
    sortValue: (r) => r.total,
    display: (r) => fmtHours(r.total),
    filterText: (r) => fmtHours(r.total),
  };
  return [...fixed, ...projectCols, total];
}
