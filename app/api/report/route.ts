import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildXlsx } from "@/lib/report/xlsx";
import { buildPdf } from "@/lib/report/pdf";
import type { ReportData, ReportTeamRow, ReportHoursRow, ReportProjectRow } from "@/lib/report/types";
import type { ProjectMetrics } from "@/lib/types";

// pdfkit/exceljs need the Node runtime; reports are always freshly generated.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = createClient();

  // Still authenticate the caller. The posted rows are the user's own already
  // RLS-visible data (fetched server-side for the preview) being echoed back into
  // their own download, so no per-row re-authorization is needed here.
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

  const isAdmin = profile.role === "Admin";
  const body = (await request.json().catch(() => ({}))) as {
    format?: string;
    scopeLabel?: string;
    projectRows?: ReportProjectRow[];
    team?: ReportTeamRow[];
    hours?: ReportHoursRow[];
    visibleColumns?: { projects?: string[]; team?: string[]; hours?: string[] };
  };

  const format = body.format === "xlsx" ? "xlsx" : "pdf";
  const projectRows = Array.isArray(body.projectRows) ? body.projectRows : [];
  const team = Array.isArray(body.team) ? body.team : [];
  const hours = Array.isArray(body.hours) ? body.hours : [];

  // The PDF works one-per-project; de-duplicate the expanded rows by project_id
  // (each row carries the full ProjectMetrics shape). Preserves shown order.
  const seen = new Set<string>();
  const projects: ProjectMetrics[] = [];
  for (const r of projectRows) {
    if (seen.has(r.project_id)) continue;
    seen.add(r.project_id);
    projects.push(r as ProjectMetrics);
  }

  // generatedBy/generatedAt come from the server session, never the client.
  const data: ReportData = {
    generatedBy: profile.full_name,
    generatedAt: new Date(),
    scopeLabel:
      typeof body.scopeLabel === "string" && body.scopeLabel
        ? body.scopeLabel
        : isAdmin
          ? "All Projects — Admin View"
          : "My Projects — Manager-Lead View",
    projects,
    projectRows,
    team,
    hours,
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const scopeSlug =
    projects.length === 1 ? slug(projects[0].project_name) : isAdmin ? "AllProjects" : "MyProjects";
  const base = `PM-Dashboard-Report-${scopeSlug}-${dateStr}`;

  if (format === "xlsx") {
    const buf = await buildXlsx(data, body.visibleColumns);
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
  return s.replace(/[^a-z0-9]+/gi, "") || "Project";
}
