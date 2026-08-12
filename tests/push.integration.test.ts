import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  DELETE as deleteDevice,
  PUT as putDevice,
} from "../app/api/push/devices/route";
import {
  GET as getPreferences,
  PATCH as patchPreferences,
} from "../app/api/push/preferences/route";
import { setLumiReaction, submitLumiResponse } from "../lib/tap/feedback";
import {
  confirmRecipientReveal,
  resolveNextRecipientTap,
} from "../lib/tap/recipient";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("Push integration tests require Supabase environment variables");
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isMissingSchema(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("does not exist") || normalized.includes("schema cache");
}

async function hasPushSchema() {
  const { error } = await admin.from("push_devices").select("id").limit(1);
  if (!error) return true;
  if (isMissingSchema(error.message)) return false;
  throw new Error(`Unable to inspect push schema: ${error.message}`);
}

const pushSchemaReady = hasPushSchema();

async function createUser() {
  const email = `push-${Date.now()}-${randomUUID()}@example.com`;
  const password = `PushPass!${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error("Unable to create push test user");
  return { id: data.user.id, email, password };
}

async function accessToken(user: { email: string; password: string }) {
  const authClient = createClient(SUPABASE_URL!, SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword(user);
  if (error || !data.session) throw new Error("Unable to sign in push test user");
  return data.session.access_token;
}

function jsonRequest(url: string, method: string, token: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("device ownership, idempotency, deletion, and preferences are enforced", async () => {
  if (!(await pushSchemaReady)) {
    console.log("[push] migration not found; skipping live integration assertions.");
    return;
  }
  const first = await createUser();
  const second = await createUser();
  const token = "ab".repeat(32);

  try {
    const [firstAccessToken, secondAccessToken] = await Promise.all([
      accessToken(first),
      accessToken(second),
    ]);
    const body = {
      deviceToken: token,
      environment: "sandbox",
      bundleId: "luminecklace.luminecklace",
      appVersion: "1.0",
      deviceModel: "iPhone",
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await putDevice(
        jsonRequest(
          "http://localhost/api/push/devices",
          "PUT",
          firstAccessToken,
          body
        )
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    }
    let stored = await admin
      .from("push_devices")
      .select("user_id, is_active")
      .eq("device_token", token);
    assert.ifError(stored.error);
    assert.deepEqual(stored.data, [{ user_id: first.id, is_active: true }]);

    assert.equal(
      (
        await putDevice(
          jsonRequest(
            "http://localhost/api/push/devices",
            "PUT",
            secondAccessToken,
            body
          )
        )
      ).status,
      200
    );
    stored = await admin
      .from("push_devices")
      .select("user_id, is_active")
      .eq("device_token", token);
    assert.deepEqual(stored.data, [{ user_id: second.id, is_active: true }]);

    const firstDelete = await deleteDevice(
      jsonRequest(
        "http://localhost/api/push/devices",
        "DELETE",
        firstAccessToken,
        {
          deviceToken: token,
          environment: "sandbox",
          bundleId: "luminecklace.luminecklace",
        }
      )
    );
    assert.equal(firstDelete.status, 200);
    assert.deepEqual(await firstDelete.json(), { ok: true });
    stored = await admin
      .from("push_devices")
      .select("user_id, is_active")
      .eq("device_token", token);
    assert.deepEqual(stored.data, [{ user_id: second.id, is_active: true }]);

    const defaults = await getPreferences(
      jsonRequest(
        "http://localhost/api/push/preferences",
        "GET",
        firstAccessToken
      )
    );
    assert.deepEqual(await defaults.json(), {
      revealsEnabled: true,
      reactionsEnabled: true,
      responsesEnabled: true,
    });
    const updated = await patchPreferences(
      jsonRequest(
        "http://localhost/api/push/preferences",
        "PATCH",
        firstAccessToken,
        {
          revealsEnabled: true,
          reactionsEnabled: true,
          responsesEnabled: false,
        }
      )
    );
    assert.deepEqual(await updated.json(), {
      revealsEnabled: true,
      reactionsEnabled: true,
      responsesEnabled: false,
    });

    const secondDelete = await deleteDevice(
      jsonRequest(
        "http://localhost/api/push/devices",
        "DELETE",
        secondAccessToken,
        {
          deviceToken: token,
          environment: "sandbox",
          bundleId: "luminecklace.luminecklace",
        }
      )
    );
    assert.equal(secondDelete.status, 200);
    assert.deepEqual(await secondDelete.json(), { ok: true });
    stored = await admin
      .from("push_devices")
      .select("user_id, is_active")
      .eq("device_token", token);
    assert.deepEqual(stored.data, [{ user_id: second.id, is_active: false }]);
  } finally {
    await admin.auth.admin.deleteUser(first.id);
    await admin.auth.admin.deleteUser(second.id);
  }
});

test("recipient RPC mutations create one safe event and preference-aware delivery", async () => {
  if (!(await pushSchemaReady)) return;
  const user = await createUser();
  const rawTapToken = `push-tap-${randomUUID()}`;
  let necklaceId: string | null = null;

  try {
    const necklace = await admin
      .from("necklaces")
      .insert({
        tag_ref: `push-tag-${randomUUID()}`,
        tap_token_hash: createHash("sha256").update(rawTapToken).digest("hex"),
        sku: "HEART-01",
        name: "Push Test Necklace",
        theme_key: "heart",
        lifecycle_status: "active",
      })
      .select("id")
      .single();
    assert.ifError(necklace.error);
    necklaceId = necklace.data.id;
    assert.ifError(
      (
        await admin.from("necklace_ownerships").insert({
          necklace_id: necklaceId,
          sender_user_id: user.id,
          is_primary: true,
        })
      ).error
    );
    assert.ifError(
      (
        await admin.from("necklace_lumis").insert({
          necklace_id: necklaceId,
          author_user_id: user.id,
          content: "Sensitive Lumi text must never enter a push.",
          queue_position: 1,
          queue_section: "current",
          is_enabled: true,
          theme_key: "heart",
          animation_key: "breathe",
          sound_key: "soft",
          background_key: "heart",
          font_key: "serif",
          text_size_key: "medium",
          text_alignment_key: "center",
          text_position_key: "center",
        })
      ).error
    );
    assert.ifError(
      (
        await admin.from("push_devices").insert({
          user_id: user.id,
          device_token: "cd".repeat(32),
          bundle_id: "luminecklace.luminecklace",
          apns_environment: "sandbox",
        })
      ).error
    );
    assert.ifError(
      (
        await admin.rpc("set_push_preferences", {
          p_user_id: user.id,
          p_responses_enabled: false,
        })
      ).error
    );

    const resolved = await resolveNextRecipientTap(
      admin,
      createHash("sha256").update(rawTapToken).digest("hex")
    );
    assert.equal(resolved.status, "ready");
    if (resolved.status !== "ready") return;

    assert.equal(
      (await confirmRecipientReveal(admin, resolved.revealSessionId)).status,
      "revealed"
    );
    assert.equal(
      (await confirmRecipientReveal(admin, resolved.revealSessionId)).status,
      "revealed"
    );
    assert.equal(
      (await setLumiReaction(admin, resolved.revealSessionId, "heart")).status,
      "reacted"
    );
    assert.equal(
      (await setLumiReaction(admin, resolved.revealSessionId, "touched")).status,
      "reacted"
    );
    assert.equal(
      (
        await submitLumiResponse(
          admin,
          resolved.revealSessionId,
          "Sensitive written response."
        )
      ).status,
      "responded"
    );

    const events = await admin
      .from("push_events")
      .select("id, event_type, payload")
      .eq("reveal_session_id", resolved.revealSessionId)
      .order("event_type");
    assert.ifError(events.error);
    assert.deepEqual(
      events.data.map((event) => event.event_type),
      ["lumi.reacted", "lumi.responded", "lumi.revealed"]
    );
    assert.equal(
      JSON.stringify(events.data).includes("Sensitive Lumi text"),
      false
    );
    assert.equal(
      JSON.stringify(events.data).includes("Sensitive written response"),
      false
    );

    const deliveries = await admin
      .from("push_deliveries")
      .select("event_id")
      .in("event_id", events.data.map((event) => event.id));
    assert.ifError(deliveries.error);
    const deliveredEventIds = new Set(deliveries.data.map((row) => row.event_id));
    assert.equal(deliveredEventIds.size, 2);
    assert.equal(
      deliveredEventIds.has(
        events.data.find((event) => event.event_type === "lumi.responded")!.id
      ),
      false
    );
  } finally {
    if (necklaceId) await admin.from("necklaces").delete().eq("id", necklaceId);
    await admin.auth.admin.deleteUser(user.id);
  }
});
