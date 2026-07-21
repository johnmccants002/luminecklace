import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  enqueueSenderLumi,
  listSenderNecklaces,
  normalizeLumiText,
  SenderApiError,
} from "../lib/sender/necklaces";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("Missing Supabase environment variables for sender tests");
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

type Fixture = {
  ownerId: string;
  otherUserId: string;
  primaryNecklaceId: string;
  secondaryNecklaceId: string;
  otherNecklaceId: string;
};

function fixtureEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${randomUUID()}@example.com`;
}

async function createFixture(): Promise<Fixture> {
  const ownerEmail = fixtureEmail("sender-owner");
  const otherEmail = fixtureEmail("sender-other");
  const ownerPassword = `SenderPass!${Date.now()}`;
  const otherPassword = `OtherPass!${Date.now()}`;

  const [{ data: ownerData, error: ownerError }, { data: otherData, error: otherError }] =
    await Promise.all([
      admin.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
      }),
      admin.auth.admin.createUser({
        email: otherEmail,
        password: otherPassword,
        email_confirm: true,
      }),
    ]);

  if (ownerError || !ownerData.user || otherError || !otherData.user) {
    throw new Error(ownerError?.message ?? otherError?.message ?? "Failed to create users");
  }

  const necklaceRows = [
    {
      tag_ref: `sender-primary-${randomUUID()}`,
      tap_token_hash: randomUUID().replaceAll("-", ""),
      sku: "SENDER-PRIMARY",
      name: "Primary Lumi",
      theme_key: "heart",
      lifecycle_status: "active",
    },
    {
      tag_ref: `sender-secondary-${randomUUID()}`,
      tap_token_hash: randomUUID().replaceAll("-", ""),
      sku: "SENDER-SECONDARY",
      name: "Secondary Lumi",
      theme_key: "rose",
      lifecycle_status: "pending_sender_setup",
    },
    {
      tag_ref: `sender-other-${randomUUID()}`,
      tap_token_hash: randomUUID().replaceAll("-", ""),
      sku: "SENDER-OTHER",
      name: "Someone Else's Lumi",
      theme_key: "heart",
      lifecycle_status: "active",
    },
  ];

  const { data: necklaces, error: necklaceError } = await admin
    .from("necklaces")
    .insert(necklaceRows)
    .select("id");

  if (necklaceError || !necklaces || necklaces.length !== 3) {
    throw new Error(necklaceError?.message ?? "Failed to create necklaces");
  }

  const [primary, secondary, other] = necklaces;
  const { error: ownershipError } = await admin.from("necklace_ownerships").insert([
    {
      necklace_id: primary.id,
      sender_user_id: ownerData.user.id,
      is_primary: true,
    },
    {
      necklace_id: secondary.id,
      sender_user_id: ownerData.user.id,
      is_primary: false,
    },
    {
      necklace_id: other.id,
      sender_user_id: otherData.user.id,
      is_primary: true,
    },
  ]);

  if (ownershipError) {
    throw new Error(ownershipError.message);
  }

  const { error: lumiError } = await admin.from("necklace_lumis").insert([
    {
      necklace_id: primary.id,
      author_user_id: ownerData.user.id,
      content: "First queued Lumi",
      queue_position: 1,
      is_enabled: true,
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
    },
    {
      necklace_id: primary.id,
      author_user_id: ownerData.user.id,
      content: "Second queued Lumi",
      queue_position: 2,
      is_enabled: true,
    },
    {
      necklace_id: primary.id,
      author_user_id: ownerData.user.id,
      content: "Already revealed Lumi",
      queue_position: 3,
      is_enabled: true,
      revealed_at: new Date().toISOString(),
    },
  ]);

  if (lumiError) {
    throw new Error(lumiError.message);
  }

  return {
    ownerId: ownerData.user.id,
    otherUserId: otherData.user.id,
    primaryNecklaceId: primary.id,
    secondaryNecklaceId: secondary.id,
    otherNecklaceId: other.id,
  };
}

async function cleanupFixture(fixture: Fixture) {
  const necklaceIds = [
    fixture.primaryNecklaceId,
    fixture.secondaryNecklaceId,
    fixture.otherNecklaceId,
  ];
  await admin.from("lumi_reveal_sessions").delete().in("necklace_id", necklaceIds);
  await admin.from("tap_events").delete().in("necklace_id", necklaceIds);
  await admin.from("necklace_lumis").delete().in("necklace_id", necklaceIds);
  await admin.from("necklace_ownerships").delete().in("necklace_id", necklaceIds);
  await admin.from("necklaces").delete().in("id", necklaceIds);
  await Promise.all([
    admin.auth.admin.deleteUser(fixture.ownerId),
    admin.auth.admin.deleteUser(fixture.otherUserId),
  ]);
}

test("sender necklace APIs scope ownership, order primary first, and enqueue safely", async () => {
  const fixture = await createFixture();

  try {
    const emptyUser = await admin.auth.admin.createUser({
      email: fixtureEmail("sender-empty"),
      password: `EmptyPass!${Date.now()}`,
      email_confirm: true,
    });
    assert.ok(emptyUser.data.user);
    assert.deepEqual(await listSenderNecklaces(admin, emptyUser.data.user!.id), []);
    await admin.auth.admin.deleteUser(emptyUser.data.user!.id);

    const necklaces = await listSenderNecklaces(admin, fixture.ownerId);
    assert.equal(necklaces.length, 2);
    assert.equal(necklaces[0].id, fixture.primaryNecklaceId);
    assert.equal(necklaces[0].isPrimary, true);
    assert.equal(necklaces[0].availableLumiCount, 2);
    assert.equal(necklaces[0].nextLumi?.text, "First queued Lumi");
    assert.equal(necklaces[1].id, fixture.secondaryNecklaceId);
    assert.equal(necklaces[1].nextLumi, null);
    assert.deepEqual(Object.keys(necklaces[0]).sort(), [
      "availableLumiCount",
      "id",
      "isPrimary",
      "lifecycleStatus",
      "name",
      "nextLumi",
      "sku",
      "themeKey",
    ]);

    const [first, second] = await Promise.all([
      enqueueSenderLumi(admin, fixture.ownerId, fixture.secondaryNecklaceId, "One"),
      enqueueSenderLumi(admin, fixture.ownerId, fixture.secondaryNecklaceId, "Two"),
    ]);
    assert.deepEqual([first.queuePosition, second.queuePosition].sort(), [1, 2]);

    await assert.rejects(
      enqueueSenderLumi(admin, fixture.ownerId, fixture.otherNecklaceId, "Forbidden"),
      (error: unknown) => error instanceof SenderApiError && error.status === 403
    );
    await assert.rejects(
      enqueueSenderLumi(admin, fixture.ownerId, randomUUID(), "Missing"),
      (error: unknown) => error instanceof SenderApiError && error.status === 404
    );

    assert.throws(
      () => normalizeLumiText(" "),
      (error: unknown) => error instanceof SenderApiError && error.status === 400
    );
    assert.throws(
      () => normalizeLumiText("x".repeat(501)),
      (error: unknown) => error instanceof SenderApiError && error.status === 400
    );
  } finally {
    await cleanupFixture(fixture);
  }
});
