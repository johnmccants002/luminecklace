import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  confirmRecipientReveal,
  resolveNextRecipientTap,
} from "../lib/tap/recipient";

type ResolveResponse =
  | {
      status: "ready";
      revealSessionId: string;
      necklace: { displayName: string };
      lumi: { id: string; text: string };
      presentation: { theme: string; animation: string; sound: string };
    }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status?: undefined; error: string };

type RevealedResponse =
  | { status: "revealed"; revealedAt: string }
  | { status: "expired" }
  | { status: "unavailable" }
  | { status?: undefined; error: string };

function readDotEnvVars() {
  try {
    const raw = readFileSync(".env", "utf8");
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) {
          return null;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        return [key, value];
      })
      .filter(Boolean);

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

const dotEnv = readDotEnvVars();

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? dotEnv.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ?? dotEnv.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY for recipient tap tests"
  );
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function randomEmail() {
  return `recipient-tap-${Date.now()}-${randomUUID()}@example.com`;
}

function isMissingSchemaError(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes("could not find the table 'public.necklace_lumis'") ||
    normalized.includes("could not find the table \"public.necklace_lumis\"") ||
    normalized.includes("could not find column") ||
    normalized.includes("schema cache")
  );
}

function assertExactKeys(value: object, expectedKeys: string[]) {
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function assertReadyResolve(
  body: ResolveResponse
): asserts body is Extract<ResolveResponse, { status: "ready" }> {
  assert.equal(body.status, "ready");
}

function assertSuccessfulReveal(
  body: RevealedResponse
): asserts body is Extract<RevealedResponse, { status: "revealed" }> {
  assert.equal(body.status, "revealed");
}

async function callResolve(token: unknown) {
  if (typeof token !== "string") {
    return { status: "unavailable" as const };
  }

  const tokenHash = hashToken(token.trim());
  return resolveNextRecipientTap(admin, tokenHash);
}

async function callRevealed(revealSessionId: unknown) {
  if (typeof revealSessionId !== "string") {
    return { status: "unavailable" as const };
  }

  return confirmRecipientReveal(admin, revealSessionId.trim());
}

async function hasRecipientSchema(): Promise<boolean> {
  const { error } = await admin.from("necklace_lumis").select("id").limit(1);
  if (!error) {
    return true;
  }

  if (isMissingSchemaError(error.message)) {
    return false;
  }

  throw new Error(`Failed to inspect recipient schema: ${error.message}`);
}

const recipientSchemaReadyPromise = hasRecipientSchema();

async function skipIfRecipientSchemaMissing() {
  const ready = await recipientSchemaReadyPromise;
  if (!ready) {
    console.log("[recipient-tap] recipient schema not found; skipping live integration assertions.");
  }

  return !ready;
}

async function createFixture(options: {
  lifecycleStatus?: "active" | "inactive";
  lumis?: Array<{
    queue_position: number;
    content: string;
    eligible_from?: string | null;
    theme_key?: string | null;
    animation_key?: string | null;
    sound_key?: string | null;
  }>;
}) {
  const lifecycleStatus = options.lifecycleStatus ?? "active";
  const rawToken = `tap-${randomUUID()}-${randomUUID()}`;
  const tokenHash = hashToken(rawToken);
  const email = randomEmail();
  const password = `TapPass!${Date.now()}`;

  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createUserError || !createdUser.user) {
    throw new Error(`Failed to create fixture user: ${createUserError?.message ?? "unknown error"}`);
  }

  const userId = createdUser.user.id;
  const necklaceName = `Fixture Necklace ${randomUUID()}`;
  const tagRef = `tag-${randomUUID()}`;

  const { data: necklace, error: necklaceError } = await admin
    .from("necklaces")
    .insert({
      tag_ref: tagRef,
      tap_token_hash: tokenHash,
      sku: "HEART-01",
      name: necklaceName,
      theme_key: "heart",
      lifecycle_status: lifecycleStatus,
    })
    .select("id, name")
    .single();

  if (necklaceError || !necklace) {
    throw new Error(`Failed to create fixture necklace: ${necklaceError?.message ?? "unknown error"}`);
  }

  const { error: ownershipError } = await admin.from("necklace_ownerships").insert({
    necklace_id: necklace.id,
    sender_user_id: userId,
    is_primary: true,
  });

  if (ownershipError) {
    throw new Error(`Failed to create fixture ownership: ${ownershipError.message}`);
  }

  if ((options.lumis ?? []).length > 0) {
    const { error: lumisError } = await admin.from("necklace_lumis").insert(
      (options.lumis ?? []).map((lumi) => ({
        necklace_id: necklace.id,
        author_user_id: userId,
        content: lumi.content,
        queue_position: lumi.queue_position,
        is_enabled: true,
        eligible_from: lumi.eligible_from ?? null,
        theme_key: lumi.theme_key ?? "heart",
        animation_key: lumi.animation_key ?? "breathe",
        sound_key: lumi.sound_key ?? "soft",
      }))
    );

    if (lumisError) {
      throw new Error(`Failed to create fixture lumis: ${lumisError.message}`);
    }
  }

  return {
    userId,
    userEmail: email,
    userPassword: password,
    necklaceId: necklace.id,
    necklaceName,
    rawToken,
  };
}

async function cleanupFixture(fixture: { userId: string; necklaceId: string }) {
  await admin.from("tap_events").delete().eq("necklace_id", fixture.necklaceId);
  await admin.from("lumi_reveal_sessions").delete().eq("necklace_id", fixture.necklaceId);
  await admin.from("necklace_lumis").delete().eq("necklace_id", fixture.necklaceId);
  await admin.from("necklace_ownerships").delete().eq("necklace_id", fixture.necklaceId);
  await admin.from("necklaces").delete().eq("id", fixture.necklaceId);
  await admin.auth.admin.deleteUser(fixture.userId);
}

test("resolve returns ready and leaves the lumi unrevealed until confirmed", async () => {
  if (await skipIfRecipientSchemaMissing()) {
    return;
  }

  const fixture = await createFixture({
    lumis: [
      {
        queue_position: 1,
        content: "Remember that I am always in your corner.",
      },
      {
        queue_position: 2,
        content: "You are deeply loved.",
      },
    ],
  });

  try {
    const resolve = await callResolve(fixture.rawToken);
    assertExactKeys(resolve as object, [
      "status",
      "revealSessionId",
      "necklace",
      "lumi",
      "presentation",
    ]);
    assertReadyResolve(resolve);
    assert.equal(resolve.necklace.displayName, fixture.necklaceName);
    assert.equal(resolve.lumi.text, "Remember that I am always in your corner.");
    assert.equal(resolve.presentation.theme, "heart");
    assert.equal(resolve.presentation.animation, "breathe");
    assert.equal(resolve.presentation.sound, "soft");

    const { data: lumis, error: lumisError } = await admin
      .from("necklace_lumis")
      .select("id, revealed_at, queue_position")
      .eq("necklace_id", fixture.necklaceId)
      .order("queue_position", { ascending: true });

    if (lumisError || !lumis) {
      throw new Error(`Failed to read fixture lumis: ${lumisError?.message ?? "unknown error"}`);
    }

    assert.equal(lumis.length, 2);
    assert.equal(lumis[0].revealed_at, null);
    assert.equal(lumis[1].revealed_at, null);

    const { data: events, error: eventsError } = await admin
      .from("tap_events")
      .select("status, necklace_lumi_id, reveal_session_id")
      .eq("necklace_id", fixture.necklaceId);

    if (eventsError || !events) {
      throw new Error(`Failed to read tap events: ${eventsError?.message ?? "unknown error"}`);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0].status, "tap_ready");
    assert.equal(events[0].reveal_session_id, resolve.revealSessionId);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("resolve returns empty for an empty queue and for an ineligible first item", async () => {
  if (await skipIfRecipientSchemaMissing()) {
    return;
  }

  const emptyFixture = await createFixture({ lumis: [] });
  const futureFixture = await createFixture({
    lumis: [
      {
        queue_position: 1,
        content: "This one is not eligible yet.",
        eligible_from: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      {
        queue_position: 2,
        content: "This one would otherwise be ready.",
      },
    ],
  });

  try {
    const emptyResolve = await callResolve(emptyFixture.rawToken);
    assert.equal(emptyResolve.status, "empty");

    const futureResolve = await callResolve(futureFixture.rawToken);
    assert.equal(futureResolve.status, "empty");
  } finally {
    await cleanupFixture(emptyFixture);
    await cleanupFixture(futureFixture);
  }
});

test("resolve returns unavailable for unknown or inactive necklaces", async () => {
  if (await skipIfRecipientSchemaMissing()) {
    return;
  }

  const inactiveFixture = await createFixture({
    lifecycleStatus: "inactive",
    lumis: [
      {
        queue_position: 1,
        content: "Inactive necklaces should not resolve.",
      },
    ],
  });

  try {
    const unknownResolve = await callResolve(`missing-${randomUUID()}`);
    assert.equal(unknownResolve.status, "unavailable");

    const inactiveResolve = await callResolve(inactiveFixture.rawToken);
    assert.equal(inactiveResolve.status, "unavailable");
  } finally {
    await cleanupFixture(inactiveFixture);
  }
});

test("confirmation reveals the exact lumi and is idempotent", async () => {
  if (await skipIfRecipientSchemaMissing()) {
    return;
  }

  const fixture = await createFixture({
    lumis: [
      {
        queue_position: 1,
        content: "Remember that I am always in your corner.",
      },
      {
        queue_position: 2,
        content: "A second Lumi should stay hidden.",
      },
    ],
  });

  try {
    const resolve = await callResolve(fixture.rawToken);
    assertReadyResolve(resolve);

    const firstReveal = await callRevealed(resolve.revealSessionId);
    assertSuccessfulReveal(firstReveal);
    assert.equal(typeof firstReveal.revealedAt, "string");

    const secondReveal = await callRevealed(resolve.revealSessionId);
    assertSuccessfulReveal(secondReveal);
    assert.equal(secondReveal.revealedAt, firstReveal.revealedAt);

    const { data: lumis, error: lumisError } = await admin
      .from("necklace_lumis")
      .select("id, content, revealed_at, queue_position")
      .eq("necklace_id", fixture.necklaceId)
      .order("queue_position", { ascending: true });

    if (lumisError || !lumis) {
      throw new Error(`Failed to read fixture lumis: ${lumisError?.message ?? "unknown error"}`);
    }

    assert.equal(lumis[0].content, "Remember that I am always in your corner.");
    assert.equal(typeof lumis[0].revealed_at, "string");
    assert.equal(lumis[1].revealed_at, null);

    const { data: events, error: eventsError } = await admin
      .from("tap_events")
      .select("status, reveal_session_id")
      .eq("necklace_id", fixture.necklaceId)
      .eq("status", "lumi_revealed");

    if (eventsError || !events) {
      throw new Error(`Failed to read reveal events: ${eventsError?.message ?? "unknown error"}`);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0].reveal_session_id, resolve.revealSessionId);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("concurrent confirmation cannot reveal twice", async () => {
  if (await skipIfRecipientSchemaMissing()) {
    return;
  }

  const fixture = await createFixture({
    lumis: [
      {
        queue_position: 1,
        content: "Concurrency should only reveal this once.",
      },
    ],
  });

  try {
    const resolve = await callResolve(fixture.rawToken);
    assertReadyResolve(resolve);

    const [first, second] = await Promise.all([
      callRevealed(resolve.revealSessionId),
      callRevealed(resolve.revealSessionId),
    ]);

    assertSuccessfulReveal(first);
    assertSuccessfulReveal(second);
    assert.equal(first.revealedAt, second.revealedAt);

    const { data: events, error: eventsError } = await admin
      .from("tap_events")
      .select("id")
      .eq("necklace_id", fixture.necklaceId)
      .eq("status", "lumi_revealed");

    if (eventsError || !events) {
      throw new Error(`Failed to read reveal events: ${eventsError?.message ?? "unknown error"}`);
    }

    assert.equal(events.length, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});
