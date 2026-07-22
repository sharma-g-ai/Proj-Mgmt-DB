import type { ProjectMetrics } from "@/lib/types";

// Flattened rows for the report sheets/sections.
export type ReportTeamRow = {
  project_name: string;
  person: string;
  start_date: string;
  end_date: string;
  allocated_hours: number;
};

export type ReportHoursRow = {
  project_name: string;
  person: string;
  start_date: string;
  end_date: string;
  hours_logged: number;
  category: string;
  source: string;
};

// One row per (project × team member) for the expanded Portfolio view. Carries
// all ProjectMetrics fields plus the resource's name and allocated man-hours.
// Projects with no team members appear once with person "—" / null hours.
export type ReportProjectRow = ProjectMetrics & {
  person: string;
  allocated_hours: number | null;
};

// One row per person for the admin Finance pivot: logged hours per project
// (keyed by project_name) plus a Total, computed for a selected month on the client.
export type FinanceRow = {
  employee_id: string | null;
  name: string;
  role_label: string; // job title (designation)
  total: number;
  hours: Record<string, number>; // project_name → logged hours (for the month)
};

// Raw inputs the client pivots per month (server sends these; the month math lives
// client-side so switching months is instant).
export type FinancePerson = {
  user_id: string;
  employee_id: string | null;
  name: string;
  role_label: string; // job title (designation)
};
export type FinanceHours = {
  user_id: string;
  project_name: string;
  hours_logged: number; // total for the [start_date, end_date] range
  start_date: string;
  end_date: string;
};

export type ReportData = {
  generatedBy: string;
  generatedAt: Date;
  scopeLabel: string; // human-readable, e.g. "All Projects — Admin View"
  projects: ProjectMetrics[];
  projectRows: ReportProjectRow[];
  team: ReportTeamRow[];
  hours: ReportHoursRow[];
  // Finance (admin-only). `financePeople`/`financeHours` feed the client pivot;
  // `finance` carries the client-computed month rows on the export POST (server
  // returns []). `financeProjects` are the project-name columns.
  finance: FinanceRow[];
  financePeople: FinancePerson[];
  financeHours: FinanceHours[];
  financeProjects: string[];
};
