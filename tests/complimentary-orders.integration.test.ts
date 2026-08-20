import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const testAdminUserId = process.env.COMPLIMENTARY_TEST_ADMIN_USER_ID;

if (!supabaseUrl || !secretKey) {
  throw new Error(
    "Missing Supabase environment variables for complimentary-order integration tests"
  );
}

const admin = createClient(supabaseUrl, secretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

function fixtureEmail(label: string) {
  return `complimentary-${label}-${randomUUID()}@example.com`;
}

test("complimentary orders are idempotent, owner-linked, allocatable, and safely cancellable", async (t) => {
  const schemaProbe = await admin
    .from("orders")
    .select("id, order_source, production_state")
    .limit(1);
  if (
    schemaProbe.error?.code === "42703" ||
    schemaProbe.error?.code === "PGRST204" ||
    schemaProbe.error?.code === "PGRST205"
  ) {
    t.skip("Complimentary-order migration is not applied to the configured project");
    return;
  }
  assert.ifError(schemaProbe.error);

  const friendEmail = fixtureEmail("friend");
  const idempotencyKey = randomUUID();
  if (!testAdminUserId) {
    t.skip(
      "Set COMPLIMENTARY_TEST_ADMIN_USER_ID to a super_admin in a disposable test project"
    );
    return;
  }
  const adminRole = await admin
    .from("admin_user_roles")
    .select("role")
    .eq("user_id", testAdminUserId)
    .eq("role", "super_admin")
    .maybeSingle();
  assert.ifError(adminRole.error);
  if (!adminRole.data) {
    t.skip("COMPLIMENTARY_TEST_ADMIN_USER_ID is not a super_admin");
    return;
  }

  const adminUserId = testAdminUserId;
  let friendUserId: string | null = null;
  let orderId: string | null = null;
  let necklaceId: string | null = null;

  try {
    const friendInvite = await admin.auth.admin.generateLink({
      type: "invite",
      email: friendEmail,
      options: { redirectTo: "https://example.com/auth/set-password" },
    });
    assert.ifError(friendInvite.error);
    assert.ok(friendInvite.data.user);
    friendUserId = friendInvite.data.user.id;

    const creationArgs = {
      p_admin_user_id: adminUserId,
      p_idempotency_key: idempotencyKey,
      p_purchaser_email: friendEmail,
      p_purchaser_name: "Integration Friend",
      p_sku: "LUMI-TEST",
      p_quantity: 2,
      p_internal_note: "Integration-only complimentary order",
    };
    const first = await admin.rpc(
      "admin_create_complimentary_order",
      creationArgs
    );
    assert.ifError(first.error);
    const firstData = first.data as {
      replayed: boolean;
      order_id: string;
      factory_reference: string;
    };
    orderId = firstData.order_id;
    assert.equal(firstData.replayed, false);
    assert.match(firstData.factory_reference, /^GIFT-\d{6}$/);

    const replay = await admin.rpc(
      "admin_create_complimentary_order",
      creationArgs
    );
    assert.ifError(replay.error);
    assert.equal((replay.data as { replayed: boolean }).replayed, true);
    assert.equal((replay.data as { order_id: string }).order_id, orderId);
    const conflictingReplay = await admin.rpc(
      "admin_create_complimentary_order",
      { ...creationArgs, p_quantity: 3 }
    );
    assert.ok(conflictingReplay.error);

    const items = await admin
      .from("order_items")
      .select("id")
      .eq("order_id", orderId);
    assert.ifError(items.error);
    assert.equal(items.data.length, 1);
    const units = await admin
      .from("order_item_units")
      .select("id, allocation_status")
      .eq("order_item_id", items.data[0].id)
      .order("unit_ordinal");
    assert.ifError(units.error);
    assert.equal(units.data.length, 2);

    const provisioning = await admin.rpc("begin_account_provisioning", {
      p_email: friendEmail,
      p_lease_token: randomUUID(),
      p_lease_seconds: 90,
    });
    assert.ifError(provisioning.error);
    assert.equal(
      (provisioning.data as { action: string; auth_user_id: string }).action,
      "invite_sent"
    );
    assert.equal(
      (provisioning.data as { auth_user_id: string }).auth_user_id,
      friendUserId
    );

    const finalize = await admin.rpc("admin_finalize_complimentary_order", {
      p_admin_user_id: adminUserId,
      p_order_id: orderId,
      p_owner_user_id: friendUserId,
    });
    assert.ifError(finalize.error);
    const queued = await admin
      .from("orders")
      .select("order_source, production_state, purchaser_auth_user_id")
      .eq("id", orderId)
      .single();
    assert.ifError(queued.error);
    assert.deepEqual(queued.data, {
      order_source: "complimentary",
      production_state: "queued",
      purchaser_auth_user_id: friendUserId,
    });

    const nonAdminAttempt = await admin.rpc(
      "admin_create_complimentary_order",
      {
        ...creationArgs,
        p_admin_user_id: friendUserId,
        p_idempotency_key: randomUUID(),
      }
    );
    assert.ok(nonAdminAttempt.error);

    const tagRef = `complimentary-${randomUUID()}`;
    const necklace = await admin
      .from("necklaces")
      .insert({
        tag_ref: tagRef,
        sku: "LUMI-TEST",
        tap_token_hash: createHash("sha256").update(tagRef).digest("hex"),
      })
      .select("id")
      .single();
    assert.ifError(necklace.error);
    necklaceId = necklace.data.id;

    const assignment = await admin.rpc("admin_assign_necklace", {
      p_admin_user_id: adminUserId,
      p_necklace_id: necklaceId,
      p_order_item_unit_id: units.data[0].id,
      p_customer_id: friendUserId,
    });
    assert.ifError(assignment.error);
    const ownership = await admin
      .from("necklace_ownerships")
      .select("sender_user_id, source_order_id")
      .eq("necklace_id", necklaceId)
      .single();
    assert.ifError(ownership.error);
    assert.deepEqual(ownership.data, {
      sender_user_id: friendUserId,
      source_order_id: orderId,
    });

    const blockedCancellation = await admin.rpc(
      "admin_cancel_complimentary_order",
      {
        p_admin_user_id: adminUserId,
        p_order_id: orderId,
      }
    );
    assert.ok(blockedCancellation.error);

    const unlink = await admin.rpc("admin_unlink_necklace", {
      p_admin_user_id: adminUserId,
      p_necklace_id: necklaceId,
    });
    assert.ifError(unlink.error);
    const cancellation = await admin.rpc("admin_cancel_complimentary_order", {
      p_admin_user_id: adminUserId,
      p_order_id: orderId,
    });
    assert.ifError(cancellation.error);
    const cancelled = await admin
      .from("orders")
      .select("production_state, cancelled_at")
      .eq("id", orderId)
      .single();
    assert.ifError(cancelled.error);
    assert.equal(cancelled.data.production_state, "cancelled");
    assert.ok(cancelled.data.cancelled_at);

    const audits = await admin
      .from("admin_audit_logs")
      .select("action")
      .eq("resource_id", orderId);
    assert.ifError(audits.error);
    assert.deepEqual(
      new Set(audits.data.map((entry) => entry.action)),
      new Set([
        "complimentary_order.created",
        "complimentary_order.queued",
        "complimentary_order.cancelled",
      ])
    );
  } finally {
    if (necklaceId) {
      await admin.from("necklace_ownerships").delete().eq("necklace_id", necklaceId);
      await admin.from("necklaces").delete().eq("id", necklaceId);
    }
    if (orderId) await admin.from("orders").delete().eq("id", orderId);
    await admin
      .from("account_provisioning")
      .delete()
      .eq("email_normalized", friendEmail);
    if (friendUserId) await admin.auth.admin.deleteUser(friendUserId);
  }
});
