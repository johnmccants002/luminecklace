export const ADMIN_ROLES = ["support", "content_admin", "super_admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export function hasAdminPermission(
  role: AdminRole,
  allowedRoles: readonly AdminRole[]
) {
  return allowedRoles.includes(role);
}

