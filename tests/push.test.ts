import assert from "node:assert/strict";
import test from "node:test";

import { GET as getCron, isAuthorizedCronRequest } from "../app/api/cron/push/route";
import { PUT as putDevice } from "../app/api/push/devices/route";
import { dispatchPushDeliveries } from "../lib/push/dispatcher";
import { buildApnsPayload, parsePushEventPayload } from "../lib/push/payloads";
import {
  parseDeletePushDevice,
  parsePushPreferences,
  parseRegisterPushDevice,
  PushValidationError,
} from "../lib/push/validation";

const UUIDS = {
  delivery: "00000000-0000-4000-8000-000000000001",
  claim: "00000000-0000-4000-8000-000000000002",
  necklace: "00000000-0000-4000-8000-000000000003",
  lumi: "00000000-0000-4000-8000-000000000004",
  reveal: "00000000-0000-4000-8000-000000000005",
};

const TOKEN = "ab".repeat(32);

test("device registration requires bearer authentication", async () => {
  const response = await putDevice(
    new Request("http://localhost/api/push/devices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceToken: TOKEN,
        environment: "sandbox",
        bundleId: "luminecklace.luminecklace",
      }),
    })
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("device registration strictly validates and normalizes input", () => {
  assert.equal(
    parseRegisterPushDevice({
      deviceToken: TOKEN.toUpperCase(),
      environment: "sandbox",
      bundleId: "luminecklace.luminecklace",
      appVersion: " 1.0 ",
      deviceModel: " iPhone ",
    }).deviceToken,
    TOKEN
  );

  for (const invalid of [
    { deviceToken: "xyz", environment: "sandbox", bundleId: "luminecklace.luminecklace" },
    { deviceToken: TOKEN, environment: "staging", bundleId: "luminecklace.luminecklace" },
    { deviceToken: TOKEN, environment: "sandbox", bundleId: "wrong.bundle" },
    {
      deviceToken: TOKEN,
      environment: "sandbox",
      bundleId: "luminecklace.luminecklace",
      userId: UUIDS.delivery,
    },
  ]) {
    assert.throws(() => parseRegisterPushDevice(invalid), PushValidationError);
  }

  assert.deepEqual(
    parseDeletePushDevice({ deviceToken: TOKEN, environment: "production" }),
    {
      deviceToken: TOKEN,
      environment: "production",
      bundleId: "luminecklace.luminecklace",
    }
  );
});

test("preference patches reject unknown and non-boolean values", () => {
  assert.deepEqual(parsePushPreferences({ responsesEnabled: false }), {
    responsesEnabled: false,
  });
  assert.throws(() => parsePushPreferences({}), PushValidationError);
  assert.throws(
    () => parsePushPreferences({ revealsEnabled: "yes" }),
    PushValidationError
  );
  assert.throws(
    () => parsePushPreferences({ marketingEnabled: true }),
    PushValidationError
  );
});

test("notification payloads contain only lock-screen-safe event data", () => {
  const event = parsePushEventPayload(
    {
      type: "lumi.responded",
      necklaceId: UUIDS.necklace,
      lumiId: UUIDS.lumi,
      revealSessionId: UUIDS.reveal,
      responseText: "private response",
      lumiText: "private message",
    },
    "lumi.responded"
  );
  const payload = buildApnsPayload("lumi.responded", event);
  const serialized = JSON.stringify(payload);

  assert.equal(serialized.includes("private response"), false);
  assert.equal(serialized.includes("private message"), false);
  assert.deepEqual(Object.keys(payload).sort(), [
    "aps",
    "lumiId",
    "necklaceId",
    "revealSessionId",
    "type",
  ]);
});

function claimedDelivery() {
  return {
    delivery_id: UUIDS.delivery,
    claim_token: UUIDS.claim,
    attempt_count: 1,
    device_token: TOKEN,
    apns_environment: "sandbox",
    bundle_id: "luminecklace.luminecklace",
    event_type: "lumi.revealed",
    event_payload: {
      type: "lumi.revealed",
      necklaceId: UUIDS.necklace,
      lumiId: UUIDS.lumi,
      revealSessionId: UUIDS.reveal,
    },
  };
}

function fakeClient(finalizations: Array<Record<string, unknown>>) {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "claim_push_deliveries") {
        return { data: [claimedDelivery()], error: null };
      }
      if (name === "finalize_push_delivery") {
        finalizations.push(args);
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
}

test("APNs success marks a claimed delivery sent", async () => {
  const finalizations: Array<Record<string, unknown>> = [];
  const summary = await dispatchPushDeliveries({
    client: fakeClient(finalizations),
    send: async () => ({ status: 200, reason: null, apnsId: UUIDS.delivery }),
  });
  assert.deepEqual(summary, {
    claimed: 1,
    sent: 1,
    retried: 0,
    invalid: 0,
    failed: 0,
  });
  assert.equal(finalizations[0].p_status, "sent");
});

test("temporary APNs rejection schedules exponential retry", async () => {
  const finalizations: Array<Record<string, unknown>> = [];
  const summary = await dispatchPushDeliveries({
    client: fakeClient(finalizations),
    random: () => 0,
    send: async () => ({ status: 503, reason: "ServiceUnavailable", apnsId: null }),
  });
  assert.equal(summary.retried, 1);
  assert.equal(finalizations[0].p_status, "retry");
  assert.equal(typeof finalizations[0].p_available_at, "string");
});

test("invalid APNs token response is finalized without retry", async () => {
  const finalizations: Array<Record<string, unknown>> = [];
  const summary = await dispatchPushDeliveries({
    client: fakeClient(finalizations),
    send: async () => ({ status: 410, reason: "Unregistered", apnsId: null }),
  });
  assert.equal(summary.invalid, 1);
  assert.equal(finalizations[0].p_status, "invalid_token");
});

test("cron dispatch requires the configured bearer secret", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "push-test-secret";
  try {
    assert.equal(
      isAuthorizedCronRequest(
        new Request("http://localhost/api/cron/push", {
          headers: { Authorization: "Bearer wrong" },
        })
      ),
      false
    );
    const response = await getCron(
      new Request("http://localhost/api/cron/push")
    );
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
