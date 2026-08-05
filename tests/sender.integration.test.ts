import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import { PATCH as patchSenderLumi } from "../app/api/sender/necklaces/[necklaceId]/lumis/[lumiId]/route";
import { POST as postSenderLumi } from "../app/api/sender/necklaces/[necklaceId]/lumis/route";
import { POST as postSharedLumi } from "../app/api/sender/necklaces/[necklaceId]/lumis/from-share/route";
import { POST as postQueueMutation } from "../app/api/sender/necklaces/[necklaceId]/queue/mutations/route";
import {
  editSenderLumi,
  enqueueSenderLumi,
  listSenderNecklaces,
  mutateSenderQueue,
  normalizeLumiPresentation,
  normalizeLumiText,
  removeSenderLumi,
  SenderApiError,
} from "../lib/sender/necklaces";

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
  const { data: insertedLumis, error: lumiError } = await admin
    .from("necklace_lumis")
    .insert([
      {
      necklace_id: primary.id,
      author_user_id: ownerData.user.id,
      content: "First queued Lumi",
      queue_position: 1,
      queue_section: "current",
      is_enabled: true,
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
      text_size_key: "large",
      text_alignment_key: "leading",
      text_position_key: "bottom",
      },
      {
      necklace_id: primary.id,
      author_user_id: ownerData.user.id,
      content: "Second queued Lumi",
      queue_position: 1,
      queue_section: "up_next",
      is_enabled: true,
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
      text_size_key: "medium",
      text_alignment_key: "center",
      text_position_key: "center",
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        necklace_id: primary.id,
        author_user_id: ownerData.user.id,
        content: `Revealed Lumi ${index + 1}`,
        queue_position: index + 3,
        is_enabled: true,
        revealed_at: new Date(revealedBase + index * 1_000).toISOString(),
        theme_key: "heart",
        animation_key: "breathe",
        sound_key: "soft",
        text_size_key: "medium",
        text_alignment_key: "center",
        text_position_key: "center",
      })),
      {
        necklace_id: other.id,
        author_user_id: otherData.user.id,
        content: "Other sender private response Lumi",
        queue_position: 1,
        is_enabled: true,
        revealed_at: new Date(revealedBase + 10_000).toISOString(),
        theme_key: "heart",
        animation_key: "breathe",
        sound_key: "soft",
        text_size_key: "medium",
        text_alignment_key: "center",
        text_position_key: "center",
      },
    ])
    .select("id, necklace_id, content, revealed_at");

  if (lumiError || !insertedLumis) {
    throw new Error(lumiError?.message ?? "Failed to create Lumis");
  }

  const ownerFeedbackLumi = insertedLumis.find(
    (lumi) => lumi.content === "Revealed Lumi 6"
  );
  const otherFeedbackLumi = insertedLumis.find(
    (lumi) => lumi.content === "Other sender private response Lumi"
  );
  assert.ok(ownerFeedbackLumi?.revealed_at);
  assert.ok(otherFeedbackLumi?.revealed_at);

  const ownerSessionId = randomUUID();
  const otherSessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { error: sessionError } = await admin
    .from("lumi_reveal_sessions")
    .insert([
      {
        id: ownerSessionId,
        necklace_id: primary.id,
        necklace_lumi_id: ownerFeedbackLumi.id,
        source_type: "personal",
        expires_at: expiresAt,
        completed_at: ownerFeedbackLumi.revealed_at,
        revealed_at: ownerFeedbackLumi.revealed_at,
      },
      {
        id: otherSessionId,
        necklace_id: other.id,
        necklace_lumi_id: otherFeedbackLumi.id,
        source_type: "personal",
        expires_at: expiresAt,
        completed_at: otherFeedbackLumi.revealed_at,
        revealed_at: otherFeedbackLumi.revealed_at,
      },
    ]);
  if (sessionError) throw new Error(sessionError.message);

  const feedbackAt = new Date(revealedBase + 20_000).toISOString();
  const { error: feedbackError } = await admin
    .from("lumi_reveal_feedback")
    .insert([
      {
        necklace_lumi_id: ownerFeedbackLumi.id,
        reveal_session_id: ownerSessionId,
        reaction_key: "touched",
        reacted_at: feedbackAt,
        response_text: "Thank you for this.",
        responded_at: feedbackAt,
      },
      {
        necklace_lumi_id: otherFeedbackLumi.id,
        reveal_session_id: otherSessionId,
        reaction_key: "heart",
        reacted_at: feedbackAt,
        response_text: "Private response for another sender.",
        responded_at: feedbackAt,
      },
    ]);
  if (feedbackError) {
    await cleanupFixture({
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
    });
    throw new Error(feedbackError.message);
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

async function ownerAccessToken(fixture: Fixture) {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.ownerEmail,
    password: fixture.ownerPassword,
  });
  if (error || !data.session) {
    throw new Error(error?.message ?? "Failed to authenticate sender fixture");
  }
  return data.session.access_token;
}

async function otherAccessToken(fixture: Fixture) {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.otherEmail,
    password: fixture.otherPassword,
  });
  if (error || !data.session) {
    throw new Error(error?.message ?? "Failed to authenticate other fixture");
  }
  return data.session.access_token;
}

async function hasSharedLinkSchema() {
  const { error } = await admin
    .from("necklace_lumis")
    .select(
      "client_request_id, external_url, external_provider, external_content_kind"
    )
    .limit(1);
  return !error;
}

function sharedLumiRequest(
  necklaceId: string,
  token: string,
  body: unknown
) {
  return postSharedLumi(
    new Request(
      `http://localhost/api/sender/necklaces/${necklaceId}/lumis/from-share`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ necklaceId }) }
  );
}

test("sender create and edit routes validate and atomically persist presentation", async () => {
  const fixture = await createFixture();

  try {
    const token = await ownerAccessToken(fixture);
    const post = (body: unknown) =>
      postSenderLumi(
        new Request(
          `http://localhost/api/sender/necklaces/${fixture.secondaryNecklaceId}/lumis`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }
        ),
        { params: Promise.resolve({ necklaceId: fixture.secondaryNecklaceId }) }
      );

    const defaultResponse = await post({ text: "Default layout payload" });
    assert.equal(defaultResponse.status, 201);
    const defaultBody = (await defaultResponse.json()) as {
      lumi: { presentation: Record<string, string> };
    };
    assert.deepEqual(defaultBody.lumi.presentation, {
      theme: "heart",
      animation: "breathe",
      sound: "soft",
      revealPreset: "wordRise",
      background: "heart",
      font: "serif",
      textSize: "medium",
      textAlignment: "center",
      textPosition: "center",
    });

    const styledResponse = await post({
      text: "Styled payload",
      destination: "reserve",
      presentation: {
        background: "midnight",
        font: "rounded",
        textSize: "large",
        textAlignment: "trailing",
        textPosition: "bottom",
      },
    });
    assert.equal(styledResponse.status, 201);
    const styledBody = (await styledResponse.json()) as {
      lumi: {
        id: string;
        presentation: {
          background: string;
          font: string;
          textSize: string;
          textAlignment: string;
          textPosition: string;
        };
      };
      queue: { revision: number; reserve: Array<{ id: string }> };
    };
    assert.equal(styledBody.lumi.presentation.background, "midnight");
    assert.equal(styledBody.lumi.presentation.font, "rounded");
    assert.equal(styledBody.lumi.presentation.textSize, "large");
    assert.equal(styledBody.lumi.presentation.textAlignment, "trailing");
    assert.equal(styledBody.lumi.presentation.textPosition, "bottom");
    assert.deepEqual(
      styledBody.queue.reserve.map((lumi) => lumi.id),
      [styledBody.lumi.id]
    );

    assert.equal(
      (
        await post({
          text: "Bad background",
          destination: "up_next",
          presentation: { background: "#fff" },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await post({
          text: "Bad size",
          destination: "up_next",
          presentation: { textSize: "72px" },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await post({
          text: "Bad alignment",
          destination: "up_next",
          presentation: { textAlignment: "justify" },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await post({
          text: "Bad position",
          destination: "up_next",
          presentation: { textPosition: "25%" },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await post({
          text: "Bad font",
          destination: "up_next",
          presentation: { font: "Comic Sans" },
        })
      ).status,
      400
    );

    const patchResponse = await patchSenderLumi(
      new Request(
        `http://localhost/api/sender/necklaces/${fixture.secondaryNecklaceId}/lumis/${styledBody.lumi.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Styled and edited",
            presentation: {
              background: "rose",
              font: "serif",
              textSize: "small",
              textAlignment: "leading",
              textPosition: "top",
            },
          }),
        }
      ),
      {
        params: Promise.resolve({
          necklaceId: fixture.secondaryNecklaceId,
          lumiId: styledBody.lumi.id,
        }),
      }
    );
    assert.equal(patchResponse.status, 200);
    const patchBody = (await patchResponse.json()) as {
      lumi: {
        id: string;
        presentation: {
          textSize: string;
          textAlignment: string;
          textPosition: string;
        };
      };
      queue: {
        revision: number;
        current: null;
        reserve: Array<{ id: string }>;
      };
    };
    assert.equal(patchBody.lumi.id, styledBody.lumi.id);
    assert.equal(patchBody.lumi.presentation.textSize, "small");
    assert.equal(patchBody.lumi.presentation.textAlignment, "leading");
    assert.equal(patchBody.lumi.presentation.textPosition, "top");
    assert.equal(
      patchBody.queue.reserve.some((lumi) => lumi.id === styledBody.lumi.id),
      true
    );
    assert.equal(patchBody.queue.current, null);

    const stored = await admin
      .from("necklace_lumis")
      .select(
        "content, theme_key, background_key, font_key, text_size_key, text_alignment_key, text_position_key"
      )
      .eq("id", styledBody.lumi.id)
      .single();
    assert.ifError(stored.error);
    assert.deepEqual(stored.data, {
      content: "Styled and edited",
      theme_key: "rose",
      background_key: "rose",
      font_key: "serif",
      text_size_key: "small",
      text_alignment_key: "leading",
      text_position_key: "top",
    });

    const textOnlyResponse = await patchSenderLumi(
      new Request(
        `http://localhost/api/sender/necklaces/${fixture.secondaryNecklaceId}/lumis/${styledBody.lumi.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: "Text-only edit" }),
        }
      ),
      {
        params: Promise.resolve({
          necklaceId: fixture.secondaryNecklaceId,
          lumiId: styledBody.lumi.id,
        }),
      }
    );
    assert.equal(textOnlyResponse.status, 200);
    const textOnlyBody = (await textOnlyResponse.json()) as {
      lumi: {
        text: string;
        presentation: Record<string, string>;
      };
    };
    assert.equal(textOnlyBody.lumi.text, "Text-only edit");
    assert.deepEqual(
      textOnlyBody.lumi.presentation,
      patchBody.lumi.presentation
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

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
    assert.equal(necklaces[0].nextLumi?.presentation.background, "heart");
    assert.equal(necklaces[0].nextLumi?.presentation.font, "serif");
    assert.equal(necklaces[0].nextLumi?.presentation.textSize, "large");
    assert.equal(necklaces[0].nextLumi?.presentation.textAlignment, "leading");
    assert.equal(necklaces[0].nextLumi?.presentation.textPosition, "bottom");
    assert.deepEqual(
      necklaces[0].queue.upNext.map((lumi) => lumi.text),
      ["Second queued Lumi"]
    );
    assert.deepEqual(necklaces[0].nextLumi, necklaces[0].queue.current);
    assert.equal(necklaces[0].availableLumiCount, 2);
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
    const revealedFeedback = necklaces[0].recentlyRevealed[0].feedback;
    assert.ok(revealedFeedback);
    assert.equal(revealedFeedback.reaction, "touched");
    assert.equal(revealedFeedback.responseText, "Thank you for this.");
    assert.equal(
      new Date(revealedFeedback.reactionAt!).toISOString(),
      revealedFeedback.reactionAt
    );
    assert.equal(
      new Date(revealedFeedback.respondedAt!).toISOString(),
      revealedFeedback.respondedAt
    );
    assert.equal(necklaces[0].recentlyRevealed[1].feedback, null);
    assert.equal(
      JSON.stringify(necklaces).includes("Private response for another sender."),
      false
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

    const [browserEnqueue, browserEdit, browserLibraryEnqueue, browserResolve] =
      await Promise.all([
        ownerClient.rpc("enqueue_necklace_lumi_for_sender", {
          p_user_id: fixture.ownerId,
          p_necklace_id: fixture.primaryNecklaceId,
          p_content: "Browser roles cannot invoke definer RPCs",
          p_destination: "up_next",
          p_text_size_key: "large",
          p_text_alignment_key: "center",
          p_text_position_key: "bottom",
        }),
        ownerClient.rpc("edit_necklace_lumi_for_sender", {
          p_user_id: fixture.ownerId,
          p_necklace_id: fixture.primaryNecklaceId,
          p_lumi_id: necklaces[0].queue.current!.id,
          p_content: "Forbidden browser edit",
          p_text_size_key: "small",
          p_text_alignment_key: "leading",
          p_text_position_key: "top",
        }),
        ownerClient.rpc("enqueue_library_message_for_sender", {
          p_user_id: fixture.ownerId,
          p_necklace_id: fixture.primaryNecklaceId,
          p_message_id: randomUUID(),
          p_destination: "reserve",
        }),
        ownerClient.rpc("resolve_next_necklace_lumi", {
          p_token_hash: fixture.primaryTokenHash,
        }),
      ]);
    for (const result of [
      browserEnqueue,
      browserEdit,
      browserLibraryEnqueue,
      browserResolve,
    ]) {
      assert.ok(result.error);
    }

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
      enqueueSenderLumi(
        admin,
        fixture.ownerId,
        fixture.secondaryNecklaceId,
        "One",
        "up_next"
      ),
      enqueueSenderLumi(
        admin,
        fixture.ownerId,
        fixture.secondaryNecklaceId,
        "Two",
        "up_next"
      ),
    ]);
    assert.deepEqual(
      [first.lumi.queuePosition, second.lumi.queuePosition].sort(),
      [1, 2]
    );
    assert.equal(first.lumi.presentation.background, "heart");
    assert.equal(first.lumi.presentation.font, "serif");

    const customized = await enqueueSenderLumi(
      admin,
      fixture.ownerId,
      fixture.secondaryNecklaceId,
      "Styled",
      "reserve",
      normalizeLumiPresentation({ background: "champagne", font: "rounded" })
    );
    assert.equal(customized.lumi.presentation.background, "champagne");
    assert.equal(customized.lumi.presentation.font, "rounded");

    await assert.rejects(
      enqueueSenderLumi(
        admin,
        fixture.ownerId,
        fixture.otherNecklaceId,
        "Forbidden",
        "up_next"
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 403
    );
    await assert.rejects(
      enqueueSenderLumi(
        admin,
        fixture.ownerId,
        randomUUID(),
        "Missing",
        "up_next"
      ),
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

test("sender queue mutations preserve section order, revisions, and current immutability", async () => {
  const fixture = await createFixture();

  try {
    const initial = await listSenderNecklaces(admin, fixture.ownerId);
    const primary = initial.find((necklace) => necklace.id === fixture.primaryNecklaceId);
    assert.ok(primary);
    assert.ok(primary.queue.current);
    const current = primary.queue.current;
    const second = primary.queue.upNext[0];
    const thirdResult = await enqueueSenderLumi(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      "Third queued Lumi",
      "up_next",
      normalizeLumiPresentation({
        textSize: "large",
        textAlignment: "trailing",
        textPosition: "bottom",
      })
    );
    const third = thirdResult.lumi;

    await assert.rejects(
      mutateSenderQueue(
        admin,
        fixture.ownerId,
        fixture.primaryNecklaceId,
        thirdResult.queue.revision,
        randomUUID(),
        {
          type: "reorder",
          section: "up_next",
          orderedMessageIds: [third.id],
        }
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );

    const reordered = await mutateSenderQueue(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      thirdResult.queue.revision,
      randomUUID(),
      {
        type: "reorder",
        section: "up_next",
        orderedMessageIds: [third.id, second.id],
      }
    );
    assert.equal(reordered.stale, false);
    assert.deepEqual(
      reordered.queue.upNext.map((lumi) => lumi.id),
      [third.id, second.id]
    );
    assert.deepEqual(
      reordered.queue.upNext[0].presentation,
      third.presentation
    );
    assert.equal(reordered.queue.current?.id, current.id);

    const edited = await editSenderLumi(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      second.id,
      "Updated second Lumi",
      normalizeLumiPresentation({
        background: "rose",
        font: "serif",
        textSize: "small",
        textAlignment: "trailing",
        textPosition: "top",
      })
    );
    assert.equal(edited.lumi.text, "Updated second Lumi");
    assert.equal(edited.lumi.presentation.background, "rose");
    assert.equal(edited.lumi.presentation.textSize, "small");
    assert.equal(edited.lumi.presentation.textAlignment, "trailing");
    assert.equal(edited.lumi.presentation.textPosition, "top");
    assert.deepEqual(
      edited.queue.upNext.find((lumi) => lumi.id === second.id)?.presentation,
      edited.lumi.presentation
    );

    await assert.rejects(
      editSenderLumi(
        admin,
        fixture.ownerId,
        fixture.primaryNecklaceId,
        current.id,
        "Current cannot change"
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );
    await assert.rejects(
      removeSenderLumi(
        admin,
        fixture.ownerId,
        fixture.primaryNecklaceId,
        current.id
      ),
      (error: unknown) => error instanceof SenderApiError && error.status === 409
    );

    const moved = await mutateSenderQueue(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      edited.queue.revision,
      randomUUID(),
      {
        type: "move",
        messageId: third.id,
        section: "up_next",
        destination: "reserve",
        placement: "first",
      }
    );
    assert.deepEqual(moved.queue.upNext.map((lumi) => lumi.id), [second.id]);
    assert.deepEqual(moved.queue.reserve.map((lumi) => lumi.id), [third.id]);

    const idempotencyKey = randomUUID();
    const removed = await mutateSenderQueue(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      moved.queue.revision,
      idempotencyKey,
      { type: "remove", messageId: second.id, section: "up_next" }
    );
    assert.deepEqual(removed.queue.upNext, []);
    const retry = await mutateSenderQueue(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      moved.queue.revision,
      idempotencyKey,
      { type: "remove", messageId: second.id, section: "up_next" }
    );
    assert.deepEqual(retry.queue, removed.queue);

    const stale = await mutateSenderQueue(
      admin,
      fixture.ownerId,
      fixture.primaryNecklaceId,
      moved.queue.revision,
      randomUUID(),
      {
        type: "reorder",
        section: "reserve",
        orderedMessageIds: [third.id],
      }
    );
    assert.equal(stale.stale, true);
    assert.equal(stale.queue.revision, removed.queue.revision);

    const token = await ownerAccessToken(fixture);
    const staleResponse = await postQueueMutation(
      new Request(
        `http://localhost/api/sender/necklaces/${fixture.primaryNecklaceId}/queue/mutations`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expectedRevision: moved.queue.revision,
            idempotencyKey: randomUUID(),
            operation: {
              type: "reorder",
              section: "reserve",
              orderedMessageIds: [third.id],
            },
          }),
        }
      ),
      { params: Promise.resolve({ necklaceId: fixture.primaryNecklaceId }) }
    );
    assert.equal(staleResponse.status, 409);
    const staleBody = (await staleResponse.json()) as {
      queue: { revision: number };
    };
    assert.equal(staleBody.queue.revision, removed.queue.revision);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("concurrent queue mutations allow one revision winner", async () => {
  const fixture = await createFixture();

  try {
    const one = await enqueueSenderLumi(
      admin,
      fixture.ownerId,
      fixture.secondaryNecklaceId,
      "One",
      "up_next"
    );
    const two = await enqueueSenderLumi(
      admin,
      fixture.ownerId,
      fixture.secondaryNecklaceId,
      "Two",
      "up_next"
    );
    const revision = two.queue.revision;
    const results = await Promise.all([
      mutateSenderQueue(
        admin,
        fixture.ownerId,
        fixture.secondaryNecklaceId,
        revision,
        randomUUID(),
        {
          type: "reorder",
          section: "up_next",
          orderedMessageIds: [two.lumi.id, one.lumi.id],
        }
      ),
      mutateSenderQueue(
        admin,
        fixture.ownerId,
        fixture.secondaryNecklaceId,
        revision,
        randomUUID(),
        {
          type: "reorder",
          section: "up_next",
          orderedMessageIds: [one.lumi.id, two.lumi.id],
        }
      ),
    ]);
    assert.equal(results.filter((result) => result.stale).length, 1);
    assert.equal(results.filter((result) => !result.stale).length, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("Share to Lumi creates, replays, and preserves Instagram attachments", async () => {
  if (!(await hasSharedLinkSchema())) {
    console.log("[sender] shared-link migration not found; skipping live assertions.");
    return;
  }
  const fixture = await createFixture();

  try {
    const [token, otherToken] = await Promise.all([
      ownerAccessToken(fixture),
      otherAccessToken(fixture),
    ]);
    const clientRequestId = randomUUID();
    const payload = {
      clientRequestId,
      url: "https://www.instagram.com/reel/example/?igsh=private&utm_source=share",
    };

    assert.equal(
      (
        await sharedLumiRequest(fixture.secondaryNecklaceId, token, {
          ...payload,
          preview: { title: "Untrusted metadata" },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await sharedLumiRequest(fixture.secondaryNecklaceId, token, {
          ...payload,
          url: "https://instagram.com.attacker.example/reel/example/",
        })
      ).status,
      400
    );

    const createdResponse = await sharedLumiRequest(
      fixture.secondaryNecklaceId,
      token,
      payload
    );
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as {
      lumi: {
        id: string;
        text: string;
        attachment: {
          contentKind: string;
          url: string;
          provider: string;
        };
      };
      queue: {
        revision: number;
        upNext: Array<{ id: string; attachment?: object }>;
        reserve: Array<{ id: string; attachment?: object }>;
      };
      idempotentReplay: boolean;
    };
    assert.equal(created.idempotentReplay, false);
    assert.equal(created.lumi.text, "This made me think of you.");
    assert.deepEqual(created.lumi.attachment, {
      type: "link",
      provider: "instagram",
      contentKind: "reel",
      url: "https://instagram.com/reel/example/",
      host: "instagram.com",
      ctaLabel: "View on Instagram",
      openMode: "external",
    });
    assert.equal(created.queue.upNext[0].id, created.lumi.id);
    assert.deepEqual(created.queue.upNext[0].attachment, created.lumi.attachment);

    const replayResponse = await sharedLumiRequest(
      fixture.secondaryNecklaceId,
      token,
      payload
    );
    assert.equal(replayResponse.status, 200);
    const replay = (await replayResponse.json()) as typeof created;
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.lumi.id, created.lumi.id);
    assert.equal(replay.queue.revision, created.queue.revision);

    const [{ count }, revision] = await Promise.all([
      admin
        .from("necklace_lumis")
        .select("id", { count: "exact", head: true })
        .eq("author_user_id", fixture.ownerId)
        .eq("client_request_id", clientRequestId),
      admin
        .from("necklaces")
        .select("queue_revision")
        .eq("id", fixture.secondaryNecklaceId)
        .single(),
    ]);
    assert.equal(count, 1);
    assert.ifError(revision.error);
    assert.equal(revision.data.queue_revision, created.queue.revision);

    assert.equal(
      (
        await sharedLumiRequest(fixture.secondaryNecklaceId, token, {
          ...payload,
          url: "https://instagram.com/p/different/",
        })
      ).status,
      409
    );
    assert.equal(
      (
        await sharedLumiRequest(fixture.primaryNecklaceId, otherToken, {
          ...payload,
          clientRequestId: randomUUID(),
        })
      ).status,
      403
    );

    const reserveResponse = await sharedLumiRequest(
      fixture.secondaryNecklaceId,
      token,
      {
        clientRequestId: randomUUID(),
        url: "https://instagram.com/p/post-id/",
        text: "Custom text",
        destination: "reserve",
        presentation: {
          background: "midnight",
          font: "rounded",
          textSize: "large",
          textAlignment: "trailing",
          textPosition: "bottom",
        },
      }
    );
    assert.equal(reserveResponse.status, 201);
    const reserve = (await reserveResponse.json()) as typeof created;
    assert.equal(reserve.lumi.text, "Custom text");
    assert.equal(reserve.queue.reserve[0].id, reserve.lumi.id);

    const moved = await mutateSenderQueue(
      admin,
      fixture.ownerId,
      fixture.secondaryNecklaceId,
      reserve.queue.revision,
      randomUUID(),
      {
        type: "move",
        messageId: reserve.lumi.id,
        section: "reserve",
        destination: "up_next",
        placement: "last",
      }
    );
    assert.deepEqual(
      moved.queue.upNext.find((lumi) => lumi.id === reserve.lumi.id)?.attachment,
      reserve.lumi.attachment
    );

    await admin
      .from("necklaces")
      .update({ lifecycle_status: "inactive" })
      .eq("id", fixture.secondaryNecklaceId);
    assert.equal(
      (
        await sharedLumiRequest(fixture.secondaryNecklaceId, token, {
          ...payload,
          clientRequestId: randomUUID(),
        })
      ).status,
      409
    );
  } finally {
    await cleanupFixture(fixture);
  }
});
