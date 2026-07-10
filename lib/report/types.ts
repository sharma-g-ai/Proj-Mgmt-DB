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
  entry_date: string;
  hours_logged: number;
  source: string;
};

// One row per (project × team member) for the expanded Portfolio view. Carries
// all ProjectMetrics fields plus the resource's name and allocated man-hours.
// Projects with no team members appear once with person "—" / null hours.
export type ReportProjectRow = ProjectMetrics & {
  person: string;
  allocated_hours: number | null;
};

export type ReportData = {
  generatedBy: string;
  generatedAt: Date;
  scopeLabel: string; // human-readable, e.g. "All Projects — Admin View"
  projects: ProjectMetrics[];
  projectRows: ReportProjectRow[];
  team: ReportTeamRow[];
  hours: ReportHoursRow[];
};
