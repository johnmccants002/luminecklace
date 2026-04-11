import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { getRequiredEnvVar } from "@/lib/supabase/env";

type ClaimTokenPayload = {
  v: 1;
  exp: number;
  jti: string;
};

type VerifyClaimTokenResult =
  | { valid: true; expired: false; payload: ClaimTokenPayload }
  | { valid: true; expired: true; payload: ClaimTokenPayload }
  | { valid: false; expired: false; payload: null };

const DEFAULT_CLAIM_TTL_SECONDS = 30 * 60;
const MIN_CLAIM_TTL_SECONDS = 15 * 60;
const MAX_CLAIM_TTL_SECONDS = 60 * 60;

function getClaimTokenSecret(): string {
  const explicitSecret = process.env.ACTIVATION_CLAIM_TOKEN_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  return getRequiredEnvVar("SUPABASE_SECRET_KEY");
}

function getClaimTokenTtlSeconds(): number {
  const rawValue = process.env.ACTIVATION_CLAIM_TOKEN_TTL_SECONDS;
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : NaN;

  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_CLAIM_TTL_SECONDS;
  }

  return Math.min(
    MAX_CLAIM_TTL_SECONDS,
    Math.max(MIN_CLAIM_TTL_SECONDS, parsedValue)
  );
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signBody(bodyBase64: string): string {
  const secret = getClaimTokenSecret();

  return createHmac("sha256", secret)
    .update(bodyBase64)
    .digest("base64url");
}

function isClaimTokenPayload(value: unknown): value is ClaimTokenPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { v?: unknown }).v === 1 &&
    typeof (value as { exp?: unknown }).exp === "number" &&
    typeof (value as { jti?: unknown }).jti === "string"
  );
}

export function createClaimToken(now = Date.now()) {
  const ttlSeconds = getClaimTokenTtlSeconds();
  const expiresAtSeconds = Math.floor(now / 1000) + ttlSeconds;

  const payload: ClaimTokenPayload = {
    v: 1,
    exp: expiresAtSeconds,
    jti: randomBytes(16).toString("hex"),
  };

  const bodyBase64 = toBase64Url(JSON.stringify(payload));
  const signature = signBody(bodyBase64);

  return {
    token: `${bodyBase64}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

export function verifyClaimToken(token: string, now = Date.now()): VerifyClaimTokenResult {
  const trimmedToken = token.trim();
  const tokenParts = trimmedToken.split(".");

  if (tokenParts.length !== 2) {
    return { valid: false, expired: false, payload: null };
  }

  const [bodyBase64, signature] = tokenParts;
  if (!bodyBase64 || !signature) {
    return { valid: false, expired: false, payload: null };
  }

  const expectedSignature = signBody(bodyBase64);
  if (signature !== expectedSignature) {
    return { valid: false, expired: false, payload: null };
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(fromBase64Url(bodyBase64));
  } catch {
    return { valid: false, expired: false, payload: null };
  }

  if (!isClaimTokenPayload(parsedPayload)) {
    return { valid: false, expired: false, payload: null };
  }

  const nowSeconds = Math.floor(now / 1000);
  if (parsedPayload.exp <= nowSeconds) {
    return {
      valid: true,
      expired: true,
      payload: parsedPayload,
    };
  }

  return {
    valid: true,
    expired: false,
    payload: parsedPayload,
  };
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}
