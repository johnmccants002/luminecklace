"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireAdmin } from "@/lib/admin/auth";
import { MAX_IMPORT_BYTES, parseInventoryImport } from "@/lib/admin/message-import";
import { requestShopifyInvitationRecovery } from "@/lib/shopify/orders";
import { isValidEmail, normalizeEmail } from "@/lib/shopify/webhook";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export async function recoverCustomerInvitation(formData: FormData) {
  const { user } = await requireAdmin();
  const customerId = requiredUuid(formData, "customerId");
  const email = formData.get("email");
  if (!isValidEmail(email)) throw new Error("A valid customer email is required");

  await requestShopifyInvitationRecovery(email);
  await writeAdminAuditLog({
    adminUserId: user.id,
    action: "customer.invitation_recovery_requested",
    resourceType: "customer",
    resourceId: customerId,
  });
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function updateCustomerEmail(formData: FormData) {
  const { user } = await requireAdmin();
  const customerId = requiredUuid(formData, "customerId");
  const email = normalizeEmail(formData.get("email"));
  if (!email) throw new Error("A valid email is required");

  const before = await supabaseAdmin.auth.admin.getUserById(customerId);
  if (before.error || !before.data.user) throw new Error("Customer not found");

  const result = await supabaseAdmin.auth.admin.updateUserById(customerId, { email });
  if (result.error) throw new Error("Unable to update customer email");

  await writeAdminAuditLog({
    adminUserId: user.id,
    action: "customer.email_updated",
    resourceType: "customer",
    resourceId: customerId,
    details: {
      previousEmailDomain: before.data.user.email?.split("@")[1] ?? null,
      newEmailDomain: email.split("@")[1],
    },
  });
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function setCustomerStatus(formData: FormData) {
  const { user } = await requireAdmin();
  const customerId = requiredUuid(formData, "customerId");
  const status = formData.get("status");
  if (status !== "active" && status !== "paused") throw new Error("Invalid account status");

  const authUpdate = await supabaseAdmin.auth.admin.updateUserById(customerId, {
    ban_duration: status === "paused" ? "876000h" : "none",
  });
  if (authUpdate.error) throw new Error("Unable to update Auth account status");

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ account_status: status })
    .eq("id", customerId);
  if (error) {
    await supabaseAdmin.auth.admin.updateUserById(customerId, {
      ban_duration: status === "paused" ? "none" : "876000h",
    });
    throw new Error("Unable to update account status");
  }

  await writeAdminAuditLog({
    adminUserId: user.id,
    action: status === "paused" ? "customer.paused" : "customer.restored",
    resourceType: "customer",
    resourceId: customerId,
    details: { status },
  });
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function unlinkNecklace(formData: FormData) {
  const { user } = await requireAdmin();
  const necklaceId = requiredUuid(formData, "necklaceId");
  const { error } = await supabaseAdmin.rpc("admin_unlink_necklace", {
    p_admin_user_id: user.id,
    p_necklace_id: necklaceId,
  });
  if (error) throw new Error("Unable to unlink necklace");

  await writeAdminAuditLog({
    adminUserId: user.id,
    action: "necklace.unlinked",
    resourceType: "necklace",
    resourceId: necklaceId,
  });
  revalidatePath("/admin/necklaces");
  revalidatePath("/admin/customers");
}

export async function transferNecklace(formData: FormData) {
  const { user } = await requireAdmin();
  const necklaceId = requiredUuid(formData, "necklaceId");
  const customerId = requiredUuid(formData, "customerId");
  const { error } = await supabaseAdmin.rpc("admin_transfer_necklace", {
    p_admin_user_id: user.id,
    p_necklace_id: necklaceId,
    p_customer_id: customerId,
  });
  if (error) throw new Error("Unable to transfer necklace");

  await writeAdminAuditLog({
    adminUserId: user.id,
    action: "necklace.transferred",
    resourceType: "necklace",
    resourceId: necklaceId,
    details: { newCustomerId: customerId },
  });
  revalidatePath("/admin/necklaces");
  revalidatePath("/admin/customers");
}

export async function assignNecklace(formData: FormData) {
  const { user } = await requireAdmin();
  const necklaceId = requiredUuid(formData, "necklaceId");
  const unitId = requiredUuid(formData, "unitId");
  const customerId = requiredUuid(formData, "customerId");
  const { error } = await supabaseAdmin.rpc("admin_assign_necklace", {
    p_admin_user_id: user.id,
    p_necklace_id: necklaceId,
    p_order_item_unit_id: unitId,
    p_customer_id: customerId,
  });
  if (error) throw new Error("Unable to assign necklace to that unit");

  await writeAdminAuditLog({
    adminUserId: user.id,
    action: "necklace.assigned",
    resourceType: "necklace",
    resourceId: necklaceId,
    details: { unitId, customerId },
  });
  revalidatePath("/admin/necklaces");
}

export async function setNecklaceDisabled(formData: FormData) {
  const { user } = await requireAdmin();
  const necklaceId = requiredUuid(formData, "necklaceId");
  const disabled = formData.get("disabled") === "true";
  const { error } = await supabaseAdmin
    .from("necklaces")
    .update({
      inventory_status: disabled ? "disabled" : "unassigned",
      lifecycle_status: disabled ? "inactive" : "pending_sender_setup",
    })
    .eq("id", necklaceId);
  if (error) throw new Error("Unable to update necklace status");

  await writeAdminAuditLog({
    adminUserId: user.id,
    action: disabled ? "necklace.disabled" : "necklace.restored",
    resourceType: "necklace",
    resourceId: necklaceId,
  });
  revalidatePath("/admin/necklaces");
}

export async function createInventoryRecord(formData: FormData) {
  const { user } = await requireAdmin();
  const tagRef = String(formData.get("tagRef") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const tapTokenHash = String(formData.get("tapTokenHash") ?? "").trim();
  if (!tagRef || !sku || tapTokenHash.length < 16) throw new Error("Tag, SKU, and secure token hash are required");

  const { data, error } = await supabaseAdmin
    .from("necklaces")
    .insert({ tag_ref: tagRef, sku, tap_token_hash: tapTokenHash })
    .select("id")
    .single();
  if (error) throw new Error("Unable to create inventory record");

  await writeAdminAuditLog({
    adminUserId: user.id,
    action: "necklace.created",
    resourceType: "necklace",
    resourceId: data.id,
    details: { tagRef, sku },
  });
  redirect("/admin/necklaces?created=1");
}

export async function importInventoryRecords(formData: FormData) {
  const { user } = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("A CSV or JSON file is required");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("File exceeds the 1 MB limit");
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "json") throw new Error("Only CSV and JSON are supported");
  const rows = parseInventoryImport(
    await file.text(),
    extension as "csv" | "json"
  );

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("necklaces")
    .select("tag_ref")
    .in("tag_ref", rows.map((row) => row.tag_ref));
  if (existingError) throw new Error("Unable to validate inventory duplicates");
  const existingRefs = new Set((existing ?? []).map((row) => row.tag_ref));
  const insertRows = rows.filter((row) => !existingRefs.has(row.tag_ref));
  if (insertRows.length) {
    const inserted = await supabaseAdmin.from("necklaces").insert(insertRows);
    if (inserted.error) throw new Error("Inventory import was rejected");
  }

  await writeAdminAuditLog({
    adminUserId: user.id,
    action: "necklace.inventory_imported",
    resourceType: "necklace_import",
    details: {
      totalRows: rows.length,
      insertedRows: insertRows.length,
      skippedDuplicates: rows.length - insertRows.length,
    },
  });
  redirect(
    `/admin/necklaces?imported=${insertRows.length}&skipped=${rows.length - insertRows.length}`
  );
}
