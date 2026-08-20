import "server-only";

import { randomUUID } from "node:crypto";

import { SITE_URL } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ParsedShopifyPaidOrder,
  normalizeEmail,
} from "@/lib/shopify/webhook";

type JsonObject = Record<string, unknown>;

type IngestionResult = {
  replayed: boolean;
  order_id: string;
  outcome: "ready" | "ignored" | "manual_review";
  purchaser_email_normalized?: string | null;
};

type ProvisioningResult = {
  action:
    | "confirmed"
    | "invite_sent"
    | "existing_unconfirmed"
    | "busy"
    | "invite";
  auth_user_id?: string;
};

function asObject(value: unknown, operation: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${operation} returned an invalid response`);
  }

  return value as JsonObject;
}

function asIngestionResult(value: unknown): IngestionResult {
  const result = asObject(value, "Shopify ingestion");
  if (
    typeof result.replayed !== "boolean" ||
    typeof result.order_id !== "string" ||
    !["ready", "ignored", "manual_review"].includes(String(result.outcome))
  ) {
    throw new Error("Shopify ingestion returned an invalid response");
  }

  return result as IngestionResult;
}

function asProvisioningResult(value: unknown): ProvisioningResult {
  const result = asObject(value, "Account provisioning");
  if (
    ![
      "confirmed",
      "invite_sent",
      "existing_unconfirmed",
      "busy",
      "invite",
    ].includes(String(result.action))
  ) {
    throw new Error("Account provisioning returned an invalid response");
  }

  return result as ProvisioningResult;
}

async function completeDelivery(shopDomain: string, webhookId: string) {
  const { error } = await supabaseAdmin.rpc("complete_shopify_webhook_delivery", {
    p_shop_domain: shopDomain,
    p_webhook_id: webhookId,
  });
  if (error) {
    throw new Error(`Failed to complete Shopify delivery: ${error.message}`);
  }
}

async function failDelivery(shopDomain: string, webhookId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown provisioning error";
  await supabaseAdmin.rpc("fail_shopify_webhook_delivery", {
    p_shop_domain: shopDomain,
    p_webhook_id: webhookId,
    p_error: message,
  });
}

async function finishInvitation(
  email: string,
  leaseToken: string,
  authUserId: string | null,
  errorMessage: string | null
) {
  const { data, error } = await supabaseAdmin.rpc(
    "finish_account_invitation",
    {
      p_email: email,
      p_lease_token: leaseToken,
      p_auth_user_id: authUserId,
      p_error: errorMessage,
    }
  );
  if (error) {
    throw new Error(`Failed to finalize account invitation: ${error.message}`);
  }
  return data;
}

export type OrderOwnerProvisioningResult = {
  action: ProvisioningResult["action"];
  authUserId: string;
};

export async function provisionOrderOwner(
  emailValue: string
): Promise<OrderOwnerProvisioningResult> {
  const email = normalizeEmail(emailValue);
  if (!email) {
    throw new Error("A valid owner email is required");
  }

  const leaseToken = randomUUID();
  const { data: provisionData, error: provisionError } = await supabaseAdmin.rpc(
    "begin_account_provisioning",
    {
      p_email: email,
      p_lease_token: leaseToken,
      p_lease_seconds: 90,
    }
  );
  if (provisionError) {
    throw new Error(`Failed to begin account provisioning: ${provisionError.message}`);
  }

  const provisioning = asProvisioningResult(provisionData);
  if (provisioning.action === "busy") {
    throw new Error("Account provisioning is currently leased by another request");
  }

  let authUserId = provisioning.auth_user_id;
  if (provisioning.action === "invite") {
    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${SITE_URL}/auth/set-password`,
      });

    if (inviteError || !inviteData.user) {
      const { data: existingData, error: existingError } = await supabaseAdmin.rpc(
        "find_auth_user_by_email",
        { p_email: email }
      );
      const existing = Array.isArray(existingData) ? existingData[0] : null;

      if (!existingError && existing && typeof existing.auth_user_id === "string") {
        const existingAuthUserId = existing.auth_user_id;
        authUserId = existingAuthUserId;
        await finishInvitation(email, leaseToken, existingAuthUserId, null);
      } else {
        const message = inviteError?.message ?? "Invitation did not return a user";
        await finishInvitation(email, leaseToken, null, message);
        throw new Error(`Failed to invite order owner: ${message}`);
      }
    } else {
      authUserId = inviteData.user.id;
      await finishInvitation(email, leaseToken, authUserId, null);
    }
  }

  if (!authUserId) {
    throw new Error("Account provisioning did not return an owner");
  }

  return { action: provisioning.action, authUserId };
}

export async function processShopifyPaidOrder(
  shopDomain: string,
  webhookId: string,
  parsed: ParsedShopifyPaidOrder
): Promise<{ result: string }> {
  const { data, error } = await supabaseAdmin.rpc("ingest_shopify_paid_order", {
    p_shop_domain: shopDomain,
    p_webhook_id: webhookId,
    p_order: parsed.order,
    p_line_items: parsed.lineItems,
  });

  if (error) {
    throw new Error(`Failed to ingest Shopify order: ${error.message}`);
  }

  const ingestion = asIngestionResult(data);

  if (parsed.order.shopify_order_number) {
    const { error: orderNumberError } = await supabaseAdmin
      .from("orders")
      .update({ shopify_order_number: parsed.order.shopify_order_number })
      .eq("id", ingestion.order_id);
    if (orderNumberError) {
      throw new Error("Failed to persist Shopify order number");
    }
  }

  if (ingestion.replayed) {
    return { result: "replayed" };
  }

  if (ingestion.outcome !== "ready") {
    return { result: ingestion.outcome };
  }

  const email = normalizeEmail(parsed.order.purchaser_email_normalized);
  if (!email) {
    throw new Error("Ready Shopify order is missing its normalized email");
  }

  try {
    const provisioning = await provisionOrderOwner(email);

    await completeDelivery(shopDomain, webhookId);
    return { result: provisioning.action === "confirmed" ? "linked" : "provisioned" };
  } catch (provisioningError) {
    await failDelivery(shopDomain, webhookId, provisioningError);
    throw provisioningError;
  }
}

export async function requestOrderOwnerInvitationRecovery(emailValue: string) {
  const email = normalizeEmail(emailValue);
  if (!email) {
    return;
  }

  const { data: allowed, error } = await supabaseAdmin.rpc(
    "begin_invitation_recovery",
    {
      p_email: email,
      p_cooldown_seconds: 300,
    }
  );

  if (error || allowed !== true) {
    return;
  }

  const { error: emailError } = await supabaseAdmin.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${SITE_URL}/auth/set-password`,
    },
  });

  if (emailError) {
    await supabaseAdmin.rpc("fail_invitation_recovery", {
      p_email: email,
    });
    console.error("Failed to send Shopify invitation recovery email", {
      code: emailError.code,
      status: emailError.status,
    });
  }
}
