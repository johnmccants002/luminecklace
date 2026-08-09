import "server-only";

import { AdminAuthError, requireAdmin } from "@/lib/admin/auth";
import { FactoryApiError } from "@/lib/factory/validation";

export async function authorizeFactoryRequest(req: Request) {
  try {
    return await requireAdmin(req, ["super_admin"]);
  } catch (error) {
    if (error instanceof AdminAuthError) {
      throw new FactoryApiError(error.message, error.status);
    }
    throw error;
  }
}
