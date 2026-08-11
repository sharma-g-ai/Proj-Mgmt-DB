import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildXlsx } from "@/lib/report/xlsx";
import { buildPdf } from "@/lib/report/pdf";
import { canManageInfra } from "@/lib/infra/permissions";
import type {
  ReportData,
  ReportTeamRow,
  ReportHoursRow,
  ReportProjectRow,
  FinanceRow,
} from "@/lib/report/types";
import type { InfraBillingRow, InfraBillingToolSheet } from "@/lib/report/infraBilling";
import { buildInfraBillingSheets } from "@/lib/report/infraBilling";
import type { ProjectMetrics, UserRole } from "@/lib/types";

// pdfkit/exceljs need the Node runtime; reports are always freshly generated.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reject oversized JSON bodies (DoS / memory exhaustion). */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20_000;

function asArray<T>(v: unknown, max = MAX_ROWS): T[] {
  if (!Array.isArray(v)) return [];
  return v.length > max ? (v.slice(0, max) as T[]) : (v as T[]);
}

function safeLabel(v: unknown, fallback: string, max = 200): string {
  if (typeof v !== "string" || !v.trim()) return fallback;
  return v.replace(/[\r\n\0]/g, " ").trim().slice(0, max);
}

function safeStringList(v: unknown, maxItems = 200, maxLen = 80): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxLen));
}

export async function POST(request: Request) {
  const supabase = createClient();

  // Authenticate the caller. Posted rows are the user's already RLS-visible
  // preview data echoed into their download — still size/role-gated below.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_active) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const lenHeader = request.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isAdmin = profile.role === "Admin";
  const isInfraOps = profile.role === "InfraOps";
  const canInfra =
    canManageInfra({ role: profile.role as UserRole | null }) || profile.role === "Manager-Lead";

  const format = body.format === "xlsx" ? "xlsx" : "pdf";
  // InfraOps may only export InfraBilling — ignore any posted PM/finance rows.
  const projectRows =
    isInfraOps ? [] : asArray<ReportProjectRow>(body.projectRows);
  const team = isInfraOps ? [] : asArray<ReportTeamRow>(body.team);
  const hours = isInfraOps ? [] : asArray<ReportHoursRow>(body.hours);
  // Finance is admin-only; ignore any posted finance rows from a non-admin.
  const finance = isAdmin ? asArray<FinanceRow>(body.finance) : [];
  const financeProjects = isAdmin ? safeStringList(body.financeProjects, 5_000) : [];
  const financeMonthLabel =
    typeof body.financeMonthLabel === "string"
      ? body.financeMonthLabel.replace(/[^\d-]/g, "").slice(0, 7)
      : "";
  const infraBilling = canInfra ? asArray<InfraBillingRow>(body.infraBilling) : [];
  const infraBillingMonths = canInfra
    ? safeStringList(body.infraBillingMonths, 120, 10)
    : [];
  let infraBillingSheets: InfraBillingToolSheet[] = canInfra
    ? asArray<InfraBillingToolSheet>(body.infraBillingSheets, 50)
    : [];
  if (canInfra && infraBillingSheets.length === 0 && infraBilling.length > 0) {
    // Rebuild matrix if client only sent flat rows.
    infraBillingSheets = buildInfraBillingSheets(
      infraBilling.map((r) => ({
        project_id: r.project_id,
        project_name: r.project_name,
        stakeholder: r.ownership_label,
        ownership_label: r.ownership_label,
        provider_label: r.provider_label || null,
        billing_period_start: null,
        billing_period_end: null,
        amount_total: r.total,
        currency: r.currency,
      }))
    );
    // Preserve month breakdown from flat rows when rebuilding.
    for (const sheet of infraBillingSheets) {
      const monthSet = new Set<string>();
      for (const block of sheet.toolBlocks ?? []) {
        for (const g of block.groups) {
          for (const p of g.projects) {
            const src = infraBilling.find(
              (row) =>
                row.project_id === p.project_id &&
                (row.provider_label === block.tool || !row.provider_label)
            );
            if (src) {
              p.months = { ...src.months };
              p.total = src.total;
              for (const m of Object.keys(src.months)) monthSet.add(m);
            }
          }
          g.months = {};
          g.total = 0;
          for (const p of g.projects) {
            g.total += p.total;
            for (const [m, v] of Object.entries(p.months)) {
              g.months[m] = (g.months[m] ?? 0) + v;
            }
          }
        }
        block.months = {};
        block.total = 0;
        for (const g of block.groups) {
          block.total += g.total;
          for (const [m, v] of Object.entries(g.months)) {
            block.months[m] = (block.months[m] ?? 0) + v;
          }
        }
      }
      sheet.months = Array.from(monthSet).sort();
    }
  }

  const visibleRaw =
    body.visibleColumns && typeof body.visibleColumns === "object"
      ? (body.visibleColumns as Record<string, unknown>)
      : {};
  const visibleColumns = {
    projects: safeStringList(visibleRaw.projects),
    hours: safeStringList(visibleRaw.hours),
    finance: safeStringList(visibleRaw.finance),
    infrabilling: safeStringList(visibleRaw.infrabilling),
  };

  // The PDF works one-per-project; de-duplicate the expanded rows by project_id
  // (each row carries the full ProjectMetrics shape). Preserves shown order.
  const seen = new Set<string>();
  const projects: ProjectMetrics[] = [];
  for (const r of projectRows) {
    if (!r?.project_id || seen.has(r.project_id)) continue;
    seen.add(r.project_id);
    projects.push(r as ProjectMetrics);
  }

  const defaultScope = isAdmin
    ? "All Projects — Admin View"
    : isInfraOps
      ? "All Projects — InfraOps View"
      : "My Projects — Manager-Lead View";

  // generatedBy/generatedAt come from the server session, never the client.
  const data: ReportData = {
    generatedBy: profile.full_name,
    generatedAt: new Date(),
    scopeLabel: safeLabel(body.scopeLabel, defaultScope),
    projects,
    projectRows,
    team,
    hours,
    finance,
    financePeople: [],
    financeHours: [],
    financeProjects,
    infraBillingAtoms: [],
    infraBilling,
    infraBillingSheets,
    infraBillingMonths,
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const scopeSlug = isInfraOps
    ? "InfraBilling"
    : projects.length === 1
      ? slug(projects[0].project_name)
      : isAdmin
        ? "AllProjects"
        : "MyProjects";
  const base = `PM-Dashboard-Report-${scopeSlug}-${dateStr}`;

  if (format === "xlsx") {
    const buf = await buildXlsx(data, visibleColumns, financeMonthLabel);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  }

  const buf = await buildPdf(data);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${base}.pdf"`,
    },
  });
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").slice(0, 80) || "Project";
}
