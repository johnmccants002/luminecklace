import "server-only";

import type { User } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth/requireUser";
import {
  ADMIN_ROLES,
  hasAdminPermission,
  type AdminRole,
} from "@/lib/admin/permissions";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class AdminAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403
  ) {
    super(message);
  }
}

export async function requireAdmin(
  req?: Request,
  allowedRoles: readonly AdminRole[] = ["super_admin"]
): Promise<{ user: User; role: AdminRole }> {
  let user: User;
  try {
    ({ user } = await requireUser(req));
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      throw new AdminAuthError("Authentication required", 401);
    }
    throw error;
  }

  const { data, error } = await supabaseAdmin
    .from("admin_user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to verify administrator access");
  }
  if (!data || !ADMIN_ROLES.includes(data.role as AdminRole)) {
    throw new AdminAuthError("Administrator access required", 403);
  }

  const role = data.role as AdminRole;
  if (!hasAdminPermission(role, allowedRoles)) {
    throw new AdminAuthError("Insufficient administrator permission", 403);
  }

  return { user, role };
}
