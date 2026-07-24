import type { AppRole } from "@/lib/auth-context";

/**
 * Role capabilities are deliberately kept in one place. UI visibility is not
 * a security boundary (RLS/RPCs enforce that), but it must match it exactly.
 */
export function isOperationalManager(role: AppRole | null) {
  return role === "admin" || role === "technical_office";
}

export function canManageProjects(role: AppRole | null) {
  return isOperationalManager(role);
}

export function canManageCustomers(role: AppRole | null) {
  return isOperationalManager(role);
}

export function canManageStock(role: AppRole | null) {
  return isOperationalManager(role);
}

export function canManageContractors(role: AppRole | null) {
  return isOperationalManager(role);
}

export function canSeeFinancials(role: AppRole | null) {
  return role === "admin";
}
