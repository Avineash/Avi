export type Role = "customer" | "partner" | "admin";

export type Permission =
  | "customer:account" | "customer:book"
  | "partner:portal" | "partner:manage_inventory" | "partner:buyback"
  | "admin:portal" | "admin:partners" | "admin:finance" | "admin:config" | "admin:buyback_approval";

const MATRIX: Record<Role, Permission[]> = {
  customer: ["customer:account", "customer:book"],
  partner: ["partner:portal", "partner:manage_inventory", "partner:buyback"],
  admin: ["admin:portal", "admin:partners", "admin:finance", "admin:config", "admin:buyback_approval", "customer:account"],
};
export const can = (role: Role, perm: Permission) => MATRIX[role]?.includes(perm) ?? false;

/** Which portal prefix a role is allowed to open (used by middleware for a fast first-line check). */
export const PORTAL_PREFIX: Record<string, Role[]> = { "/account": ["customer", "admin"], "/partner": ["partner"], "/admin": ["admin"], "/checkout": ["customer", "admin"], "/pay": ["customer", "admin"], "/sell/new": ["customer", "admin"], "/sell/setup": ["customer", "admin"] };

export function homeFor(role: Role) {
  return role === "admin" ? "/admin" : role === "partner" ? "/partner" : "/account";
}
