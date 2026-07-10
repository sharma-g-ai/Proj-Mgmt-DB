import ExcelJS from "exceljs";
import { round1 } from "@/lib/format";
import type { ReportData } from "@/lib/report/types";

// Spec 08 §3.2 — three sheets of raw, pivot-ready numbers (no charts).
export async function buildXlsx(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PM Dashboard";
  wb.created = data.generatedAt;

  // Sheet 1 — Portfolio Summary (one row per project × resource; project columns
  // repeat). Column order matches the on-screen Projects tab.
  const s1 = wb.addWorksheet("Portfolio Summary");
  s1.columns = [
    { header: "Project", key: "project_name", width: 24 },
    { header: "Resource", key: "person", width: 18 },
    { header: "Man-hours", key: "allocated_hours", width: 12 },
    { header: "Stakeholder", key: "stakeholder", width: 14 },
    { header: "Type", key: "project_type_label", width: 12 },
    { header: "Priority", key: "priority", width: 10 },
    { header: "Status", key: "status_label", width: 14 },
    { header: "Manager/Lead", key: "manager_lead_name", width: 18 },
    { header: "Start Date", key: "start_date", width: 12 },
    { header: "Planned End", key: "planned_end_date", width: 12 },
    { header: "Estimated Hrs", key: "estimated_effort_hrs", width: 13 },
    { header: "Logged Hrs", key: "logged_hours", width: 11 },
    { header: "% Completion", key: "pct_completion", width: 13 },
    { header: "Pending Hrs", key: "pending_hours", width: 12 },
    { header: "Pending %", key: "pending_pct", width: 11 },
    { header: "Planned Hrs", key: "planned_hours", width: 12 },
    { header: "Allocation %", key: "allocation_pct", width: 12 },
    { header: "Working Days Left", key: "working_days_remaining", width: 16 },
    { header: "Archived", key: "is_archived", width: 10 },
  ];
  for (const p of data.projectRows) {
    s1.addRow({
      ...p,
      allocated_hours: num(p.allocated_hours),
      logged_hours: num(p.logged_hours),
      pct_completion: num(p.pct_completion),
      pending_hours: num(p.pending_hours),
      pending_pct: num(p.pending_pct),
      planned_hours: num(p.planned_hours),
      allocation_pct: num(p.allocation_pct),
      is_archived: p.is_archived ? "Yes" : "No",
    });
  }

  // Sheet 2 — Team Allocation Detail (one row per ProjectTeamMember).
  const s2 = wb.addWorksheet("Team Allocation Detail");
  s2.columns = [
    { header: "Project", key: "project_name", width: 24 },
    { header: "Person", key: "person", width: 20 },
    { header: "Start", key: "start_date", width: 12 },
    { header: "End", key: "end_date", width: 12 },
    { header: "Man-hours", key: "allocated_hours", width: 13 },
  ];
  for (const t of data.team) s2.addRow(t);

  // Sheet 3 — Hours Log Detail (one row per HoursLogEntry).
  const s3 = wb.addWorksheet("Hours Log Detail");
  s3.columns = [
    { header: "Project", key: "project_name", width: 24 },
    { header: "Person", key: "person", width: 20 },
    { header: "Date", key: "entry_date", width: 12 },
    { header: "Hours", key: "hours_logged", width: 10 },
    { header: "Source", key: "source", width: 10 },
  ];
  for (const h of data.hours) s3.addRow(h);

  for (const ws of [s1, s2, s3]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    // Native Excel filter dropdowns over the header row.
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  }

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

function num(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : round1(v);
}
