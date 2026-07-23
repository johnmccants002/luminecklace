import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  editSenderLumi,
  enqueueSenderLumi,
  listSenderNecklaces,
  normalizeLumiText,
  removeSenderLumi,
  reorderSenderLumis,
  SenderApiError,
} from "../lib/sender/necklaces";
import { resolveNextRecipientTap } from "../lib/tap/recipient";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables for sender tests");
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

type Fixture = {
  ownerId: string;
  otherUserId: string;
  primaryNecklaceId: string;
  secondaryNecklaceId: string;
  otherNecklaceId: string;
  primaryTokenHash: string;
  ownerEmail: string;
  ownerPassword: string;
  otherEmail: string;
  otherPassword: string;
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

  const primaryTokenHash = randomUUID().replaceAll("-", "");
  const necklaceRows = [
    {
      tag_ref: `sender-primary-${randomUUID()}`,
      tap_token_hash: primaryTokenHash,
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

  const revealedBase = Date.now() - 60_000;
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
    ...Array.from({ length: 6 }, (_, index) => ({
      necklace_id: primary.id,
      author_user_id: ownerData.user.id,
      content: `Revealed Lumi ${index + 1}`,
      queue_position: index + 3,
      is_enabled: true,
      revealed_at: new Date(revealedBase + index * 1_000).toISOString(),
    })),
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
    primaryTokenHash,
    ownerEmail,
    ownerPassword,
    otherEmail,
    otherPassword,
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
    assert.deepEqual(
      necklaces[0].queue.map((lumi) => lumi.text),
      ["First queued Lumi", "Second queued Lumi"]
    );
    assert.deepEqual(necklaces[0].nextLumi, necklaces[0].queue[0]);
    assert.equal(necklaces[0].availableLumiCount, necklaces[0].queue.length);
    assert.equal(necklaces[0].reserve.enabled, true);
    assert.equal(necklaces[0].reserve.approvedCount, 18);
    assert.equal(necklaces[0].reserve.totalCount, 18);
    assert.deepEqual(
      necklaces[0].reserve.categories.map((category) => [
        category.key,
        category.approvedCount,
        category.totalCount,
      ]),
      [
        ["affection", 4, 4],
        ["comfort", 4, 4],
        ["encouragement", 4, 4],
        ["presence", 3, 3],
        ["reassurance", 3, 3],
      ]
    );
    assert.deepEqual(
      necklaces[0].recentlyRevealed.map((lumi) => lumi.text),
      [
        "Revealed Lumi 6",
        "Revealed Lumi 5",
        "Revealed Lumi 4",
        "Revealed Lumi 3",
        "Revealed Lumi 2",
      ]
    );
    assert.equal(necklaces[1].id, fixture.secondaryNecklaceId);
    assert.equal(necklaces[1].nextLumi, null);
    assert.deepEqual(Object.keys(necklaces[0]).sort(), [
      "availableLumiCount",
      "id",
      "isPrimary",
      "lifecycleStatus",
      "name",
      "nextLumi",
      "queue",
      "recentlyRevealed",
      "reserve",
      "sku",
      "themeKey",
    ]);

    const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const otherClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const [{ error: ownerSignInError }, { error: otherSignInError }] =
      await Promise.all([
        ownerClient.auth.signInWithPassword({
          email: fixture.ownerEmail,
          password: fixture.ownerPassword,
        }),
        otherClient.auth.signInWithPassword({
          email: fixture.otherEmail,
          password: fixture.otherPassword,
        }),
      ]);
    assert.equal(ownerSignInError, null);
    assert.equal(otherSignInError, null);

    const [{ data: ownerReserve }, { data: otherReserve }] = await Promise.all([
      ownerClient
        .from("necklace_reserve_settings")
        .select("necklace_id")
        .eq("necklace_id", fixture.primaryNecklaceId),
      otherClient
        .from("necklace_reserve_settings")
        .select("necklace_id")
        .eq("necklace_id", fixture.primaryNecklaceId),
    ]);
    assert.equal(ownerReserve?.length, 1);
    assert.equal(otherReserve?.length, 0);

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

test("sender queue reorder, edit, remove, ownership, and recipient resolve stay consistent", async () => {
  const fixture = await createFixture();

  try {
    assert.deepEqual(
      await reorderSenderLumis(
        admin,
        fixture.ownerId,
        fixture.secondaryNecklaceId,
        []
      ),
      []
    );

    const initial = await listSenderNecklaces(admin, fixture.ownerId);
    const primary = initial.find((necklace) => necklace.id === fixture.primaryNecklaceId);
    assert.ok(primary);
    const [first, second] = primary.queue;
    const third = await enqueueSenderLumi(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      "Third queued Lumi"
    );

    const reordered = await reorderSenderLumis(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      [second.id, third.id, first.id]
    );
    assert.deepEqual(reordered.map((lumi) => lumi.id), [second.id, third.id, first.id]);
    assert.deepEqual(reordered.map((lumi) => lumi.queuePosition), [1, 2, 3]);

    const fresh = await listSenderNecklaces(admin, fixture.ownerId);
    const freshPrimary = fresh.find(
      (necklace) => necklace.id === fixture.primaryNecklaceId
    );
    assert.deepEqual(freshPrimary?.queue.map((lumi) => lumi.id), [
      second.id,
      third.id,
      first.id,
    ]);

    const resolve = await resolveNextRecipientTap(admin, fixture.primaryTokenHash);
    assert.equal(resolve.status, "ready");
    if (resolve.status === "ready") {
      assert.equal(resolve.lumi.id, second.id);
      assert.deepEqual(Object.keys(resolve).sort(), [
        "lumi",
        "necklace",
        "presentation",
        "revealSessionId",
        "status",
      ]);
    }

    const edited = await editSenderLumi(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      first.id,
      "Updated first Lumi"
    );
    assert.equal(edited.text, "Updated first Lumi");
    assert.equal(edited.queuePosition, 3);

    const removed = await removeSenderLumi(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      second.id
    );
    assert.equal(removed.deletedLumiId, second.id);
    assert.deepEqual(removed.queue.map((lumi) => lumi.id), [third.id, first.id]);
    assert.deepEqual(removed.queue.map((lumi) => lumi.queuePosition), [1, 2]);

    await assert.rejects(
      removeSenderLumi(
        admin,
        fixture.ownerId,
        fixture.primaryNecklaceId,
        second.id
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );
    await assert.rejects(
      editSenderLumi(
        admin,
        fixture.ownerId,
        fixture.primaryNecklaceId,
        randomUUID(),
        "Missing"
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 404
    );

    const afterRemove = await listSenderNecklaces(admin, fixture.ownerId);
    const afterRemovePrimary = afterRemove.find(
      (necklace) => necklace.id === fixture.primaryNecklaceId
    );
    assert.deepEqual(afterRemovePrimary?.queue.map((lumi) => lumi.id), [
      third.id,
      first.id,
    ]);
    assert.equal(afterRemovePrimary?.queue[1].text, "Updated first Lumi");
    assert.equal(afterRemovePrimary?.recentlyRevealed.length, 5);

    const { data: revealed } = await admin
      .from("necklace_lumis")
      .select("id")
      .eq("necklace_id", fixture.primaryNecklaceId)
      .not("revealed_at", "is", null)
      .limit(1)
      .single();
    assert.ok(revealed);

    await assert.rejects(
      editSenderLumi(
        admin,
        fixture.ownerId,
        fixture.primaryNecklaceId,
        revealed.id,
        "Cannot edit"
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );
    await assert.rejects(
      removeSenderLumi(
        admin,
        fixture.ownerId,
        fixture.primaryNecklaceId,
        revealed.id
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );
    await assert.rejects(
      reorderSenderLumis(admin, fixture.ownerId, fixture.primaryNecklaceId, [
        third.id,
        first.id,
        revealed.id,
      ]),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );

    const { data: foreignLumi, error: foreignLumiError } = await admin
      .from("necklace_lumis")
      .insert({
        necklace_id: fixture.otherNecklaceId,
        author_user_id: fixture.otherUserId,
        content: "Foreign Lumi",
        queue_position: 1,
        is_enabled: true,
      })
      .select("id")
      .single();
    if (foreignLumiError || !foreignLumi) {
      throw new Error(foreignLumiError?.message ?? "Failed to create foreign Lumi");
    }

    for (const staleIds of [[], [randomUUID()], [first.id, foreignLumi.id]]) {
      await assert.rejects(
        reorderSenderLumis(
          admin,
          fixture.ownerId,
          fixture.primaryNecklaceId,
          staleIds
        ),
        (error: unknown) => error instanceof SenderApiError && error.status === 409
      );
    }
    await assert.rejects(
      reorderSenderLumis(admin, fixture.ownerId, fixture.primaryNecklaceId, [
        first.id,
        first.id,
      ]),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );
    await assert.rejects(
      editSenderLumi(
        admin,
        fixture.ownerId,
        fixture.otherNecklaceId,
        foreignLumi.id,
        "Forbidden"
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 403
    );
    await assert.rejects(
      reorderSenderLumis(admin, fixture.ownerId, fixture.otherNecklaceId, [
        foreignLumi.id,
      ]),
      (error: unknown) => error instanceof SenderApiError && error.status === 403
    );
    await assert.rejects(
      removeSenderLumi(
        admin,
        fixture.ownerId,
        fixture.otherNecklaceId,
        foreignLumi.id
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 403
    );
    assert.equal(
      (await listSenderNecklaces(admin, fixture.otherUserId)).some(
        (necklace) => necklace.id === fixture.primaryNecklaceId
      ),
      false
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("concurrent enqueue and reorder serialize without duplicate active positions", async () => {
  const fixture = await createFixture();

  try {
    const one = await enqueueSenderLumi(
      admin,
      fixture.ownerId,
      fixture.secondaryNecklaceId,
      "One"
    );
    const two = await enqueueSenderLumi(
      admin,
      fixture.ownerId,
      fixture.secondaryNecklaceId,
      "Two"
    );

    const results = await Promise.allSettled([
      enqueueSenderLumi(
        admin,
        fixture.ownerId,
        fixture.secondaryNecklaceId,
        "Concurrent"
      ),
      reorderSenderLumis(admin, fixture.ownerId, fixture.secondaryNecklaceId, [
        two.id,
        one.id,
      ]),
    ]);
    assert.equal(results[0].status, "fulfilled");
    if (results[1].status === "rejected") {
      if (!(results[1].reason instanceof SenderApiError)) {
        throw results[1].reason;
      }
      assert.equal(results[1].reason.status, 409);
    }

    const { data: rows, error } = await admin
      .from("necklace_lumis")
      .select("queue_position")
      .eq("necklace_id", fixture.secondaryNecklaceId)
      .eq("is_enabled", true)
      .is("revealed_at", null);
    if (error || !rows) {
      throw new Error(error?.message ?? "Failed to read concurrent queue");
    }
    const positions = rows.map((row) => row.queue_position);
    assert.equal(new Set(positions).size, positions.length);
  } finally {
    await cleanupFixture(fixture);
  }
});
