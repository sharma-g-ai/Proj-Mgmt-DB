"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveUser } from "@/lib/auth";
import type { ActionState } from "@/lib/types";

function str(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

// Confirm the acting session is an active Admin. Critical for createUser, which
// uses the service-role key (RLS-bypassing) — never trust the client for that.
async function callerIsAdmin(): Promise<boolean> {
  const { profile } = await requireActiveUser();
  return profile.role === "Admin";
}

function mapUserError(message: string, code?: string): string {
  const m = message.toLowerCase();
  if (m.includes("employee_id")) return "That Employee ID is already in use.";
  if (code === "23505" || m.includes("duplicate") || (m.includes("unique") && m.includes("email")))
    return "A user with that email already exists.";
  if (m.includes("amzur")) return "Email must be an @amzur.com address.";
  if (m.includes("cannot deactivate")) return message; // trigger message is descriptive
  if (m.includes("weekly_capacity")) return "Weekly Capacity must be zero or greater.";
  return message;
}

// ---------------------------------------------------------------------------
// Create — pre-provision a user before first login (Spec 06 §3.3, option 1).
// Inserts only a public.users row via the service-role client; on that person's
// first Google login the on_auth_user_created trigger links it by email.
// ---------------------------------------------------------------------------
export async function createUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!(await callerIsAdmin())) return { error: "Admins only." };

  const full_name = str(form, "full_name");
  const email = str(form, "email").toLowerCase();
  const role = str(form, "role");
  const capacity = Number(str(form, "weekly_capacity_hrs"));
  // Access level is the sole trigger for sign-in/data access — no separate toggle.
  const is_active = !!role;
  const employee_id = str(form, "employee_id");
  const designation_id = str(form, "designation_id");

  if (!full_name) return { error: "Full Name is required." };
  if (!email) return { error: "Email is required." };
  if (!email.endsWith("@amzur.com")) return { error: "Email must be an @amzur.com address." };
  if (!capacity || capacity <= 0) return { error: "Weekly Capacity is required and must be > 0." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY — cannot create users." };
  }

  const { error } = await admin.from("users").insert({
    full_name,
    email,
    role: role || null,
    weekly_capacity_hrs: capacity,
    is_active,
    employee_id: employee_id || null,
    designation_id: designation_id || null,
  });

  if (error) return { error: mapUserError(error.message, error.code) };

  revalidatePath("/users");
  redirect("/users");
}

// ---------------------------------------------------------------------------
// Update / activate / deactivate — standard RLS Admin write (Spec 03 §4.4).
// Deactivation is pre-checked so we can name blocking projects; the DB trigger
// (migration 0007) is the authoritative guard.
// ---------------------------------------------------------------------------
export async function updateUser(
  userId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  if (!(await callerIsAdmin())) return { error: "Admins only." };

  const full_name = str(form, "full_name");
  const email = str(form, "email").toLowerCase();
  const role = str(form, "role");
  const capacity = Number(str(form, "weekly_capacity_hrs"));
  // Access level is the sole trigger for sign-in/data access — no separate toggle.
  const is_active = !!role;
  const employee_id = str(form, "employee_id");
  const designation_id = str(form, "designation_id");

  if (!full_name) return { error: "Full Name is required." };
  if (!email) return { error: "Email is required." };
  if (!email.endsWith("@amzur.com")) return { error: "Email must be an @amzur.com address." };
  if (!capacity || capacity <= 0) return { error: "Weekly Capacity is required and must be > 0." };

  const supabase = createClient();

  if (!is_active) {
    const { data: blocking } = await supabase
      .from("project")
      .select("project_name")
      .eq("manager_lead_id", userId)
      .eq("is_archived", false);
    if (blocking && blocking.length > 0) {
      return {
        error: `Cannot deactivate: still Manager-Lead on active project(s): ${blocking
          .map((b) => b.project_name)
          .join(", ")}. Reassign these first.`,
      };
    }
  }

  const { error } = await supabase
    .from("users")
    .update({
      full_name,
      email,
      role: role || null,
      weekly_capacity_hrs: capacity,
      is_active,
      employee_id: employee_id || null,
      designation_id: designation_id || null,
    })
    .eq("user_id", userId);

  if (error) return { error: mapUserError(error.message, error.code) };

  revalidatePath("/users");
  redirect("/users");
}

// ---------------------------------------------------------------------------
// Designation lookup management (Admin). RLS (is_admin()) authorizes the writes,
// so the ordinary session client is enough — no service-role needed.
// ---------------------------------------------------------------------------
export async function createDesignation(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!(await callerIsAdmin())) return { error: "Admins only." };
  const label = str(form, "label");
  if (!label) return { error: "Designation is required." };

  const supabase = createClient();
  const { error } = await supabase.from("designation_option").insert({ label });
  if (error) {
    const dup = error.code === "23505" || error.message.toLowerCase().includes("duplicate");
    return { error: dup ? "That designation already exists." : error.message };
  }
  revalidatePath("/users/designations");
  return { ok: true };
}

export async function setDesignationActive(optionId: string, active: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("designation_option")
    .update({ is_active: active })
    .eq("option_id", optionId);
  if (error) throw new Error(error.message);
  revalidatePath("/users/designations");
  revalidatePath("/users");
}
