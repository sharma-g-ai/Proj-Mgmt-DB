"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireActiveUser } from "@/lib/auth";
import { isWeekend } from "@/lib/format";
import type { ActionState, ChangeRequestRow, EstimatedHoursPayload, AllocationPayload, NewMember, TeamMemberEdit } from "@/lib/types";

// Turn a Postgres/Supabase error into a user-facing message. The DB triggers and
// constraints (Spec 01) already produce descriptive text; we just tidy the common
// ones and pass the rest through.
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("over-allocation")) return message; // trigger message is already clear
  if (m.includes("must be a team member"))
    return "Hours can only be logged for a member of this project's team.";
  if (m.includes("project_name") && m.includes("unique"))
    return "A project with that name already exists.";
  if (m.includes("duplicate key") && m.includes("project_name"))
    return "A project with that name already exists.";
  if (m.includes("project_end_after_start"))
    return "Planned End Date must be on or after the Start Date.";
  if (m.includes("ptm_end_after_start"))
    return "Allocation end date must be on or after its start date.";
  if (m.includes("hle_end_after_start"))
    return "Hours entry end date must be on or after its start date.";
  if (m.includes("project_stakeholder_values"))
    return "Stakeholder must be Internal or External.";
  if (m.includes("estimated_effort") ) return "Estimated Effort Hrs must be zero or greater.";
  if (m.includes("hours_logged_positive")) return "Hours logged must be greater than zero.";
  if (m.includes("row-level security") || m.includes("violates row-level security"))
    return "You don't have permission to make this change.";
  if (m.includes("manager_lead_id")) return message;
  if (m.includes("one_pending_request_per_project"))
    return "A change for this project is already awaiting Admin approval.";
  return message;
}

function str(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

// Weekends aren't working days: start/end must be weekdays and ordered.
function weekdayDateError(start: string, end: string): string | null {
  if (!start || !end) return "Start and end dates are required.";
  if (isWeekend(start)) return "Start date must be a weekday (no weekends).";
  if (isWeekend(end)) return "End date must be a weekday (no weekends).";
  if (end < start) return "End date must be on or after the start date.";
  return null;
}

// ---------------------------------------------------------------------------
// Project create / update
// ---------------------------------------------------------------------------
export async function createProject(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const supabase = createClient();

  const isOrganizational = form.get("is_organizational") === "on";
  const payload = {
    project_name: str(form, "project_name"),
    stakeholder: str(form, "stakeholder"),
    stakeholder_description: str(form, "stakeholder_description") || null,
    description: str(form, "description") || null,
    jira_url: str(form, "jira_url") || null,
    drive_url: str(form, "drive_url") || null,
    is_organizational: isOrganizational,
    project_type_id: str(form, "project_type_id") || null,
    priority: str(form, "priority") || null,
    status_id: str(form, "status_id") || null,
    manager_lead_id: str(form, "manager_lead_id") || null,
    start_date: str(form, "start_date"),
    planned_end_date: str(form, "planned_end_date"),
    estimated_effort_hrs: Number(str(form, "estimated_effort_hrs")),
  };

  if (!payload.project_name) return { error: "Project Name is required." };
  if (!isOrganizational) {
    if (!payload.manager_lead_id) return { error: "Manager/Lead is required." };
    if (!payload.project_type_id) return { error: "Project Type is required." };
    if (!payload.priority) return { error: "Priority is required." };
    if (!payload.status_id) return { error: "Status is required." };
  }
  if (!payload.estimated_effort_hrs || payload.estimated_effort_hrs <= 0)
    return { error: "Estimated Effort Hrs is required and must be greater than 0." };
  const dateErr = weekdayDateError(payload.start_date, payload.planned_end_date);
  if (dateErr) return { error: dateErr };

  const { data, error } = await supabase
    .from("project")
    .insert(payload)
    .select("project_id")
    .single();

  if (error) return { error: friendlyError(error.message) };

  revalidatePath("/projects");
  redirect(`/projects/${data.project_id}`);
}

export async function updateProject(
  projectId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const { userId, profile } = await requireActiveUser();
  const isAdmin = profile.role === "Admin";
  const supabase = createClient();

  const isOrganizational = form.get("is_organizational") === "on";
  const payload = {
    project_name: str(form, "project_name"),
    stakeholder: str(form, "stakeholder"),
    stakeholder_description: str(form, "stakeholder_description") || null,
    description: str(form, "description") || null,
    jira_url: str(form, "jira_url") || null,
    drive_url: str(form, "drive_url") || null,
    is_organizational: isOrganizational,
    project_type_id: str(form, "project_type_id") || null,
    priority: str(form, "priority") || null,
    status_id: str(form, "status_id") || null,
    manager_lead_id: str(form, "manager_lead_id") || null,
    start_date: str(form, "start_date"),
    planned_end_date: str(form, "planned_end_date"),
    estimated_effort_hrs: Number(str(form, "estimated_effort_hrs")),
    status_detail: str(form, "status_detail") || null,
    // Billing tool (provider_id) is set on InfraSpecs — do not overwrite here.
    ownership_option_id: str(form, "ownership_option_id") || null,
  };

  if (!payload.project_name) return { error: "Project Name is required." };
  if (!isOrganizational) {
    if (!payload.manager_lead_id) return { error: "Manager/Lead is required." };
    if (!payload.project_type_id) return { error: "Project Type is required." };
    if (!payload.priority) return { error: "Priority is required." };
    if (!payload.status_id) return { error: "Status is required." };
  }
  if (!payload.estimated_effort_hrs || payload.estimated_effort_hrs <= 0)
    return { error: "Estimated Effort Hrs is required and must be greater than 0." };
  const dateErr = weekdayDateError(payload.start_date, payload.planned_end_date);
  if (dateErr) return { error: dateErr };

  if (!isAdmin) {
    const { data: current } = await supabase
      .from("project")
      .select("estimated_effort_hrs")
      .eq("project_id", projectId)
      .maybeSingle();
    if (current && Number(current.estimated_effort_hrs) !== payload.estimated_effort_hrs) {
      const reason = str(form, "reason");
      if (!reason) return { needsReason: true };
      const staged = await stageChangeRequest(supabase, {
        projectId,
        requestedBy: userId,
        kind: "EstimatedHours",
        payload: { new_estimated_effort_hrs: payload.estimated_effort_hrs },
        summary: `Estimated Effort Hrs: ${current.estimated_effort_hrs} → ${payload.estimated_effort_hrs}`,
        reason,
      });
      if (staged.error) return { error: staged.error };
      // Still apply every OTHER field change immediately — only the estimate
      // itself is gated. Write the rest now, holding the estimate at its
      // current value until the request is reviewed.
      const { estimated_effort_hrs: _skip, ...rest } = payload;
      const { error } = await supabase.from("project").update(rest).eq("project_id", projectId);
      if (error) return { error: friendlyError(error.message) };
      revalidatePath("/projects");
      revalidatePath(`/projects/${projectId}`);
      // Redirect (not just return a message) so the Edit form doesn't keep
      // showing the just-typed, not-yet-applied estimate value — the project
      // page's pending-approval banner is the clear, single source of truth.
      redirect(`/projects/${projectId}`);
    }
  }

  const { error } = await supabase
    .from("project")
    .update(payload)
    .eq("project_id", projectId);

  if (error) return { error: friendlyError(error.message) };

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

// ---------------------------------------------------------------------------
// Archive / unarchive (Spec 05 §4.4). Unarchive is Admin-only, enforced by RLS
// (a Manager-Lead's UPDATE on a project they lead is allowed, but see note below).
// ---------------------------------------------------------------------------
export async function setArchived(projectId: string, archived: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("project")
    .update({ is_archived: archived })
    .eq("project_id", projectId);
  if (error) throw new Error(friendlyError(error.message));
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

// ---------------------------------------------------------------------------
// Approval flow (Spec 10). Once a project has its first saved allocation, any
// further allocation change from a Manager-Lead — adding a member or editing
// an existing one — is staged here instead of written directly, and only
// takes effect once an Admin approves it (see approveChangeRequest /
// rejectChangeRequest below). Same for any Estimated Effort Hrs edit. Admin's
// own edits always write directly. Staging requires a reason from the
// requester; callers that don't have one yet get `needsReason: true` back
// with nothing written, and resubmit once the user supplies it.
// ---------------------------------------------------------------------------
async function stageChangeRequest(
  supabase: ReturnType<typeof createClient>,
  opts: { projectId: string; requestedBy: string; kind: "EstimatedHours" | "Allocation"; payload: object; summary: string; reason: string }
): Promise<{ error?: string; message?: string }> {
  const { error } = await supabase.from("project_change_request").insert({
    project_id: opts.projectId,
    requested_by: opts.requestedBy,
    kind: opts.kind,
    payload: opts.payload,
    summary: opts.summary,
    reason: opts.reason,
  });
  if (error) return { error: friendlyError(error.message) };
  // The banner (dashboard + project detail) is driven by getPendingChangeRequests,
  // read fresh on every render — without this, a staged-only write (no other
  // direct write in the same action) leaves the page showing stale, pre-staged
  // data until an unrelated navigation revalidates it.
  revalidatePath("/projects");
  revalidatePath(`/projects/${opts.projectId}`);
  revalidatePath("/dashboard");
  return { message: "Submitted for Admin approval — this change won't take effect until reviewed." };
}

// ---------------------------------------------------------------------------
// Team & Allocation. Man-hours over a weekday range; over-allocation is a soft
// signal surfaced on the dashboard, not a save-time block.
// ---------------------------------------------------------------------------
// Batch-save every added/edited row from the Team & Allocation table in one
// action — called directly (not via <form action>) from a client onClick, not
// FormData. Adding a brand-new member and editing an existing row now go
// through the same batch and the same approval gate (Spec 10).
type CurrentAssignment = {
  assignment_id: string;
  allocated_hours: number;
  start_date: string;
  end_date: string;
  users: { full_name: string } | null;
};

export async function saveTeamChanges(
  projectId: string,
  adds: NewMember[],
  updates: TeamMemberEdit[],
  removes: string[],
  reason?: string
): Promise<{ error?: string; message?: string; needsReason?: boolean }> {
  const { userId, profile } = await requireActiveUser();
  const isAdmin = profile.role === "Admin";
  const supabase = createClient();

  if (adds.length === 0 && updates.length === 0 && removes.length === 0) return {};
  for (const a of adds) {
    if (!a.user_id) return { error: "Select a team member." };
  }
  for (const m of [...adds, ...updates]) {
    const dateErr = weekdayDateError(m.start_date, m.end_date);
    if (dateErr) return { error: dateErr };
    if (!m.allocated_hours || m.allocated_hours <= 0)
      return { error: "Man-hours must be greater than 0." };
  }

  if (!isAdmin) {
    // The project's first staffing pass (adding members to an otherwise-empty
    // team, nothing being edited or removed) applies immediately — everything
    // after that, add, edit, or remove, is staged (Spec 10).
    const { count: existingCount } = await supabase
      .from("project_team_member")
      .select("assignment_id", { count: "exact", head: true })
      .eq("project_id", projectId);
    const isFirstStaffingPass = !existingCount && updates.length === 0 && removes.length === 0;

    if (!isFirstStaffingPass) {
      if (!reason) return { needsReason: true };

      const userIds = Array.from(new Set(adds.map((a) => a.user_id)));
      const assignmentIds = [...updates.map((u) => u.assignment_id), ...removes];
      const [{ data: metrics }, { data: newPeople }, { data: currentRows }] = await Promise.all([
        supabase.from("project_metrics").select("estimated_effort_hrs, planned_hours").eq("project_id", projectId).maybeSingle(),
        userIds.length
          ? supabase.from("users").select("user_id, full_name").in("user_id", userIds)
          : Promise.resolve({ data: [] as { user_id: string; full_name: string }[] }),
        assignmentIds.length
          ? supabase.from("project_team_member").select("assignment_id, allocated_hours, start_date, end_date, users(full_name)").in("assignment_id", assignmentIds)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);
      const nameByUser = new Map((newPeople ?? []).map((p) => [p.user_id, p.full_name]));
      const currentByAssignment = new Map(
        ((currentRows ?? []) as unknown as CurrentAssignment[]).map((r) => [r.assignment_id, r])
      );

      const lines: string[] = adds.map(
        (a) => `+ ${nameByUser.get(a.user_id) ?? "a team member"}: ${a.allocated_hours}h, ${a.start_date}–${a.end_date}`
      );
      for (const u of updates) {
        const current = currentByAssignment.get(u.assignment_id);
        const name = current?.users?.full_name ?? "a team member";
        const hoursChanged = current && Number(current.allocated_hours) !== u.allocated_hours;
        const datesChanged = current && (current.start_date !== u.start_date || current.end_date !== u.end_date);
        const hoursPart = hoursChanged ? `${current!.allocated_hours}h → ${u.allocated_hours}h` : `${u.allocated_hours}h`;
        const datesPart = datesChanged
          ? `${current!.start_date}–${current!.end_date} → ${u.start_date}–${u.end_date}`
          : `${u.start_date}–${u.end_date}`;
        lines.push(`${name}: ${hoursPart}, ${datesPart}`);
      }
      for (const assignmentId of removes) {
        const current = currentByAssignment.get(assignmentId);
        lines.push(`- ${current?.users?.full_name ?? "a team member"}: removed`);
      }
      const removedSum = removes.reduce((s, id) => s + (Number(currentByAssignment.get(id)?.allocated_hours) || 0), 0);
      const oldSum =
        updates.reduce((s, u) => s + (Number(currentByAssignment.get(u.assignment_id)?.allocated_hours) || 0), 0) +
        removedSum;
      const newSum = adds.reduce((s, a) => s + a.allocated_hours, 0) + updates.reduce((s, u) => s + u.allocated_hours, 0);
      const projected = (metrics?.planned_hours ?? 0) - oldSum + newSum;
      lines.push(`Planned total: ${projected}/${metrics?.estimated_effort_hrs ?? "?"}h`);

      return stageChangeRequest(supabase, {
        projectId,
        requestedBy: userId,
        kind: "Allocation",
        payload: { adds, updates, removes },
        summary: lines.join("\n"),
        reason,
      });
    }
  }

  for (const a of adds) {
    const { error } = await supabase.from("project_team_member").insert({ project_id: projectId, ...a });
    if (error) return { error: friendlyError(error.message) };
  }
  for (const u of updates) {
    const { error } = await supabase
      .from("project_team_member")
      .update({ start_date: u.start_date, end_date: u.end_date, allocated_hours: u.allocated_hours })
      .eq("assignment_id", u.assignment_id);
    if (error) return { error: friendlyError(error.message) };
  }
  if (removes.length) {
    const { error } = await supabase.from("project_team_member").delete().in("assignment_id", removes);
    if (error) return { error: friendlyError(error.message) };
  }

  revalidatePath(`/projects/${projectId}`);
  return {};
}

// ---------------------------------------------------------------------------
// Hours Log (Spec 05 §4.3). The "must be a team member" rule is a DB trigger.
// ---------------------------------------------------------------------------
export async function logHours(
  projectId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const supabase = createClient();
  const start_date = str(form, "start_date");
  const end_date = str(form, "end_date");
  const category = str(form, "category") || "Implementation";
  const payload = {
    project_id: projectId,
    user_id: str(form, "user_id"),
    hours_logged: Number(str(form, "hours_logged")),
    start_date,
    end_date,
    category,
    source: "Manual" as const,
  };
  if (!payload.user_id) return { error: "Select a person." };
  const dateError = weekdayDateError(start_date, end_date);
  if (dateError) return { error: dateError };
  if (!payload.hours_logged || payload.hours_logged <= 0)
    return { error: "Hours must be greater than 0." };

  const { error } = await supabase.from("hours_log_entry").insert(payload);
  if (error) return { error: friendlyError(error.message) };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects"); // list shows % Complete, which logged hours changes
  return { ok: true };
}

export async function updateHours(
  projectId: string,
  entryId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const supabase = createClient();
  const start_date = str(form, "start_date");
  const end_date = str(form, "end_date");
  const payload = {
    hours_logged: Number(str(form, "hours_logged")),
    start_date,
    end_date,
    category: str(form, "category") || "Implementation",
  };
  const dateError = weekdayDateError(start_date, end_date);
  if (dateError) return { error: dateError };
  if (!payload.hours_logged || payload.hours_logged <= 0)
    return { error: "Hours must be greater than 0." };

  const { error } = await supabase
    .from("hours_log_entry")
    .update(payload)
    .eq("entry_id", entryId);
  if (error) return { error: friendlyError(error.message) };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function deleteHours(projectId: string, entryId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("hours_log_entry").delete().eq("entry_id", entryId);
  if (error) throw new Error(friendlyError(error.message));
  revalidatePath(`/projects/${projectId}`);
}

// ---------------------------------------------------------------------------
// Approve / reject a staged change request (Spec 10). Admin-only — applies the
// exact staged write using the same tables/columns the direct-write paths
// above use, then marks the request reviewed.
// ---------------------------------------------------------------------------
export async function approveChangeRequest(requestId: string, note?: string): Promise<{ error?: string }> {
  const { profile } = await requireActiveUser();
  if (profile.role !== "Admin") return { error: "Admins only." };
  const supabase = createClient();

  const { data: req } = await supabase
    .from("project_change_request")
    .select("*")
    .eq("request_id", requestId)
    .maybeSingle();
  if (!req) return { error: "Request not found." };
  if (req.status !== "Pending") return { error: "This request has already been reviewed." };

  if (req.kind === "EstimatedHours") {
    const payload = req.payload as EstimatedHoursPayload;
    const { error } = await supabase
      .from("project")
      .update({ estimated_effort_hrs: payload.new_estimated_effort_hrs })
      .eq("project_id", req.project_id);
    if (error) return { error: friendlyError(error.message) };
  } else {
    const payload = req.payload as AllocationPayload;
    for (const a of payload.adds) {
      const dateErr = weekdayDateError(a.start_date, a.end_date);
      if (dateErr) return { error: dateErr };
      const { error } = await supabase.from("project_team_member").insert({
        project_id: req.project_id,
        user_id: a.user_id,
        allocated_hours: a.allocated_hours,
        start_date: a.start_date,
        end_date: a.end_date,
      });
      if (error) return { error: friendlyError(error.message) };
    }
    for (const u of payload.updates) {
      const dateErr = weekdayDateError(u.start_date, u.end_date);
      if (dateErr) return { error: dateErr };
      const { error } = await supabase
        .from("project_team_member")
        .update({ start_date: u.start_date, end_date: u.end_date, allocated_hours: u.allocated_hours })
        .eq("assignment_id", u.assignment_id);
      if (error) return { error: friendlyError(error.message) };
    }
    if (payload.removes?.length) {
      const { error } = await supabase.from("project_team_member").delete().in("assignment_id", payload.removes);
      if (error) return { error: friendlyError(error.message) };
    }
  }

  const { error: reviewError } = await supabase
    .from("project_change_request")
    .update({
      status: "Approved",
      reviewed_by: profile.user_id,
      reviewed_at: new Date().toISOString(),
      review_note: note || null,
    })
    .eq("request_id", requestId);
  if (reviewError) return { error: friendlyError(reviewError.message) };

  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${req.project_id}`);
  return {};
}

export async function rejectChangeRequest(requestId: string, note: string): Promise<{ error?: string }> {
  const { profile } = await requireActiveUser();
  if (profile.role !== "Admin") return { error: "Admins only." };
  const supabase = createClient();

  const { data: req } = await supabase
    .from("project_change_request")
    .select("project_id, status")
    .eq("request_id", requestId)
    .maybeSingle();
  if (!req) return { error: "Request not found." };
  if (req.status !== "Pending") return { error: "This request has already been reviewed." };

  const { error } = await supabase
    .from("project_change_request")
    .update({
      status: "Rejected",
      reviewed_by: profile.user_id,
      reviewed_at: new Date().toISOString(),
      review_note: note || null,
    })
    .eq("request_id", requestId);
  if (error) return { error: friendlyError(error.message) };

  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${req.project_id}`);
  return {};
}

// Fetch pending requests for the Approvals screen and per-project banners.
export async function getPendingChangeRequests(projectId?: string): Promise<ChangeRequestRow[]> {
  const supabase = createClient();
  let query = supabase
    .from("project_change_request")
    .select("*, project:project(project_name), requester:users!project_change_request_requested_by_fkey(full_name)")
    .eq("status", "Pending")
    .order("created_at", { ascending: true });
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query;
  return (data ?? []) as unknown as ChangeRequestRow[];
}

// Fetch the caller's own reviewed-but-unacknowledged requests, for the
// Dashboard notification banner (Spec 10 notification flow).
export async function getReviewedChangeRequests(): Promise<ChangeRequestRow[]> {
  const { userId } = await requireActiveUser();
  const supabase = createClient();
  const { data } = await supabase
    .from("project_change_request")
    .select("*, project:project(project_name), requester:users!project_change_request_requested_by_fkey(full_name)")
    .eq("requested_by", userId)
    .in("status", ["Approved", "Rejected"])
    .is("acknowledged_at", null)
    .order("reviewed_at", { ascending: false });
  return (data ?? []) as unknown as ChangeRequestRow[];
}

export async function acknowledgeChangeRequest(requestId: string): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.rpc("fn_acknowledge_change_request", { p_request: requestId });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/dashboard");
  return {};
}
