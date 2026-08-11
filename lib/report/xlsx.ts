import ExcelJS from "exceljs";
import { fmtMonthLabel, round1 } from "@/lib/format";
import type { ReportData } from "@/lib/report/types";
import {
  sheetGrandTotal,
  sheetMonthTotal,
  type InfraBillingToolSheet,
} from "@/lib/report/infraBilling";

type ColSpec = { header: string; key: string; width: number };
type VisibleColumns = {
  projects?: string[];
  hours?: string[];
  finance?: string[];
  infrabilling?: string[];
};

function pick(cols: ColSpec[], keys?: string[]): ColSpec[] {
  if (!keys) return cols;
  const set = new Set(keys);
  const kept = cols.filter((c) => set.has(c.key));
  return kept.length > 0 ? kept : cols;
}

export async function buildXlsx(
  data: ReportData,
  visible?: VisibleColumns,
  financeMonthLabel?: string
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PM Dashboard";
  wb.created = data.generatedAt;

  const isInfraOnly =
    data.projectRows.length === 0 &&
    data.team.length === 0 &&
    data.hours.length === 0 &&
    data.finance.length === 0;

  const sheets: ExcelJS.Worksheet[] = [];
  const matrixSheetNames = new Set<string>();

  if (!isInfraOnly) {
    const s1 = wb.addWorksheet("Portfolio Summary");
    s1.columns = pick(
      [
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
      ],
      visible?.projects
    );
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
    sheets.push(s1);

    const s2 = wb.addWorksheet("Logged Hours");
    s2.columns = pick(
      [
        { header: "Project", key: "project_name", width: 24 },
        { header: "Person", key: "person", width: 20 },
        { header: "Start Date", key: "start_date", width: 12 },
        { header: "End Date", key: "end_date", width: 12 },
        { header: "Logged Hours", key: "hours_logged", width: 13 },
        { header: "Category", key: "category", width: 14 },
        { header: "Source", key: "source", width: 10 },
      ],
      visible?.hours
    );
    for (const h of data.hours) s2.addRow(h);
    sheets.push(s2);

    const s3 = wb.addWorksheet("Team Allocation");
    s3.columns = [
      { header: "Project", key: "project_name", width: 24 },
      { header: "Person", key: "person", width: 20 },
      { header: "Start Date", key: "start_date", width: 12 },
      { header: "End Date", key: "end_date", width: 12 },
      { header: "Man-hours", key: "allocated_hours", width: 12 },
    ];
    for (const t of data.team) {
      s3.addRow({ ...t, allocated_hours: num(t.allocated_hours) });
    }
    sheets.push(s3);

    if (data.finance.length > 0) {
      const suffix = financeMonthLabel ? ` (${financeMonthLabel})` : "";
      const name = `Finance${suffix}`.slice(0, 31);
      const s4 = wb.addWorksheet(name);
      s4.columns = pick(
        [
          { header: "Employee ID", key: "employee_id", width: 14 },
          { header: "Employee Name", key: "name", width: 22 },
          { header: "Role", key: "role_label", width: 18 },
          ...data.financeProjects.map((p) => ({ header: p, key: p, width: 14 })),
          { header: "Total", key: "total", width: 10 },
        ],
        visible?.finance
      );
      for (const f of data.finance) {
        s4.addRow({
          employee_id: f.employee_id ?? "",
          name: f.name,
          role_label: f.role_label,
          ...f.hours,
          total: num(f.total),
        });
      }
      sheets.push(s4);
    }
  }

  // ONE InfraBilling worksheet — columns grouped by tool (AWS, E2E, …).
  const infraSheets = data.infraBillingSheets?.length ? data.infraBillingSheets : [];
  if (infraSheets.length > 0) {
    const name = "InfraBilling";
    writeInfraBillingMatrixSheet(wb, name, infraSheets[0]);
    matrixSheetNames.add(name);
    sheets.push(wb.getWorksheet(name)!);
  }

  if (sheets.length === 0) {
    const empty = wb.addWorksheet("InfraBilling");
    empty.getCell(1, 1).value = "No infra billing data";
    sheets.push(empty);
  }

  for (const ws of sheets) {
    if (matrixSheetNames.has(ws.name)) continue;
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columnCount },
    };
  }

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

function writeInfraBillingMatrixSheet(
  wb: ExcelJS.Workbook,
  name: string,
  sheet: InfraBillingToolSheet
) {
  const ws = wb.addWorksheet(name);
  const blocks = sheet.toolBlocks ?? [];
  const anyOwn = blocks.some((b) => b.showOwnershipHeaders);

  type ProjCol = { col: number; blockIdx: number; groupIdx: number; projectId: string };
  type GrpCol = { col: number; blockIdx: number; groupIdx: number };

  let col = 2;
  const projectCols: ProjCol[] = [];
  const groupTotalCols: GrpCol[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    for (let gi = 0; gi < b.groups.length; gi++) {
      const g = b.groups[gi];
      for (const p of g.projects) {
        projectCols.push({ col, blockIdx: bi, groupIdx: gi, projectId: p.project_id });
        col++;
      }
      if (b.showOwnershipHeaders) {
        groupTotalCols.push({ col, blockIdx: bi, groupIdx: gi });
        col++;
      }
    }
  }
  const grandTotalCol = col;
  const lastCol = grandTotalCol;

  // Same gray chrome as on-screen DataTable-style InfraBilling (merged headers).
  ws.getCell(1, 1).value = "Month";
  styleRange(ws, 1, 1, anyOwn ? 3 : 2, 1, "FFF9FAFB", true);
  if (anyOwn) ws.mergeCells(1, 1, 3, 1);
  else ws.mergeCells(1, 1, 2, 1);

  let c = 2;
  for (const b of blocks) {
    const span =
      b.groups.reduce((n, g) => n + g.projects.length, 0) +
      (b.showOwnershipHeaders ? b.groups.length : 0);
    const start = c;
    const end = c + Math.max(span, 1) - 1;
    ws.getCell(1, start).value = `${b.tool} (USD)`;
    if (end > start) ws.mergeCells(1, start, 1, end);
    styleRange(ws, 1, start, 1, end, "FFF3F4F6", true);
    c = end + 1;
  }
  ws.getCell(1, grandTotalCol).value = "Grand Total";
  styleRange(ws, 1, grandTotalCol, anyOwn ? 3 : 2, grandTotalCol, "FFF3F4F6", true);
  if (anyOwn) ws.mergeCells(1, grandTotalCol, 3, grandTotalCol);
  else ws.mergeCells(1, grandTotalCol, 2, grandTotalCol);

  let headerRow = 2;
  if (anyOwn) {
    c = 2;
    for (const b of blocks) {
      if (b.showOwnershipHeaders) {
        for (const g of b.groups) {
          const start = c;
          const end = c + g.projects.length; // projects + group total
          ws.getCell(2, start).value = g.stakeholder;
          if (end > start) ws.mergeCells(2, start, 2, end);
          styleRange(ws, 2, start, 2, end, "FFF9FAFB", true);
          c = end + 1;
        }
      } else {
        const span = Math.max(
          b.groups.reduce((n, g) => n + g.projects.length, 0),
          1
        );
        const start = c;
        const end = c + span - 1;
        ws.getCell(2, start).value = "—";
        if (end > start) ws.mergeCells(2, start, 2, end);
        styleRange(ws, 2, start, 2, end, "FFF9FAFB", false);
        c = end + 1;
      }
    }
    headerRow = 3;
  }

  for (const pc of projectCols) {
    const p = blocks[pc.blockIdx].groups[pc.groupIdx].projects.find(
      (x) => x.project_id === pc.projectId
    )!;
    ws.getCell(headerRow, pc.col).value = p.project_name;
    styleRange(ws, headerRow, pc.col, headerRow, pc.col, "FFFFFFFF", true);
  }
  for (const gt of groupTotalCols) {
    const g = blocks[gt.blockIdx].groups[gt.groupIdx];
    ws.getCell(headerRow, gt.col).value = `${g.stakeholder} Total`;
    styleRange(ws, headerRow, gt.col, headerRow, gt.col, "FFF9FAFB", true);
  }

  let row = headerRow + 1;
  for (const m of sheet.months) {
    ws.getCell(row, 1).value = fmtMonthLabel(m);
    for (const pc of projectCols) {
      const p = blocks[pc.blockIdx].groups[pc.groupIdx].projects.find(
        (x) => x.project_id === pc.projectId
      )!;
      const v = p.months[m];
      ws.getCell(row, pc.col).value = v != null && v !== 0 ? v : null;
      ws.getCell(row, pc.col).alignment = { horizontal: "right" };
    }
    for (const gt of groupTotalCols) {
      const g = blocks[gt.blockIdx].groups[gt.groupIdx];
      const v = g.months[m];
      ws.getCell(row, gt.col).value = v != null && v !== 0 ? v : null;
      ws.getCell(row, gt.col).alignment = { horizontal: "right" };
    }
    const gv = sheetMonthTotal(sheet, m);
    ws.getCell(row, grandTotalCol).value = gv !== 0 ? gv : null;
    ws.getCell(row, grandTotalCol).alignment = { horizontal: "right" };
    row++;
  }

  ws.getCell(row, 1).value = "Total";
  ws.getCell(row, 1).font = { bold: true };
  for (const pc of projectCols) {
    const p = blocks[pc.blockIdx].groups[pc.groupIdx].projects.find(
      (x) => x.project_id === pc.projectId
    )!;
    ws.getCell(row, pc.col).value = p.total || null;
    ws.getCell(row, pc.col).font = { bold: true };
    ws.getCell(row, pc.col).alignment = { horizontal: "right" };
  }
  for (const gt of groupTotalCols) {
    const g = blocks[gt.blockIdx].groups[gt.groupIdx];
    ws.getCell(row, gt.col).value = g.total || null;
    ws.getCell(row, gt.col).font = { bold: true };
    ws.getCell(row, gt.col).alignment = { horizontal: "right" };
  }
  ws.getCell(row, grandTotalCol).value = sheetGrandTotal(sheet) || null;
  ws.getCell(row, grandTotalCol).font = { bold: true };
  ws.getCell(row, grandTotalCol).alignment = { horizontal: "right" };

  ws.getColumn(1).width = 14;
  for (let i = 2; i <= lastCol; i++) ws.getColumn(i).width = 14;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow }];
}

function styleRange(
  ws: ExcelJS.Worksheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  argb: string,
  bold: boolean
) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
      cell.font = { bold, size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD1D5DB" } },
        left: { style: "thin", color: { argb: "FFD1D5DB" } },
        bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
        right: { style: "thin", color: { argb: "FFD1D5DB" } },
      };
    }
  }
}

function num(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : round1(v);
}
