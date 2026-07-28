import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import { GET as getMessageLibrary } from "../app/api/sender/message-library/route";
import { POST as enqueueFromLibrary } from "../app/api/sender/necklaces/[necklaceId]/lumis/from-library/route";
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

test("Explore endpoints require bearer authentication", async () => {
  const getResponse = await getMessageLibrary(
    new Request("http://localhost/api/sender/message-library")
  );
  assert.equal(getResponse.status, 401);

  const postResponse = await enqueueFromLibrary(
    new Request(
      `http://localhost/api/sender/necklaces/${randomUUID()}/lumis/from-library`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: randomUUID() }),
      }
    ),
    { params: Promise.resolve({ necklaceId: randomUUID() }) }
  );
  assert.equal(postResponse.status, 401);
});

test("Explore includes admin-managed categories", async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const categoryKey = `celebration-${suffix}`;
  const category = await admin
    .from("message_categories")
    .insert({
      key: categoryKey,
      name: `Celebration ${suffix}`,
      sort_order: 999,
    })
    .select("key")
    .single();
  assert.ifError(category.error);
  let messageId: string | null = null;
  t.after(async () => {
    if (messageId) {
      await admin.from("messages").delete().eq("id", messageId);
    }
    await admin.from("message_categories").delete().eq("key", categoryKey);
  });

  const message = await admin
    .from("messages")
    .insert({
      package_id: "heart-core",
      text: `A celebration message ${suffix}`,
      content: `A celebration message ${suffix}`,
      is_active: true,
      is_explore_published: true,
      is_reserve_eligible: false,
      reserve_default_approved: false,
      explore_sort_order: 1,
      category: categoryKey,
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
      background_key: "rose_glow",
      font_key: "serif",
    })
    .select("id")
    .single();
  assert.ifError(message.error);
  messageId = message.data.id;

  const library = await listSenderMessageLibrary(admin, randomUUID(), {
    category: categoryKey,
    limit: 20,
  });
  assert.equal(
    library.categories.some((item) => item.key === categoryKey),
    true
  );
  assert.deepEqual(
    library.messages.map((item) => item.id),
    [message.data.id]
  );
  assert.equal(library.messages[0].category.name, `Celebration ${suffix}`);
});

test("Explore catalog and snapshot enqueue preserve visibility, ownership, provenance, and queue safety", async (t) => {
  const probe = await admin
    .from("messages")
    .select(
      "id, is_explore_published, explore_sort_order, background_key, font_key, text_size_key, text_alignment_key, text_position_key"
    )
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
  let templateIds: string[] = [];
  t.after(async () => {
    await admin
      .from("necklace_lumis")
      .delete()
      .in("necklace_id", [ownedNecklace.id, foreignNecklace.id]);
    if (templateIds.length) {
      await admin.from("messages").delete().in("id", templateIds);
    }
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
  });
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
      package_id: "heart-core",
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
      background_key: "midnight",
      font_key: "rounded",
      text_size_key: "large",
      text_alignment_key: "trailing",
      text_position_key: "bottom",
    },
    {
      package_id: "heart-core",
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
      background_key: "rose_glow",
      font_key: "serif",
      text_size_key: "small",
      text_alignment_key: "leading",
      text_position_key: "top",
    },
    {
      package_id: "heart-core",
      text: `${marker} reserve only`,
      content: `${marker} reserve only`,
      is_active: true,
      is_explore_published: false,
      is_reserve_eligible: true,
      reserve_default_approved: false,
      reserve_sort_order: null,
      explore_sort_order: null,
      category: "comfort",
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
      background_key: "rose_glow",
      font_key: "serif",
    },
    {
      package_id: "heart-core",
      text: `${marker} inactive`,
      content: `${marker} inactive`,
      is_active: false,
      is_explore_published: false,
      is_reserve_eligible: false,
      reserve_default_approved: false,
      explore_sort_order: null,
      category: "comfort",
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
      background_key: "rose_glow",
      font_key: "serif",
    },
  ];
  const templates = await admin.from("messages").insert(templateRows).select("id");
  assert.ifError(templates.error);
  assert.equal(templates.data.length, 4);
  templateIds = templates.data.map((template) => template.id);
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
    assert.equal(firstPage.messages[0].presentation.textSize, "large");
    assert.equal(firstPage.messages[0].presentation.textAlignment, "trailing");
    assert.equal(firstPage.messages[0].presentation.textPosition, "bottom");

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
      firstTemplate.id,
      "up_next"
    );
    assert.equal(defaultLumi.lumi.text, templateRows[0].text);
    assert.deepEqual(defaultLumi.lumi.presentation, {
      theme: "rose",
      animation: "float",
      sound: "chime",
      revealPreset: "wordRise",
      background: "midnight",
      font: "rounded",
      textSize: "large",
      textAlignment: "trailing",
      textPosition: "bottom",
    });

    const reserveLumi = await enqueueSenderLibraryMessage(
      admin,
      owner.data.user.id,
      ownedNecklace.id,
      secondTemplate.id,
      "reserve"
    );
    assert.equal(reserveLumi.lumi.text, templateRows[1].text);
    assert.deepEqual(defaultLumi.queue.upNext.map((lumi) => lumi.id), [
      defaultLumi.lumi.id,
    ]);
    assert.deepEqual(reserveLumi.queue.reserve.map((lumi) => lumi.id), [
      reserveLumi.lumi.id,
    ]);

    const stored = await admin
      .from("necklace_lumis")
      .select(
        "id, source_message_id, content, theme_key, animation_key, sound_key, background_key, font_key, text_size_key, text_alignment_key, text_position_key"
      )
      .in("id", [defaultLumi.lumi.id, reserveLumi.lumi.id])
      .order("queue_position");
    assert.ifError(stored.error);
    assert.deepEqual(
      new Set(stored.data.map((row) => row.source_message_id)),
      new Set([firstTemplate.id, secondTemplate.id])
    );
    const storedDefault = stored.data.find(
      (row) => row.source_message_id === firstTemplate.id
    );
    assert.deepEqual(
      [
        storedDefault?.background_key,
        storedDefault?.font_key,
        storedDefault?.text_size_key,
        storedDefault?.text_alignment_key,
        storedDefault?.text_position_key,
      ],
      ["midnight", "rounded", "large", "trailing", "bottom"]
    );

    await assert.rejects(
      enqueueSenderLibraryMessage(
        admin,
        owner.data.user.id,
        foreignNecklace.id,
        firstTemplate.id,
        "up_next"
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 403
    );
    for (const missingId of [reserveOnly.id, inactive.id, randomUUID()]) {
      await assert.rejects(
        enqueueSenderLibraryMessage(
          admin,
          owner.data.user.id,
          ownedNecklace.id,
          missingId,
          "up_next"
        ),
        (error: unknown) => error instanceof SenderApiError && error.status === 404
      );
    }
    await assert.rejects(
      enqueueSenderLibraryMessage(
        admin,
        owner.data.user.id,
        ownedNecklace.id,
        secondTemplate.id,
        "up_next"
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );

    const revealForHint = await admin
      .from("necklace_lumis")
      .update({ revealed_at: new Date().toISOString() })
      .eq("id", reserveLumi.lumi.id);
    assert.ifError(revealForHint.error);

    const changed = await admin
      .from("messages")
      .update({
        text: `${marker} edited later`,
        content: `${marker} edited later`,
        is_explore_published: false,
        background_key: "lavender",
        font_key: "typewriter",
        text_size_key: "small",
        text_alignment_key: "leading",
        text_position_key: "top",
      })
      .eq("id", firstTemplate.id);
    assert.ifError(changed.error);
    const snapshot = await admin
      .from("necklace_lumis")
      .select(
        "content, background_key, font_key, text_size_key, text_alignment_key, text_position_key"
      )
      .eq("id", defaultLumi.lumi.id)
      .single();
    assert.ifError(snapshot.error);
    assert.equal(snapshot.data.content, templateRows[0].text);
    assert.equal(snapshot.data.background_key, "midnight");
    assert.equal(snapshot.data.font_key, "rounded");
    assert.equal(snapshot.data.text_size_key, "large");
    assert.equal(snapshot.data.text_alignment_key, "trailing");
    assert.equal(snapshot.data.text_position_key, "bottom");

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
    assert.equal(used?.wasRecentlyRevealed, true);
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
