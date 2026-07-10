"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isWeekend } from "@/lib/format";
import type { ActionState } from "@/lib/types";

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
  if (m.includes("project_stakeholder_values"))
    return "Stakeholder must be Internal or External.";
  if (m.includes("estimated_effort") ) return "Estimated Effort Hrs must be zero or greater.";
  if (m.includes("hours_logged_positive")) return "Hours logged must be greater than zero.";
  if (m.includes("row-level security") || m.includes("violates row-level security"))
    return "You don't have permission to make this change.";
  if (m.includes("manager_lead_id")) return message;
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

  const payload = {
    project_name: str(form, "project_name"),
    stakeholder: str(form, "stakeholder"),
    stakeholder_description: str(form, "stakeholder_description") || null,
    description: str(form, "description") || null,
    project_type_id: str(form, "project_type_id"),
    priority: str(form, "priority"),
    status_id: str(form, "status_id"),
    manager_lead_id: str(form, "manager_lead_id"),
    start_date: str(form, "start_date"),
    planned_end_date: str(form, "planned_end_date"),
    estimated_effort_hrs: Number(str(form, "estimated_effort_hrs")),
  };

  if (!payload.project_name) return { error: "Project Name is required." };
  if (!payload.manager_lead_id) return { error: "Manager/Lead is required." };
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
  const supabase = createClient();

  const payload = {
    project_name: str(form, "project_name"),
    stakeholder: str(form, "stakeholder"),
    stakeholder_description: str(form, "stakeholder_description") || null,
    description: str(form, "description") || null,
    project_type_id: str(form, "project_type_id"),
    priority: str(form, "priority"),
    status_id: str(form, "status_id"),
    manager_lead_id: str(form, "manager_lead_id"),
    start_date: str(form, "start_date"),
    planned_end_date: str(form, "planned_end_date"),
    estimated_effort_hrs: Number(str(form, "estimated_effort_hrs")),
    status_detail: str(form, "status_detail") || null,
  };

  if (!payload.project_name) return { error: "Project Name is required." };
  if (!payload.estimated_effort_hrs || payload.estimated_effort_hrs <= 0)
    return { error: "Estimated Effort Hrs is required and must be greater than 0." };
  const dateErr = weekdayDateError(payload.start_date, payload.planned_end_date);
  if (dateErr) return { error: dateErr };

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
// Team & Allocation. Man-hours over a weekday range; over-allocation is a soft
// signal surfaced on the dashboard, not a save-time block.
// ---------------------------------------------------------------------------
export async function addTeamMember(
  projectId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const supabase = createClient();
  const payload = {
    project_id: projectId,
    user_id: str(form, "user_id"),
    allocated_hours: Number(str(form, "allocated_hours")),
    start_date: str(form, "start_date"),
    end_date: str(form, "end_date"),
  };
  if (!payload.user_id) return { error: "Select a team member." };
  const dateErr = weekdayDateError(payload.start_date, payload.end_date);
  if (dateErr) return { error: dateErr };
  if (!payload.allocated_hours || payload.allocated_hours <= 0)
    return { error: "Man-hours must be greater than 0." };

  const { error } = await supabase.from("project_team_member").insert(payload);
  if (error) return { error: friendlyError(error.message) };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function updateTeamMember(
  projectId: string,
  assignmentId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const supabase = createClient();
  const start_date = str(form, "start_date");
  const end_date = str(form, "end_date");
  const allocated_hours = Number(str(form, "allocated_hours"));
  const dateErr = weekdayDateError(start_date, end_date);
  if (dateErr) return { error: dateErr };
  if (!allocated_hours || allocated_hours <= 0) return { error: "Man-hours must be greater than 0." };

  const { error } = await supabase
    .from("project_team_member")
    .update({ allocated_hours, start_date, end_date })
    .eq("assignment_id", assignmentId);
  if (error) return { error: friendlyError(error.message) };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function removeTeamMember(projectId: string, assignmentId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("project_team_member")
    .delete()
    .eq("assignment_id", assignmentId);
  if (error) throw new Error(friendlyError(error.message));
  revalidatePath(`/projects/${projectId}`);
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
  const payload = {
    project_id: projectId,
    user_id: str(form, "user_id"),
    hours_logged: Number(str(form, "hours_logged")),
    entry_date: str(form, "entry_date"),
    source: "Manual" as const,
  };
  if (!payload.user_id) return { error: "Select a person." };
  if (!payload.entry_date) return { error: "Date is required." };
  if (!payload.hours_logged || payload.hours_logged <= 0)
    return { error: "Hours must be greater than 0." };

  const { error } = await supabase.from("hours_log_entry").insert(payload);
  if (error) return { error: friendlyError(error.message) };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function updateHours(
  projectId: string,
  entryId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const supabase = createClient();
  const payload = {
    hours_logged: Number(str(form, "hours_logged")),
    entry_date: str(form, "entry_date"),
  };
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
