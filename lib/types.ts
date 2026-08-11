// Shared domain types (mirrors Spec 01 entities + Spec 02 computed fields).

export type Priority = "High" | "Medium" | "Low";
export type UserRole = "Admin" | "Manager-Lead" | "InfraOps";
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
  provider_id: string | null;
  provider_label: string | null;
  ownership_option_id: string | null;
  ownership_label: string | null;
};

export type ProviderOption = { provider_id: string; label: string; is_active: boolean };
export type OwnershipOption = { option_id: string; label: string; is_active: boolean };

export type InfraResourceType = {
  resource_type_id: string;
  label: string;
  is_active: boolean;
};

export type InfraResourceTypeAttribute = {
  attribute_id: string;
  resource_type_id: string;
  attr_key: string;
  label: string;
  data_type: "text" | "number" | "boolean" | "date";
  is_required: boolean;
  sort_order: number;
};

export type InfraResourceRow = {
  resource_id: string;
  project_id: string;
  resource_type_id: string;
  name: string;
  external_id: string | null;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  resource_type?: { label: string } | null;
};

export type InfraProcessingStatus = "pending" | "processing" | "parsed" | "failed";
export type InfraValidationStatus = "unchecked" | "valid" | "invalid" | "partial";
export type InfraDiscrepancySeverity = "info" | "warning" | "error";
export type InfraDiscrepancyStatus = "open" | "acknowledged" | "resolved";

export type InfraInvoiceRow = {
  invoice_id: string;
  project_id: string;
  provider_id: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  invoice_number: string | null;
  currency: string | null;
  amount_total: number | null;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
  processing_status: InfraProcessingStatus;
  validation_status: InfraValidationStatus;
  extracted_payload: Record<string, unknown>;
  error_message: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  provider?: { label: string } | null;
};

export type InfraInvoiceLineRow = {
  line_id: string;
  invoice_id: string;
  resource_id: string | null;
  line_label: string | null;
  resource_type_label: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  amount: number | null;
  attributes: Record<string, unknown>;
  created_at: string;
};

export type InfraDiscrepancyRow = {
  discrepancy_id: string;
  invoice_id: string;
  discrepancy_type: string;
  severity: InfraDiscrepancySeverity;
  message: string;
  expected_value: string | null;
  actual_value: string | null;
  status: InfraDiscrepancyStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  | {
      error?: string;
      ok?: boolean;
      message?: string;
      needsReason?: boolean;
      /** Soft warning (e.g. duplicate invoice) — shown as a popup, does not fail the action. */
      warning?: string;
      /** Out-of-scope lines found in this upload/extract batch (popup after completion only). */
      outOfScopeCount?: number;
      /** Invoice(s) need Proceed/Reject after billing account/tool mismatch or missing account. */
      needsConfirm?: boolean;
      confirmInvoiceIds?: string[];
      confirmReason?: string;
      confirmFiles?: string[];
    }
  | undefined;

/** Account number allow-listed for a project’s billing tool. */
export type ProjectBillingAccount = {
  account_row_id: string;
  project_id: string;
  account_id: string;
  /** Optional display label; matching uses account_id only. */
  account_name: string | null;
  created_at: string;
};

// Approval flow (Spec 10) — Manager-Lead edits to Estimated Effort Hrs or to a
// resource allocation that would exceed it are staged here instead of applied.
export type ChangeRequestKind = "EstimatedHours" | "Allocation";
export type ChangeRequestStatus = "Pending" | "Approved" | "Rejected";

export type EstimatedHoursPayload = { new_estimated_effort_hrs: number };
export type NewMember = { user_id: string; start_date: string; end_date: string; allocated_hours: number };
export type TeamMemberEdit = { assignment_id: string; start_date: string; end_date: string; allocated_hours: number };
export type AllocationPayload = { adds: NewMember[]; updates: TeamMemberEdit[]; removes: string[] };

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
  acknowledged_at: string | null;
  created_at: string;
  project: { project_name: string } | null;
  requester: { full_name: string } | null;
};
