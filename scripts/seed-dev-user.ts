import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const DEV_USER_EMAIL = "johnmccants002@gmail.com";
const DEV_USER_PASSWORD = process.env.LUMI_DEV_USER_PASSWORD?.trim() || "LumiDev002!";
const DEV_USER_DISPLAY_NAME = process.env.LUMI_DEV_USER_DISPLAY_NAME?.trim() || "John McCants";

const DEMO_ACTIVE_NECKLACE_TOKEN = "johnmccants-demo-token-active";
const DEMO_PENDING_NECKLACE_TOKEN = "johnmccants-demo-token-pending";

const DEMO_TIME = new Date();

const DEMO_IDS = {
  claimedOrderId: "a1111111-1111-4111-8111-111111111111",
  pendingOrderId: "a2222222-2222-4222-8222-222222222222",
  claimedOrderItemId: "a3333333-3333-4333-8333-333333333333",
  pendingOrderItemId: "a4444444-4444-4444-8444-444444444444",
  activeNecklaceId: "b1111111-1111-4111-8111-111111111111",
  pendingNecklaceId: "b2222222-2222-4222-8222-222222222222",
  activeOwnershipId: "c1111111-1111-4111-8111-111111111111",
  pendingOwnershipId: "c2222222-2222-4222-8222-222222222222",
  activeLumiOneId: "e1111111-1111-4111-8111-111111111111",
  activeLumiTwoId: "e2222222-2222-4222-8222-222222222222",
  activeLumiThreeId: "e3333333-3333-4333-8333-333333333333",
  pendingLumiOneId: "e4444444-4444-4444-8444-444444444444",
  pendingLumiTwoId: "e5555555-5555-4555-8555-555555555555",
} as const;

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
      .filter((entry): entry is [string, string] => Array.isArray(entry));

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

type DbError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

type UpsertOptions = {
  onConflict?: string;
};

type ProfileRow = {
  id: string;
  email: string;
  display_name?: string | null;
};

type OrderRow = {
  id: string;
  external_order_ref: string;
  purchaser_email_normalized: string;
  status: "pending_claim" | "claimed" | "fulfilled";
  created_at?: string;
  claimed_at?: string | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  sku: string;
  quantity: number;
  created_at?: string;
};

type NecklaceRow = {
  id: string;
  tag_ref: string;
  tap_token_hash: string;
  sku: string;
  name: string;
  theme_key: string;
  lifecycle_status: "pending_sender_setup" | "active" | "inactive";
  created_at?: string;
};

type OwnershipRow = {
  id: string;
  necklace_id: string;
  sender_user_id: string;
  source_order_id: string;
  claimed_at?: string;
  is_primary: boolean;
};

type LumiRow = {
  id: string;
  necklace_id: string;
  author_user_id: string;
  source_message_id: string | null;
  content: string;
  queue_position: number;
  is_enabled: boolean;
  eligible_from?: string | null;
  revealed_at?: string | null;
  theme_key?: string | null;
  animation_key?: string | null;
  sound_key?: string | null;
  created_at?: string;
  updated_at?: string;
};

const dotEnv = readDotEnvVars();

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  (typeof dotEnv.NEXT_PUBLIC_SUPABASE_URL === "string"
    ? dotEnv.NEXT_PUBLIC_SUPABASE_URL.trim()
    : "");
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  (typeof dotEnv.SUPABASE_SECRET_KEY === "string"
    ? dotEnv.SUPABASE_SECRET_KEY.trim()
    : "");

if (!supabaseUrl) {
  throw new Error("Missing required Supabase environment variable: NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabaseSecretKey) {
  throw new Error("Missing required Supabase environment variable: SUPABASE_SECRET_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function timeOffsetHours(hours: number): string {
  return new Date(DEMO_TIME.getTime() + hours * 3_600_000).toISOString();
}

function isMissingRelationError(error: DbError | null | undefined, tableName: string): boolean {
  const normalized = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  const lowerTable = tableName.toLowerCase();

  return (
    error?.code === "42P01" ||
    normalized.includes(`relation "public.${lowerTable}" does not exist`) ||
    normalized.includes(`relation "${lowerTable}" does not exist`) ||
    normalized.includes(`could not find the table 'public.${lowerTable}'`) ||
    normalized.includes(`could not find the table "${lowerTable}"`) ||
    normalized.includes(`could not find the table '${lowerTable}'`)
  );
}

function logMissingTable(tableName: string, action: string) {
  console.log(`[seed-dev-user] ${tableName} table does not exist yet; skipped ${action}.`);
}

async function seedDevUser() {
  const { data: usersData, error: listUsersError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listUsersError) {
    throw new Error(`Failed to list auth users: ${listUsersError.message}`);
  }

  const existingUser = usersData.users.find(
    (user) => typeof user.email === "string" && user.email.toLowerCase() === DEV_USER_EMAIL
  );

  if (existingUser) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
      password: DEV_USER_PASSWORD,
      email_confirm: true,
      user_metadata: {
        display_name: DEV_USER_DISPLAY_NAME,
      },
    });

    if (error) {
      throw new Error(`Failed to update existing dev user: ${error.message}`);
    }

    return { userId: data.user.id, created: false };
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: DEV_USER_EMAIL,
    password: DEV_USER_PASSWORD,
    email_confirm: true,
    user_metadata: {
      display_name: DEV_USER_DISPLAY_NAME,
    },
  });

  if (error) {
    throw new Error(`Failed to create dev user: ${error.message}`);
  }

  if (!data.user) {
    throw new Error("Dev user was not returned after creation");
  }

  return { userId: data.user.id, created: true };
}

async function upsertProfile(userId: string) {
  const profileWithDisplayName: ProfileRow = {
    id: userId,
    email: DEV_USER_EMAIL,
    display_name: DEV_USER_DISPLAY_NAME,
  };

  const { error } = await supabaseAdmin
    .from("profiles")
    .upsert(profileWithDisplayName, { onConflict: "id" });

  if (!error) {
    return;
  }

  if (isMissingRelationError(error, "profiles")) {
    logMissingTable("profiles", "profile insert");
    return;
  }

  if (error.code === "42703" || error.message?.includes("display_name")) {
    const { error: fallbackError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          email: DEV_USER_EMAIL,
        },
        { onConflict: "id" }
      );

    if (!fallbackError) {
      console.log("[seed-dev-user] profiles.display_name is not available; seeded email only.");
      return;
    }

    if (isMissingRelationError(fallbackError, "profiles")) {
      logMissingTable("profiles", "profile insert");
      return;
    }

    throw new Error(`Failed to upsert fallback profile row: ${fallbackError.message}`);
  }

  throw new Error(`Failed to upsert profile row: ${error.message}`);
}

async function upsertOrders(rows: OrderRow[]) {
  const { error } = await supabaseAdmin
    .from("orders")
    .upsert(rows, { onConflict: "external_order_ref" } satisfies UpsertOptions);

  if (!error) {
    return;
  }

  if (isMissingRelationError(error, "orders")) {
    logMissingTable("orders", "demo order rows");
    return;
  }

  throw new Error(`Failed to upsert orders: ${error.message}`);
}

async function upsertOrderItems(rows: OrderItemRow[]) {
  const { error } = await supabaseAdmin.from("order_items").upsert(rows, {
    onConflict: "id",
  });

  if (!error) {
    return;
  }

  if (isMissingRelationError(error, "order_items")) {
    logMissingTable("order_items", "demo order item rows");
    return;
  }

  throw new Error(`Failed to upsert order items: ${error.message}`);
}

async function upsertNecklaces(rows: NecklaceRow[]) {
  const { error } = await supabaseAdmin
    .from("necklaces")
    .upsert(rows, { onConflict: "tag_ref" } satisfies UpsertOptions);

  if (!error) {
    return;
  }

  if (isMissingRelationError(error, "necklaces")) {
    logMissingTable("necklaces", "demo necklace rows");
    return;
  }

  throw new Error(`Failed to upsert necklaces: ${error.message}`);
}

async function upsertOwnerships(rows: OwnershipRow[]) {
  const { error } = await supabaseAdmin
    .from("necklace_ownerships")
    .upsert(rows, { onConflict: "necklace_id" } satisfies UpsertOptions);

  if (!error) {
    return;
  }

  if (isMissingRelationError(error, "necklace_ownerships")) {
    logMissingTable("necklace_ownerships", "demo ownership rows");
    return;
  }

  throw new Error(`Failed to upsert necklace ownerships: ${error.message}`);
}

async function upsertLumis(rows: LumiRow[]) {
  const { error } = await supabaseAdmin.from("necklace_lumis").upsert(rows, {
    onConflict: "necklace_id,queue_position",
  });

  if (!error) {
    return;
  }

  if (isMissingRelationError(error, "necklace_lumis")) {
    logMissingTable("necklace_lumis", "demo lumis");
    return;
  }

  throw new Error(`Failed to upsert necklace lumis: ${error.message}`);
}

async function seedDemoGraph(userId: string) {
  const activeTapTokenHash = hashToken(DEMO_ACTIVE_NECKLACE_TOKEN);
  const pendingTapTokenHash = hashToken(DEMO_PENDING_NECKLACE_TOKEN);

  const claimedOrder: OrderRow = {
    id: DEMO_IDS.claimedOrderId,
    external_order_ref: "demo-johnmccants-claimed-001",
    purchaser_email_normalized: DEV_USER_EMAIL,
    status: "claimed",
    created_at: timeOffsetHours(-48),
    claimed_at: timeOffsetHours(-24),
  };

  const pendingOrder: OrderRow = {
    id: DEMO_IDS.pendingOrderId,
    external_order_ref: "demo-johnmccants-pending-001",
    purchaser_email_normalized: DEV_USER_EMAIL,
    status: "pending_claim",
    created_at: timeOffsetHours(-4),
    claimed_at: null,
  };

  await upsertOrders([claimedOrder, pendingOrder]);

  const necklaceRows: NecklaceRow[] = [
    {
      id: DEMO_IDS.activeNecklaceId,
      tag_ref: "demo-johnmccants-active-001",
      tap_token_hash: activeTapTokenHash,
      sku: "DEMO-JOHN-ACTIVE-001",
      name: "John's Keepsake Lumi",
      theme_key: "heart",
      lifecycle_status: "active",
      created_at: timeOffsetHours(-48),
    },
    {
      id: DEMO_IDS.pendingNecklaceId,
      tag_ref: "demo-johnmccants-pending-002",
      tap_token_hash: pendingTapTokenHash,
      sku: "DEMO-JOHN-PENDING-002",
      name: "John's Claimable Lumi",
      theme_key: "heart",
      lifecycle_status: "active",
      created_at: timeOffsetHours(-4),
    },
  ];

  await upsertNecklaces(necklaceRows);

  await upsertOrderItems([
    {
      id: DEMO_IDS.claimedOrderItemId,
      order_id: DEMO_IDS.claimedOrderId,
      sku: "DEMO-JOHN-ACTIVE-001",
      quantity: 1,
      created_at: timeOffsetHours(-48),
    },
    {
      id: DEMO_IDS.pendingOrderItemId,
      order_id: DEMO_IDS.pendingOrderId,
      sku: "DEMO-JOHN-PENDING-002",
      quantity: 1,
      created_at: timeOffsetHours(-4),
    },
  ]);

  await upsertOwnerships([
    {
      id: DEMO_IDS.activeOwnershipId,
      necklace_id: DEMO_IDS.activeNecklaceId,
      sender_user_id: userId,
      source_order_id: DEMO_IDS.claimedOrderId,
      claimed_at: timeOffsetHours(-24),
      is_primary: true,
    },
    {
      id: DEMO_IDS.pendingOwnershipId,
      necklace_id: DEMO_IDS.pendingNecklaceId,
      sender_user_id: userId,
      source_order_id: DEMO_IDS.pendingOrderId,
      claimed_at: timeOffsetHours(-4),
      is_primary: false,
    },
  ]);

  await upsertLumis([
    {
      id: DEMO_IDS.activeLumiOneId,
      necklace_id: DEMO_IDS.activeNecklaceId,
      author_user_id: userId,
      source_message_id: null,
      content: "You are loved more than you know.",
      queue_position: 1,
      is_enabled: true,
      eligible_from: timeOffsetHours(-12),
      revealed_at: null,
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
      created_at: timeOffsetHours(-12),
      updated_at: timeOffsetHours(-12),
    },
    {
      id: DEMO_IDS.activeLumiTwoId,
      necklace_id: DEMO_IDS.activeNecklaceId,
      author_user_id: userId,
      source_message_id: null,
      content: "I'm so glad you're here.",
      queue_position: 2,
      is_enabled: true,
      eligible_from: timeOffsetHours(-11),
      revealed_at: null,
      theme_key: "heart",
      animation_key: "shimmer",
      sound_key: "soft",
      created_at: timeOffsetHours(-11),
      updated_at: timeOffsetHours(-11),
    },
    {
      id: DEMO_IDS.activeLumiThreeId,
      necklace_id: DEMO_IDS.activeNecklaceId,
      author_user_id: userId,
      source_message_id: null,
      content: "Take your time. There is no rush here.",
      queue_position: 3,
      is_enabled: true,
      eligible_from: timeOffsetHours(24),
      revealed_at: null,
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
      created_at: timeOffsetHours(-10),
      updated_at: timeOffsetHours(-10),
    },
    {
      id: DEMO_IDS.pendingLumiOneId,
      necklace_id: DEMO_IDS.pendingNecklaceId,
      author_user_id: userId,
      source_message_id: null,
      content: "You can do this, one small step at a time.",
      queue_position: 1,
      is_enabled: true,
      eligible_from: timeOffsetHours(-2),
      revealed_at: null,
      theme_key: "heart",
      animation_key: "shimmer",
      sound_key: "soft",
      created_at: timeOffsetHours(-2),
      updated_at: timeOffsetHours(-2),
    },
    {
      id: DEMO_IDS.pendingLumiTwoId,
      necklace_id: DEMO_IDS.pendingNecklaceId,
      author_user_id: userId,
      source_message_id: null,
      content: "I'm right here with you.",
      queue_position: 2,
      is_enabled: true,
      eligible_from: timeOffsetHours(-2),
      revealed_at: null,
      theme_key: "heart",
      animation_key: "breathe",
      sound_key: "soft",
      created_at: timeOffsetHours(-2),
      updated_at: timeOffsetHours(-2),
    },
  ]);

  console.log("[seed-dev-user] Demo graph seeded:");
  console.log("  - linked necklaces: 2");
  console.log("  - queued Lumis: 5");
}

async function main() {
  const result = await seedDevUser();
  await upsertProfile(result.userId);
  await seedDemoGraph(result.userId);

  console.log(
    `[seed-dev-user] ${result.created ? "Created" : "Updated"} auth user ${DEV_USER_EMAIL}`
  );
}

main().catch((error) => {
  console.error("[seed-dev-user] Failed", error);
  process.exitCode = 1;
});
