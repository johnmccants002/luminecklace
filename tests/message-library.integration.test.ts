import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  enqueueSenderLibraryMessage,
  listSenderMessageLibrary,
} from "../lib/sender/message-library";
import { SenderApiError } from "../lib/sender/necklaces";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !secretKey) {
  throw new Error("Missing Supabase environment variables for message-library tests");
}

const admin = createClient(supabaseUrl, secretKey);

test("Explore catalog and snapshot enqueue preserve visibility, ownership, provenance, and queue safety", async (t) => {
  const probe = await admin
    .from("messages")
    .select("id, is_explore_published, explore_sort_order")
    .limit(1);
  if (probe.error?.code === "42703" || probe.error?.code === "PGRST204") {
    t.skip("Explore Messages migration is not applied to the configured project");
    return;
  }
  assert.ifError(probe.error);

  const marker = `explore-${randomUUID()}`;
  const owner = await admin.auth.admin.createUser({
    email: `${marker}@example.com`,
    password: `Explore!${randomUUID()}`,
    email_confirm: true,
  });
  const other = await admin.auth.admin.createUser({
    email: `${marker}-other@example.com`,
    password: `Explore!${randomUUID()}`,
    email_confirm: true,
  });
  assert.ifError(owner.error);
  assert.ifError(other.error);
  assert.ok(owner.data.user);
  assert.ok(other.data.user);

  const necklaces = await admin
    .from("necklaces")
    .insert([
      {
        tag_ref: `${marker}-owned`,
        tap_token_hash: randomUUID().replaceAll("-", ""),
        sku: "EXPLORE-TEST",
        name: "Explore owned",
        lifecycle_status: "active",
      },
      {
        tag_ref: `${marker}-foreign`,
        tap_token_hash: randomUUID().replaceAll("-", ""),
        sku: "EXPLORE-TEST",
        name: "Explore foreign",
        lifecycle_status: "active",
      },
    ])
    .select("id");
  assert.ifError(necklaces.error);
  assert.equal(necklaces.data.length, 2);
  const [ownedNecklace, foreignNecklace] = necklaces.data;
  const ownership = await admin.from("necklace_ownerships").insert([
    {
      necklace_id: ownedNecklace.id,
      sender_user_id: owner.data.user.id,
      is_primary: true,
    },
    {
      necklace_id: foreignNecklace.id,
      sender_user_id: other.data.user.id,
      is_primary: true,
    },
  ]);
  assert.ifError(ownership.error);

  const templateRows = [
    {
      text: `${marker} I brought you a little extra courage today.`,
      content: `${marker} I brought you a little extra courage today.`,
      is_active: true,
      is_explore_published: true,
      is_reserve_eligible: false,
      reserve_default_approved: false,
      explore_sort_order: 901,
      category: "encouragement",
      theme_key: "rose",
      animation_key: "float",
      sound_key: "chime",
    },
    {
      text: `${marker} You never have to pretend with me.`,
      content: `${marker} You never have to pretend with me.`,
      is_active: true,
      is_explore_published: true,
      is_reserve_eligible: true,
      reserve_default_approved: false,
      explore_sort_order: 902,
      category: "encouragement",
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
    },
    {
      text: `${marker} reserve only`,
      content: `${marker} reserve only`,
      is_active: true,
      is_explore_published: false,
      is_reserve_eligible: true,
      reserve_default_approved: false,
      reserve_sort_order: null,
      explore_sort_order: null,
      category: "comfort",
    },
    {
      text: `${marker} inactive`,
      content: `${marker} inactive`,
      is_active: false,
      is_explore_published: false,
      is_reserve_eligible: false,
      reserve_default_approved: false,
      explore_sort_order: null,
      category: "comfort",
    },
  ];
  const templates = await admin.from("messages").insert(templateRows).select("id");
  assert.ifError(templates.error);
  assert.equal(templates.data.length, 4);
  const [firstTemplate, secondTemplate, reserveOnly, inactive] = templates.data;

  try {
    const firstPage = await listSenderMessageLibrary(
      admin,
      owner.data.user.id,
      {
        category: "encouragement",
        search: marker,
        limit: 1,
        necklaceId: ownedNecklace.id,
      }
    );
    assert.equal(firstPage.messages.length, 1);
    assert.ok(firstPage.nextCursor);
    assert.equal(firstPage.messages[0].id, firstTemplate.id);
    assert.equal(firstPage.messages[0].isQueued, false);

    const secondPage = await listSenderMessageLibrary(
      admin,
      owner.data.user.id,
      {
        category: "encouragement",
        search: marker,
        limit: 1,
        cursor: firstPage.nextCursor ?? undefined,
      }
    );
    assert.deepEqual(
      secondPage.messages.map((message) => message.id),
      [secondTemplate.id]
    );
    assert.equal(secondPage.nextCursor, null);

    const hidden = await listSenderMessageLibrary(admin, owner.data.user.id, {
      search: `${marker} reserve only`,
      limit: 20,
    });
    assert.deepEqual(hidden.messages, []);

    const defaultLumi = await enqueueSenderLibraryMessage(
      admin,
      owner.data.user.id,
      ownedNecklace.id,
      firstTemplate.id
    );
    assert.equal(defaultLumi.text, templateRows[0].text);
    assert.deepEqual(defaultLumi.presentation, {
      theme: "rose",
      animation: "float",
      sound: "chime",
    });

    const personalized = await enqueueSenderLibraryMessage(
      admin,
      owner.data.user.id,
      ownedNecklace.id,
      secondTemplate.id,
      "  This one is just for you.  "
    );
    assert.equal(personalized.text, "This one is just for you.");

    const stored = await admin
      .from("necklace_lumis")
      .select("id, source_message_id, content, theme_key, animation_key, sound_key")
      .in("id", [defaultLumi.id, personalized.id])
      .order("queue_position");
    assert.ifError(stored.error);
    assert.deepEqual(
      stored.data.map((row) => row.source_message_id),
      [firstTemplate.id, secondTemplate.id]
    );

    await assert.rejects(
      enqueueSenderLibraryMessage(
        admin,
        owner.data.user.id,
        foreignNecklace.id,
        firstTemplate.id
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 403
    );
    for (const missingId of [reserveOnly.id, inactive.id, randomUUID()]) {
      await assert.rejects(
        enqueueSenderLibraryMessage(
          admin,
          owner.data.user.id,
          ownedNecklace.id,
          missingId
        ),
        (error: unknown) => error instanceof SenderApiError && error.status === 404
      );
    }
    await assert.rejects(
      enqueueSenderLibraryMessage(
        admin,
        owner.data.user.id,
        ownedNecklace.id,
        firstTemplate.id,
        "x".repeat(501)
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 400
    );

    const concurrent = await Promise.all([
      enqueueSenderLibraryMessage(
        admin,
        owner.data.user.id,
        ownedNecklace.id,
        secondTemplate.id
      ),
      enqueueSenderLibraryMessage(
        admin,
        owner.data.user.id,
        ownedNecklace.id,
        secondTemplate.id
      ),
    ]);
    assert.equal(new Set(concurrent.map((lumi) => lumi.queuePosition)).size, 2);

    const changed = await admin
      .from("messages")
      .update({
        text: `${marker} edited later`,
        content: `${marker} edited later`,
        is_explore_published: false,
      })
      .eq("id", firstTemplate.id);
    assert.ifError(changed.error);
    const snapshot = await admin
      .from("necklace_lumis")
      .select("content")
      .eq("id", defaultLumi.id)
      .single();
    assert.ifError(snapshot.error);
    assert.equal(snapshot.data.content, templateRows[0].text);

    const duplicateHints = await listSenderMessageLibrary(
      admin,
      owner.data.user.id,
      {
        category: "encouragement",
        search: marker,
        limit: 20,
        necklaceId: ownedNecklace.id,
      }
    );
    const used = duplicateHints.messages.find(
      (message) => message.id === secondTemplate.id
    );
    assert.equal(used?.isQueued, true);
    assert.ok(used?.lastUsedAt);
  } finally {
    await admin
      .from("necklace_lumis")
      .delete()
      .in("necklace_id", [ownedNecklace.id, foreignNecklace.id]);
    await admin.from("messages").delete().in(
      "id",
      templates.data.map((template) => template.id)
    );
    await admin
      .from("necklace_ownerships")
      .delete()
      .in("necklace_id", [ownedNecklace.id, foreignNecklace.id]);
    await admin
      .from("necklaces")
      .delete()
      .in("id", [ownedNecklace.id, foreignNecklace.id]);
    await Promise.all([
      admin.auth.admin.deleteUser(owner.data.user.id),
      admin.auth.admin.deleteUser(other.data.user.id),
    ]);
  }
});

