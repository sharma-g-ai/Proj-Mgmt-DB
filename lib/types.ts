// Shared domain types (mirrors Spec 01 entities + Spec 02 computed fields).

export type Priority = "High" | "Medium" | "Low";
export type UserRole = "Admin" | "Manager-Lead";
export type HoursSource = "Manual" | "JIRA";
export type HoursCategory = "Collaboration" | "Implementation";

export type Profile = {
  user_id: string;
  full_name: string;
  email: string;
  role: UserRole | null;
  weekly_capacity_hrs: number;
  is_active: boolean;
};

// One row of the project_metrics view (base fields + computed fields).
export type ProjectMetrics = {
  project_id: string;
  project_name: string;
  stakeholder: string;
  stakeholder_description: string | null;
  description: string | null;
  jira_url: string | null;
  drive_url: string | null;
  is_organizational: boolean;
  project_type_id: string | null;
  project_type_label: string | null;
  priority: Priority | null;
  status_id: string | null;
  status_label: string | null;
  status_detail: string | null;
  manager_lead_id: string | null;
  manager_lead_name: string | null;
  start_date: string;
  planned_end_date: string;
  estimated_effort_hrs: number;
  is_archived: boolean;
  logged_hours: number;
  pct_completion: number | null;
  pending_hours: number;
  pending_pct: number | null;
  planned_hours: number;
  working_days_remaining: number;
  allocation_pct: number | null; // planned_hours ÷ estimated_effort_hrs × 100
};

export type LookupOption = { option_id: string; label: string; is_active: boolean };

// A row in the Users admin list. `role` is ACCESS; `designation`/`employee_id` are
// descriptive, access-independent fields.
export type UserRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: UserRole | null;
  weekly_capacity_hrs: number;
  is_active: boolean;
  employee_id: string | null;
  designation: { label: string } | null; // joined from designation_option
};

export type UserOption = {
  user_id: string;
  full_name: string;
  email: string;
  role?: UserRole | null;
  weekly_capacity_hrs?: number;
};

export type TeamMemberRow = {
  assignment_id: string;
  user_id: string;
  allocated_hours: number;
  start_date: string;
  end_date: string;
  users: { full_name: string; email: string; weekly_capacity_hrs: number; is_active: boolean } | null;
};

export type HoursEntryRow = {
  entry_id: string;
  user_id: string;
  hours_logged: number;
  start_date: string;
  end_date: string;
  source: HoursSource;
  category: HoursCategory;
  users: { full_name: string; email: string } | null;
};

// One allocation row used by the dashboard resource-utilization view (Spec 07).
export type AllocationRow = {
  allocated_hours: number;
  start_date: string;
  end_date: string;
  user_id: string;
  project_id: string;
  users: { full_name: string } | null;
};

// Result shape for form server actions (used with useFormState). `needsReason`
// signals the write was NOT performed — the caller must collect a reason from
// the user and resubmit with it before the change is staged (Spec 10).
export type ActionState =
  | { error?: string; ok?: boolean; message?: string; needsReason?: boolean }
  | undefined;

// Approval flow (Spec 10) — Manager-Lead edits to Estimated Effort Hrs or to a
// resource allocation that would exceed it are staged here instead of applied.
export type ChangeRequestKind = "EstimatedHours" | "Allocation";
export type ChangeRequestStatus = "Pending" | "Approved" | "Rejected";

export type EstimatedHoursPayload = { new_estimated_effort_hrs: number };
export type NewMember = { user_id: string; start_date: string; end_date: string; allocated_hours: number };
export type TeamMemberEdit = { assignment_id: string; start_date: string; end_date: string; allocated_hours: number };
export type AllocationPayload = { adds: NewMember[]; updates: TeamMemberEdit[] };

export type ChangeRequestRow = {
  request_id: string;
  project_id: string;
  requested_by: string;
  kind: ChangeRequestKind;
  payload: EstimatedHoursPayload | AllocationPayload;
  summary: string;
  reason: string;
  status: ChangeRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  project: { project_name: string } | null;
  requester: { full_name: string } | null;
};
