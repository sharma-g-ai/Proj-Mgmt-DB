// Shared domain types (mirrors Spec 01 entities + Spec 02 computed fields).

export type Priority = "High" | "Medium" | "Low";
export type UserRole = "Admin" | "Manager-Lead";
export type HoursSource = "Manual" | "JIRA";

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
  project_type_id: string;
  project_type_label: string | null;
  priority: Priority;
  status_id: string;
  status_label: string | null;
  status_detail: string | null;
  manager_lead_id: string;
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

// Result shape for form server actions (used with useFormState).
export type ActionState = { error?: string; ok?: boolean } | undefined;
