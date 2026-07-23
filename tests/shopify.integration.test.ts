import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !secretKey || !publishableKey) {
  throw new Error("Missing Supabase environment variables for Shopify integration tests");
}

const admin = createClient(supabaseUrl, secretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

function fixtureEmail(label: string) {
  return `shopify-${label}-${randomUUID()}@example.com`;
}

function orderPayload(
  orderId: string,
  email: string | null,
  outcome: "ready" | "ignored" | "manual_review"
) {
  return {
    shopify_order_id: orderId,
    purchaser_email_normalized: email,
    ingestion_outcome: outcome,
    shopify_created_at: "2026-07-22T12:00:00Z",
    shopify_updated_at: "2026-07-22T12:01:00Z",
    processed_at: "2026-07-22T12:01:00Z",
    cancelled_at: null,
    currency: "USD",
    presentment_currency: "USD",
    financial_status: "paid",
    subtotal_price: "85.00",
    current_subtotal_price: "85.00",
    total_discounts: "5.00",
    current_total_discounts: "5.00",
    total_shipping: "0.00",
    current_total_shipping: "0.00",
    total_tax: "6.40",
    current_total_tax: "6.40",
    total_price: "86.40",
    current_total_price: "86.40",
    total_outstanding: "0.00",
  };
}

function linePayload(prefix: string, eligibleQuantity = 2) {
  return [
    {
      shopify_line_item_id: `${prefix}01`,
      shopify_product_id: `${prefix}11`,
      shopify_variant_id: `${prefix}21`,
      sku: "LUMI-TEST",
      title: "Lumi test necklace",
      quantity: eligibleQuantity,
      current_quantity: eligibleQuantity,
      unit_price: "40.00",
      total_discount: "5.00",
      is_lumi_eligible: true,
    },
    {
      shopify_line_item_id: `${prefix}02`,
      shopify_product_id: `${prefix}12`,
      shopify_variant_id: `${prefix}22`,
      sku: "GIFT-WRAP",
      title: "Gift wrap",
      quantity: 1,
      current_quantity: 1,
      unit_price: "5.00",
      total_discount: "0.00",
      is_lumi_eligible: false,
    },
  ];
}

test("Shopify ingestion migration enforces units, identity, leases, and recovery", async (t) => {
  const schemaProbe = await admin.from("order_item_units").select("id").limit(1);
  if (schemaProbe.error?.code === "42P01" || schemaProbe.error?.code === "PGRST205") {
    t.skip("Shopify migration is not applied to the configured Supabase project");
    return;
  }
  assert.ifError(schemaProbe.error);

  const shopDomain = "integration-test.myshopify.com";
  const confirmedEmail = fixtureEmail("confirmed");
  const unconfirmedEmail = fixtureEmail("unconfirmed");
  const invitedEmail = fixtureEmail("invited");
  const leaseEmail = fixtureEmail("lease");
  const password = `ShopifyTest!${randomUUID()}`;
  const provisioningEmails = [
    confirmedEmail,
    unconfirmedEmail,
    invitedEmail,
    leaseEmail,
  ];
  const authUserIds: string[] = [];

  async function ingest(
    shopifyOrderId: string,
    webhookId: string,
    email: string | null,
    outcome: "ready" | "ignored" | "manual_review",
    lines = linePayload(shopifyOrderId.slice(-6))
  ) {
    const result = await admin.rpc("ingest_shopify_paid_order", {
      p_shop_domain: shopDomain,
      p_webhook_id: webhookId,
      p_order: orderPayload(shopifyOrderId, email, outcome),
      p_line_items: lines,
    });
    assert.ifError(result.error);
    const data = result.data as {
      order_id: string;
      outcome: string;
      replayed: boolean;
    };
    return data;
  }

  try {
    const confirmed = await admin.auth.admin.createUser({
      email: confirmedEmail,
      password,
      email_confirm: true,
    });
    assert.ifError(confirmed.error);
    assert.ok(confirmed.data.user);
    authUserIds.push(confirmed.data.user.id);

    const shopifyOrderId = `900${Date.now()}`;
    const firstWebhook = randomUUID();
    const secondWebhook = randomUUID();
    const [first, sameOrder] = await Promise.all([
      ingest(shopifyOrderId, firstWebhook, confirmedEmail.toUpperCase(), "ready"),
      ingest(shopifyOrderId, secondWebhook, confirmedEmail, "ready"),
    ]);
    assert.equal(first.order_id, sameOrder.order_id);

    const orderRows = await admin
      .from("orders")
      .select(
        "id, purchaser_auth_user_id, currency, total_price, current_total_price, ingestion_outcome"
      )
      .eq("shop_domain", shopDomain)
      .eq("shopify_order_id", shopifyOrderId);
    assert.ifError(orderRows.error);
    assert.equal(orderRows.data.length, 1);
    assert.equal(orderRows.data[0].currency, "USD");
    assert.equal(orderRows.data[0].total_price, 86.4);

    const items = await admin
      .from("order_items")
      .select("id, quantity, is_lumi_eligible")
      .eq("order_id", first.order_id);
    assert.ifError(items.error);
    assert.equal(items.data.length, 2);

    const eligibleItem = items.data.find((item) => item.is_lumi_eligible);
    assert.ok(eligibleItem);
    const units = await admin
      .from("order_item_units")
      .select("*")
      .eq("order_item_id", eligibleItem.id)
      .order("unit_ordinal");
    assert.ifError(units.error);
    assert.deepEqual(
      units.data.map((unit) => [unit.unit_ordinal, unit.allocation_status]),
      [
        [1, "awaiting_necklace"],
        [2, "awaiting_necklace"],
      ]
    );
    assert.equal("necklace_id" in units.data[0], false);

    const confirmedProvision = await admin.rpc(
      "begin_shopify_account_provisioning",
      {
        p_email: confirmedEmail.toUpperCase(),
        p_lease_token: randomUUID(),
        p_lease_seconds: 90,
      }
    );
    assert.ifError(confirmedProvision.error);
    assert.equal(
      (confirmedProvision.data as { action: string }).action,
      "confirmed"
    );
    for (const webhookId of [firstWebhook, secondWebhook]) {
      const completed = await admin.rpc("complete_shopify_webhook_delivery", {
        p_shop_domain: shopDomain,
        p_webhook_id: webhookId,
      });
      assert.ifError(completed.error);
    }
    const replay = await ingest(
      shopifyOrderId,
      firstWebhook,
      confirmedEmail,
      "ready"
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.order_id, first.order_id);

    const linkedOrder = await admin
      .from("orders")
      .select("purchaser_auth_user_id")
      .eq("id", first.order_id)
      .single();
    assert.ifError(linkedOrder.error);
    assert.equal(linkedOrder.data.purchaser_auth_user_id, confirmed.data.user.id);

    const signedIn = await createClient(supabaseUrl, publishableKey).auth.signInWithPassword({
      email: confirmedEmail,
      password,
    });
    assert.ifError(signedIn.error);
    assert.ok(signedIn.data.session);
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: {
        headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` },
      },
    });
    const profileTamper = await userClient
      .from("profiles")
      .update({ email: fixtureEmail("attacker") })
      .eq("id", confirmed.data.user.id);
    assert.ok(profileTamper.error, "authenticated clients must not update profile email");

    const unconfirmed = await admin.auth.admin.createUser({
      email: unconfirmedEmail,
      password,
      email_confirm: false,
    });
    assert.ifError(unconfirmed.error);
    assert.ok(unconfirmed.data.user);
    authUserIds.push(unconfirmed.data.user.id);
    await ingest(
      `901${Date.now()}`,
      randomUUID(),
      unconfirmedEmail,
      "ready"
    );
    const unconfirmedProvision = await admin.rpc(
      "begin_shopify_account_provisioning",
      {
        p_email: unconfirmedEmail,
        p_lease_token: randomUUID(),
        p_lease_seconds: 90,
      }
    );
    assert.ifError(unconfirmedProvision.error);
    assert.equal(
      (unconfirmedProvision.data as { action: string }).action,
      "existing_unconfirmed"
    );

    const generatedInvite = await admin.auth.admin.generateLink({
      type: "invite",
      email: invitedEmail,
      options: { redirectTo: "https://example.com/auth/set-password" },
    });
    assert.ifError(generatedInvite.error);
    assert.ok(generatedInvite.data.user);
    authUserIds.push(generatedInvite.data.user.id);
    const invitedProvision = await admin.rpc(
      "begin_shopify_account_provisioning",
      {
        p_email: invitedEmail,
        p_lease_token: randomUUID(),
        p_lease_seconds: 90,
      }
    );
    assert.ifError(invitedProvision.error);
    assert.equal(
      (invitedProvision.data as { action: string }).action,
      "invite_sent"
    );

    const firstLease = randomUUID();
    const secondLease = randomUUID();
    const leaseWinner = await admin.rpc("begin_shopify_account_provisioning", {
      p_email: leaseEmail,
      p_lease_token: firstLease,
      p_lease_seconds: 90,
    });
    assert.ifError(leaseWinner.error);
    assert.equal((leaseWinner.data as { action: string }).action, "invite");
    const leaseLoser = await admin.rpc("begin_shopify_account_provisioning", {
      p_email: leaseEmail.toUpperCase(),
      p_lease_token: secondLease,
      p_lease_seconds: 90,
    });
    assert.ifError(leaseLoser.error);
    assert.equal((leaseLoser.data as { action: string }).action, "busy");

    const expireLease = await admin
      .from("account_provisioning")
      .update({ lease_expires_at: "2000-01-01T00:00:00Z" })
      .eq("email_normalized", leaseEmail);
    assert.ifError(expireLease.error);
    const reclaimed = await admin.rpc("begin_shopify_account_provisioning", {
      p_email: leaseEmail,
      p_lease_token: secondLease,
      p_lease_seconds: 90,
    });
    assert.ifError(reclaimed.error);
    assert.equal((reclaimed.data as { action: string }).action, "invite");

    const manual = await ingest(
      `902${Date.now()}`,
      randomUUID(),
      null,
      "manual_review"
    );
    assert.equal(manual.outcome, "manual_review");
    const ignored = await ingest(
      `903${Date.now()}`,
      randomUUID(),
      fixtureEmail("ignored"),
      "ignored",
      [
        {
          ...linePayload("903999")[1],
          shopify_line_item_id: `904${Date.now()}`,
        },
      ]
    );
    assert.equal(ignored.outcome, "ignored");
  } finally {
    await admin
      .from("shopify_webhook_deliveries")
      .delete()
      .eq("shop_domain", shopDomain);
    await admin.from("orders").delete().eq("shop_domain", shopDomain);
    await admin
      .from("account_provisioning")
      .delete()
      .in("email_normalized", provisioningEmails);
    for (const userId of authUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
