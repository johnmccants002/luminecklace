import "server-only";

import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";

type AuditEntry = {
  adminUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  correlationId?: string;
};

const BLOCKED_DETAIL_KEYS = /password|token|secret|payload|message_body/i;

function sanitizeDetails(details: Record<string, unknown> = {}) {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !BLOCKED_DETAIL_KEYS.test(key))
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, 500) : value,
      ])
  );
}

export async function writeAdminAuditLog(entry: AuditEntry) {
  const { error } = await supabaseAdmin.from("admin_audit_logs").insert({
    admin_user_id: entry.adminUserId,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId ?? null,
    details: sanitizeDetails(entry.details),
    correlation_id: entry.correlationId ?? randomUUID(),
  });

  if (error) {
    throw new Error("The operation completed but its audit record could not be saved");
  }
}

