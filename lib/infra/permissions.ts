import type { UserRole } from "@/lib/types";

export function canManageInfra(profile: { role: UserRole | null }): boolean {
  return profile.role === "Admin" || profile.role === "InfraOps";
}

export function isAdminRole(profile: { role: UserRole | null }): boolean {
  return profile.role === "Admin";
}

/** InfraOps lands on InfraSpecs, not the PM project dashboard. */
export function isInfraOpsRole(profile: { role: UserRole | null }): boolean {
  return profile.role === "InfraOps";
}
