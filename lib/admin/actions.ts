"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireAdmin } from "@/lib/admin/auth";
import {
  categoryKeyFromName,
  parseCatalogMessageForm,
} from "@/lib/admin/message-catalog";
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

export type CatalogMessageActionState = {
  ok: boolean;
  error: string;
  savedId?: string;
};

export async function saveCatalogMessage(
  _previousState: CatalogMessageActionState,
  formData: FormData
): Promise<CatalogMessageActionState> {
  try {
    const { user } = await requireAdmin();
    const input = parseCatalogMessageForm(formData);
    let category = input.category;
    let createdCategory: { key: string; name: string } | null = null;
    if (input.newCategoryName) {
      category = categoryKeyFromName(input.newCategoryName);
      const existingCategory = await supabaseAdmin
        .from("message_categories")
        .select("key, name, is_active")
        .eq("key", category)
        .maybeSingle();
      if (existingCategory.error) {
        return { ok: false, error: "Unable to check the new category" };
      }
      if (existingCategory.data) {
        if (!existingCategory.data.is_active) {
          return { ok: false, error: "That category is inactive" };
        }
        category = existingCategory.data.key;
      } else {
        const lastCategory = await supabaseAdmin
          .from("message_categories")
          .select("sort_order")
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastCategory.error) {
          return { ok: false, error: "Unable to create the category" };
        }
        const insertedCategory = await supabaseAdmin
          .from("message_categories")
          .insert({
            key: category,
            name: input.newCategoryName,
            sort_order: (lastCategory.data?.sort_order ?? 0) + 1,
            created_by: user.id,
          })
          .select("key, name")
          .single();
        if (insertedCategory.error) {
          return {
            ok: false,
            error:
              insertedCategory.error.code === "23505"
                ? "A category with that name already exists"
                : "Unable to create the category",
          };
        }
        createdCategory = insertedCategory.data;
      }
    } else {
      const existingCategory = await supabaseAdmin
        .from("message_categories")
        .select("key")
        .eq("key", category)
        .eq("is_active", true)
        .maybeSingle();
      if (existingCategory.error || !existingCategory.data) {
        return { ok: false, error: "Choose an active message category" };
      }
    }
    const idValue = formData.get("id");
    const id =
      typeof idValue === "string" && idValue
        ? requiredUuid(formData, "id")
        : null;
    const payload = {
      package_id: "heart-core",
      import_key: input.importKey,
      title: input.title,
      text: input.text,
      content: input.text,
      category,
      tone: input.tone,
      state: input.isActive
        ? input.isExplorePublished
          ? "published"
          : "draft"
        : "archived",
      is_active: input.isActive,
      is_explore_published: input.isExplorePublished,
      explore_sort_order: input.exploreSortOrder,
      is_reserve_eligible: input.isReserveEligible,
      reserve_default_approved: input.reserveDefaultApproved,
      reserve_sort_order: input.isReserveEligible
        ? input.reserveSortOrder
        : null,
      theme_key: input.backgroundKey,
      animation_key: input.animationKey,
      sound_key: input.soundKey,
      background_key: input.backgroundKey,
      font_key: input.fontKey,
      text_size_key: input.textSizeKey,
      text_alignment_key: input.textAlignmentKey,
      text_position_key: input.textPositionKey,
      necklace_id: null,
      author_user_id: null,
    };

    let savedId: string;
    if (id) {
      const before = await supabaseAdmin
        .from("messages")
        .select("id, category, is_active, is_explore_published, is_reserve_eligible")
        .eq("id", id)
        .is("necklace_id", null)
        .is("author_user_id", null)
        .maybeSingle();
      if (before.error || !before.data) {
        return { ok: false, error: "Catalog message not found" };
      }
      const updated = await supabaseAdmin
        .from("messages")
        .update(payload)
        .eq("id", id)
        .is("necklace_id", null)
        .is("author_user_id", null)
        .select("id")
        .single();
      if (updated.error) {
        return {
          ok: false,
          error:
            updated.error.code === "23505"
              ? "That import key or Reserve order is already in use"
              : "Unable to update the catalog message",
        };
      }
      savedId = updated.data.id;
      await writeAdminAuditLog({
        adminUserId: user.id,
        action: "message_catalog.updated",
        resourceType: "message",
        resourceId: savedId,
        details: {
          before: before.data,
          after: {
            category,
            isActive: input.isActive,
            isExplorePublished: input.isExplorePublished,
            isReserveEligible: input.isReserveEligible,
          },
        },
      });
    } else {
      const inserted = await supabaseAdmin
        .from("messages")
        .insert(payload)
        .select("id")
        .single();
      if (inserted.error) {
        return {
          ok: false,
          error:
            inserted.error.code === "23505"
              ? "That import key or Reserve order is already in use"
              : "Unable to create the catalog message",
        };
      }
      savedId = inserted.data.id;
      await writeAdminAuditLog({
        adminUserId: user.id,
        action: "message_catalog.created",
        resourceType: "message",
        resourceId: savedId,
        details: {
          category,
          isExplorePublished: input.isExplorePublished,
          isReserveEligible: input.isReserveEligible,
        },
      });
    }

    if (createdCategory) {
      await writeAdminAuditLog({
        adminUserId: user.id,
        action: "message_category.created",
        resourceType: "message_category",
        resourceId: createdCategory.key,
        details: { name: createdCategory.name },
      });
    }

    revalidatePath("/admin/messages");
    revalidatePath("/admin/imports/messages");
    return { ok: true, error: "", savedId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save message",
    };
  }
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
