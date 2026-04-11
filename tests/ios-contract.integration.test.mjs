import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.LUMI_BASE_URL ?? "http://localhost:3000";
const ACTIVATION_CODE = process.env.LUMI_TEST_ACTIVATION_CODE ?? "LUMI-TEST-0001";

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

const BASE_PACKAGE_SEED = [
  { id: "love", title: "Love", text: "You are deeply loved." },
  { id: "motivation", title: "Motivation", text: "You can do hard things." },
  { id: "calm", title: "Calm", text: "Breathe in peace, breathe out tension." },
];

function assertExactKeys(value, expectedKeys, message) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expectedKeys].sort(),
    message
  );
}

function randomEmail() {
  const randomChunk = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `lumiappclip${randomChunk}@gmail.com`;
}

function toActivationCodeHash(code) {
  return createHash("sha256")
    .update(code.trim().toUpperCase())
    .digest("hex");
}

function requireAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY for integration tests"
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
}

async function apiRequest(path, options = {}) {
  const {
    token,
    jsonBody,
    method = "GET",
    headers: extraHeaders = {},
    cookie,
  } = options;

  const headers = { ...extraHeaders };
  if (jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const setCookie = response.headers.get("set-cookie");

  return { status: response.status, body, setCookie };
}

async function ensureRpcFunctionsReady() {
  const admin = requireAdminClient();
  const { error } = await admin.rpc("reserve_activation_code", {
    p_activation_code_hash: "non-existent-hash",
    p_claim_token_hash: "non-existent-token-hash",
    p_reserved_until: new Date(Date.now() + 1_800_000).toISOString(),
    p_reserved_by_session: "integration-test-check",
  });

  if (error) {
    throw new Error(
      `reserve_activation_code RPC is not available. Apply migration before running tests. Error: ${error.message}`
    );
  }
}

async function ensureTapSeedData() {
  const admin = requireAdminClient();

  const { error: packageUpsertError } = await admin
    .from("packages")
    .upsert(
      BASE_PACKAGE_SEED.map((pkg) => ({
        id: pkg.id,
        title: pkg.title,
        is_premium: false,
      })),
      { onConflict: "id" }
    );

  if (packageUpsertError) {
    throw new Error(`Failed to upsert packages: ${packageUpsertError.message}`);
  }

  const packageIds = BASE_PACKAGE_SEED.map((pkg) => pkg.id);
  const messageTexts = BASE_PACKAGE_SEED.map((pkg) => pkg.text);

  const { data: existingMessages, error: existingMessagesError } = await admin
    .from("messages")
    .select("package_id, text")
    .in("package_id", packageIds)
    .in("text", messageTexts);

  if (existingMessagesError) {
    throw new Error(
      `Failed to query existing messages: ${existingMessagesError.message}`
    );
  }

  const existingKeys = new Set(
    (existingMessages ?? []).map((row) => `${row.package_id}::${row.text}`)
  );

  const rowsToInsert = BASE_PACKAGE_SEED.filter(
    (pkg) => !existingKeys.has(`${pkg.id}::${pkg.text}`)
  ).map((pkg) => ({
    package_id: pkg.id,
    text: pkg.text,
    is_active: true,
  }));

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await admin.from("messages").insert(rowsToInsert);
    if (insertError) {
      throw new Error(`Failed to seed messages: ${insertError.message}`);
    }
  }
}

async function getTagByActivationCode(code) {
  const admin = requireAdminClient();
  const activationCodeHash = toActivationCodeHash(code);

  const { data, error } = await admin
    .from("tags")
    .select("tag_id")
    .eq("activation_code_hash", activationCodeHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to query tag by activation code: ${error.message}`);
  }

  if (!data?.tag_id) {
    throw new Error(`Activation code not found in tags table: ${code}`);
  }

  return data.tag_id;
}

async function resetTagToUnclaimed(code) {
  const admin = requireAdminClient();
  const tagId = await getTagByActivationCode(code);

  const { error } = await admin
    .from("tags")
    .update({
      status: "unclaimed",
      owner_user_id: null,
      claimed_at: null,
      reserved_until: null,
      reserved_by_session: null,
      claim_token_hash: null,
      claimed_token_hash: null,
    })
    .eq("tag_id", tagId);

  if (error) {
    throw new Error(`Failed to reset tag to unclaimed: ${error.message}`);
  }
}

async function markTagClaimedByUser(code, ownerUserId) {
  const admin = requireAdminClient();
  const tagId = await getTagByActivationCode(code);

  const { error } = await admin
    .from("tags")
    .update({
      status: "claimed",
      owner_user_id: ownerUserId,
      claimed_at: new Date().toISOString(),
      reserved_until: null,
      reserved_by_session: null,
      claim_token_hash: null,
      claimed_token_hash: null,
    })
    .eq("tag_id", tagId);

  if (error) {
    throw new Error(`Failed to mark tag claimed: ${error.message}`);
  }
}

async function expireReservationForToken(claimToken) {
  const admin = requireAdminClient();
  const claimTokenHash = createHash("sha256").update(claimToken).digest("hex");

  const { error } = await admin
    .from("tags")
    .update({
      reserved_until: new Date(Date.now() - 60_000).toISOString(),
    })
    .eq("claim_token_hash", claimTokenHash)
    .eq("status", "reserved");

  if (error) {
    throw new Error(`Failed to expire reservation: ${error.message}`);
  }
}

async function provisionUserAndSignIn() {
  const admin = requireAdminClient();
  const email = randomEmail();
  const password = `LumiPass!${Date.now()}`;

  const { error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createUserError) {
    throw new Error(`Failed to provision user: ${createUserError.message}`);
  }

  const signin = await apiRequest("/api/auth/signin", {
    method: "POST",
    jsonBody: { email, password },
  });

  assert.equal(
    signin.status,
    200,
    `Signin failed with ${signin.status}. Body: ${JSON.stringify(signin.body)}`
  );

  const me = await apiRequest("/api/auth/me", {
    token: signin.body?.session?.accessToken,
  });
  assert.equal(
    me.status,
    200,
    `Me lookup failed with ${me.status}. Body: ${JSON.stringify(me.body)}`
  );

  return {
    email,
    accessToken: signin.body?.session?.accessToken,
    userId: me.body?.user?.id,
  };
}

test("public activate success", async () => {
  await ensureRpcFunctionsReady();
  await ensureTapSeedData();
  await resetTagToUnclaimed(ACTIVATION_CODE);

  const activate = await apiRequest("/api/activate", {
    method: "POST",
    jsonBody: { activationCode: ACTIVATION_CODE },
  });

  assert.equal(
    activate.status,
    200,
    `Expected 200, got ${activate.status}. Body: ${JSON.stringify(activate.body)}`
  );

  assertExactKeys(
    activate.body,
    ["success", "activation", "claim"],
    "Activate response keys do not match contract"
  );

  assert.equal(activate.body?.success, true);

  assertExactKeys(
    activate.body.activation,
    ["tagId", "sku", "necklaceName", "basePackageIDs"],
    "Activation object keys do not match contract"
  );

  assert.equal(typeof activate.body.activation.tagId, "string");
  assert.equal(typeof activate.body.activation.sku, "string");
  assert.equal(typeof activate.body.activation.necklaceName, "string");
  assert.ok(Array.isArray(activate.body.activation.basePackageIDs));

  assertExactKeys(
    activate.body.claim,
    ["status", "reservedUntil", "claimToken"],
    "Claim object keys do not match contract"
  );

  assert.equal(activate.body.claim.status, "reserved");
  assert.equal(typeof activate.body.claim.reservedUntil, "string");
  assert.equal(typeof activate.body.claim.claimToken, "string");
});

test("public activate invalid code", async () => {
  const activate = await apiRequest("/api/activate", {
    method: "POST",
    jsonBody: { activationCode: "bad" },
  });

  assert.equal(activate.status, 400, `Expected 400, got ${activate.status}`);
});

test("public activate already claimed", async () => {
  await ensureRpcFunctionsReady();

  const owner = await provisionUserAndSignIn();
  assert.equal(typeof owner.userId, "string");
  await markTagClaimedByUser(ACTIVATION_CODE, owner.userId);

  const activate = await apiRequest("/api/activate", {
    method: "POST",
    jsonBody: { activationCode: ACTIVATION_CODE },
  });

  assert.equal(activate.status, 409, `Expected 409, got ${activate.status}`);
});

test("claim token success with auth and tap works", async () => {
  await ensureRpcFunctionsReady();
  await ensureTapSeedData();
  await resetTagToUnclaimed(ACTIVATION_CODE);

  const activate = await apiRequest("/api/activate", {
    method: "POST",
    jsonBody: { activationCode: ACTIVATION_CODE },
  });
  assert.equal(activate.status, 200, `Activate failed with ${activate.status}`);

  const user = await provisionUserAndSignIn();

  const claim = await apiRequest("/api/activate/claim", {
    method: "POST",
    token: user.accessToken,
    jsonBody: { claimToken: activate.body.claim.claimToken },
  });

  assert.equal(claim.status, 200, `Claim failed with ${claim.status}`);
  assertExactKeys(
    claim.body,
    ["success", "tagId", "ownerUserId"],
    "Claim response keys do not match contract"
  );
  assert.equal(claim.body.success, true);
  assert.equal(typeof claim.body.tagId, "string");
  assert.equal(typeof claim.body.ownerUserId, "string");

  const tap = await apiRequest("/api/tap", { token: user.accessToken });
  assert.equal(tap.status, 200, `Tap after claim failed with ${tap.status}`);
});

test("claim token invalid and expired", async () => {
  await ensureRpcFunctionsReady();
  await resetTagToUnclaimed(ACTIVATION_CODE);

  const user = await provisionUserAndSignIn();

  const invalidClaim = await apiRequest("/api/activate/claim", {
    method: "POST",
    token: user.accessToken,
    jsonBody: { claimToken: "not-a-valid-token" },
  });
  assert.equal(invalidClaim.status, 400, `Expected 400, got ${invalidClaim.status}`);

  const activate = await apiRequest("/api/activate", {
    method: "POST",
    jsonBody: { activationCode: ACTIVATION_CODE },
  });
  assert.equal(activate.status, 200, `Activate failed with ${activate.status}`);

  await expireReservationForToken(activate.body.claim.claimToken);

  const expiredClaim = await apiRequest("/api/activate/claim", {
    method: "POST",
    token: user.accessToken,
    jsonBody: { claimToken: activate.body.claim.claimToken },
  });

  assert.equal(expiredClaim.status, 410, `Expected 410, got ${expiredClaim.status}`);
});

test("concurrent redemption safety", async () => {
  await ensureRpcFunctionsReady();
  await ensureTapSeedData();
  await resetTagToUnclaimed(ACTIVATION_CODE);

  const activate = await apiRequest("/api/activate", {
    method: "POST",
    jsonBody: { activationCode: ACTIVATION_CODE },
  });
  assert.equal(activate.status, 200, `Activate failed with ${activate.status}`);

  const userA = await provisionUserAndSignIn();
  const userB = await provisionUserAndSignIn();

  const [claimA, claimB] = await Promise.all([
    apiRequest("/api/activate/claim", {
      method: "POST",
      token: userA.accessToken,
      jsonBody: { claimToken: activate.body.claim.claimToken },
    }),
    apiRequest("/api/activate/claim", {
      method: "POST",
      token: userB.accessToken,
      jsonBody: { claimToken: activate.body.claim.claimToken },
    }),
  ]);

  const statuses = [claimA.status, claimB.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);
});
