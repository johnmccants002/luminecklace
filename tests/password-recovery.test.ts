import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { handlePasswordResetRequest, normalizedRecoveryEmail, parseRecoveryLink, saveRecoveryPassword, verifyRecoveryLink } from "../lib/auth/password-recovery";
import { POST } from "../app/api/auth/password/reset/route";
import { SITE_URL } from "../lib/config";

const request = (body: unknown) => new Request("https://luminecklace.com/api/auth/password/reset", { method: "POST", body: JSON.stringify(body) });

test("normalizes email and rejects malformed request bodies before sending", async () => {
  assert.equal(normalizedRecoveryEmail(" Buyer@Example.com "), "buyer@example.com");
  for (const body of [null, [], {}, { email: 42 }, { email: "" }, { email: "invalid" }, { email: "a b@example.com" }, { email: "a@@example.com" }, { email: "a@example." }, { email: "a".repeat(250) + "@example.com" }]) {
    const response = await handlePasswordResetRequest(request(body), async () => { assert.fail("must not send"); });
    assert.equal(response.status, 400);
  }
  const response = await handlePasswordResetRequest(new Request("https://example.test", { method: "POST", body: "{" }), async () => { assert.fail("must not send"); });
  assert.equal(response.status, 400);
});

test("known, missing, rate-limited and provider-failed accounts have the same public response", async () => {
  let expected: unknown;
  for (const error of [null, { code: "user_not_found" }, { code: "over_email_send_rate_limit" }, { code: "unexpected_failure" }]) {
    const response = await handlePasswordResetRequest(request({ email: " Buyer@Example.com " }), async (email) => {
      assert.equal(email, "buyer@example.com");
      return { error };
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    if (!expected) expected = body;
    assert.deepEqual(body, expected);
  }
});

test("unexpected transport/configuration failure allows a retry without leaking details", async () => {
  const response = await handlePasswordResetRequest(request({ email: "buyer@example.com" }), async () => { throw new Error("secret provider detail"); });
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /secret provider detail/);
});

test("route uses public Supabase recovery, a fixed callback and no browser-bound PKCE verifier", async () => {
  const priorURL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://recovery-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-public-key";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://recovery-test.supabase.co");
    assert.equal(url.pathname, "/auth/v1/recover");
    assert.equal(url.searchParams.get("redirect_to"), new URL("/auth/reset-password", SITE_URL).toString());
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.email, "buyer@example.com");
    assert.equal(body.code_challenge, null);
    return Response.json({});
  };
  try {
    const response = await POST(request({ email: "Buyer@example.com", redirectTo: "https://attacker.test" }));
    assert.equal(response.status, 202);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorURL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = priorURL;
    if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = priorKey;
  }
});

function authDouble(options: { invalid?: boolean; missingUser?: boolean; updateFails?: boolean } = {}) {
  const calls: unknown[] = [];
  const session = { access_token: "verified" };
  const auth = {
    verifyOtp: async (input: unknown) => { calls.push(["verifyOtp", input]); return { data: { session }, error: options.invalid ? new Error("expired") : null }; },
    setSession: async (input: unknown) => { calls.push(["setSession", input]); return { data: { session }, error: options.invalid ? new Error("expired") : null }; },
    getUser: async () => { calls.push(["getUser"]); return { data: { user: options.missingUser ? null : { email: "buyer@example.com" } }, error: null }; },
    updateUser: async (input: unknown) => { calls.push(["updateUser", input]); return { error: options.updateFails ? new Error("provider failure") : null }; },
  } as unknown as SupabaseClient["auth"];
  return { auth, calls };
}

test("only recovery links are accepted; ordinary sessions and invitation links cannot unlock form", async () => {
  for (const href of [
    "https://example.test/auth/reset-password",
    "https://example.test/auth/reset-password?type=invite&token_hash=hash",
    "https://example.test/auth/reset-password#type=signup&access_token=a&refresh_token=r",
    "https://example.test/auth/reset-password#type=recovery&access_token=a",
    "https://example.test/auth/reset-password#type=recovery&access_token=a&refresh_token=r&error_code=otp_expired",
    "https://example.test/auth/reset-password?error=access_denied#type=recovery&access_token=a&refresh_token=r",
  ]) {
    const { auth, calls } = authDouble();
    assert.equal(parseRecoveryLink(href), null);
    await assert.rejects(verifyRecoveryLink(auth, parseRecoveryLink(href)), /newest password-reset link/);
    assert.equal(calls.length, 0);
  }
});

test("default email redirect verifies the recovery session with Auth before allowing updates", async () => {
  const { auth, calls } = authDouble();
  const link = parseRecoveryLink("https://example.test/auth/reset-password#type=recovery&access_token=a&refresh_token=r");
  assert.equal(await verifyRecoveryLink(auth, link), "buyer@example.com");
  assert.deepEqual(calls, [["setSession", { access_token: "a", refresh_token: "r" }], ["getUser"]]);
  await saveRecoveryPassword(auth, "new-password", "new-password");
  assert.deepEqual(calls.at(-1), ["updateUser", { password: "new-password" }]);
});

test("custom email template redeems only a recovery OTP", async () => {
  const { auth, calls } = authDouble();
  const link = parseRecoveryLink("https://example.test/auth/reset-password?type=recovery&token_hash=hash");
  assert.equal(await verifyRecoveryLink(auth, link), "buyer@example.com");
  assert.deepEqual(calls, [["verifyOtp", { type: "recovery", token_hash: "hash" }], ["getUser"]]);
});

test("expired links and unverified users fail closed", async () => {
  for (const options of [{ invalid: true }, { missingUser: true }]) {
    const { auth, calls } = authDouble(options);
    await assert.rejects(verifyRecoveryLink(auth, { kind: "tokenHash", tokenHash: "expired" }), /expired or is invalid/);
    assert.ok(!calls.some((call) => (call as string[])[0] === "updateUser"));
  }
});

test("short/mismatched passwords never call Auth; provider errors allow retry", async () => {
  const { auth, calls } = authDouble();
  await assert.rejects(saveRecoveryPassword(auth, "short", "short"), /8 characters/);
  await assert.rejects(saveRecoveryPassword(auth, "long-enough", "mismatch"), /do not match/);
  assert.equal(calls.length, 0);
  await assert.rejects(saveRecoveryPassword(authDouble({ updateFails: true }).auth, "long-enough", "long-enough"), /couldn’t save/);
  await saveRecoveryPassword(auth, "long-enough", "long-enough");
  assert.equal(calls.length, 1);
});
