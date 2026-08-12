import "server-only";

import { connect, constants as http2Constants } from "node:http2";

import { importPKCS8, SignJWT } from "jose";

import {
  APNS_BUNDLE_ID,
  type ApnsEnvironment,
  type ApnsPayload,
} from "@/lib/push/types";

const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};

type CachedProviderToken = {
  teamId: string;
  keyId: string;
  token: string;
  refreshAt: number;
};

let cachedProviderToken: CachedProviderToken | null = null;

export class ApnsConfigurationError extends Error {}

export type ApnsResult = {
  status: number;
  reason: string | null;
  apnsId: string | null;
  retryAfter: string | null;
};

export function buildApnsRequest(input: {
  deviceToken: string;
  environment: ApnsEnvironment;
  topic: string;
  apnsId: string;
  providerToken: string;
}) {
  return {
    host: APNS_HOSTS[input.environment],
    headers: {
      ":method": "POST",
      ":path": `/3/device/${input.deviceToken}`,
      authorization: `bearer ${input.providerToken}`,
      "apns-topic": input.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-id": input.apnsId,
    },
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ApnsConfigurationError(`${name} is not configured`);
  return value;
}

function privateKeyFromEnvironment(): string {
  const encoded = process.env.APNS_PRIVATE_KEY_BASE64?.trim();
  if (encoded) {
    try {
      return Buffer.from(encoded, "base64").toString("utf8").trim();
    } catch {
      throw new ApnsConfigurationError("APNS_PRIVATE_KEY_BASE64 is invalid");
    }
  }
  return requiredEnv("APNS_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function configuredBundleId(): string {
  const bundleId = requiredEnv("APNS_BUNDLE_ID");
  if (bundleId !== APNS_BUNDLE_ID) {
    throw new ApnsConfigurationError("APNS_BUNDLE_ID is not the Lumi app topic");
  }
  return bundleId;
}

function defaultEnvironment(): ApnsEnvironment {
  const value = requiredEnv("APNS_DEFAULT_ENVIRONMENT");
  if (value !== "sandbox" && value !== "production") {
    throw new ApnsConfigurationError(
      "APNS_DEFAULT_ENVIRONMENT must be sandbox or production"
    );
  }
  return value;
}

async function getProviderToken(): Promise<string> {
  const teamId = requiredEnv("APNS_TEAM_ID");
  const keyId = requiredEnv("APNS_KEY_ID");
  const now = Math.floor(Date.now() / 1000);
  if (
    cachedProviderToken &&
    cachedProviderToken.teamId === teamId &&
    cachedProviderToken.keyId === keyId &&
    cachedProviderToken.refreshAt > now
  ) {
    return cachedProviderToken.token;
  }

  let key: Awaited<ReturnType<typeof importPKCS8>>;
  try {
    key = await importPKCS8(privateKeyFromEnvironment(), "ES256");
  } catch {
    throw new ApnsConfigurationError("The APNs private key is invalid");
  }

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(key);
  cachedProviderToken = {
    teamId,
    keyId,
    token,
    refreshAt: now + 50 * 60,
  };
  return token;
}

function parseReason(rawBody: string): string | null {
  if (!rawBody) return null;
  try {
    const value = JSON.parse(rawBody) as { reason?: unknown };
    return typeof value.reason === "string" ? value.reason.slice(0, 128) : null;
  } catch {
    return null;
  }
}

export async function sendApnsNotification(input: {
  deviceToken: string;
  environment?: ApnsEnvironment;
  bundleId: string;
  apnsId: string;
  payload: ApnsPayload;
}): Promise<ApnsResult> {
  const topic = configuredBundleId();
  if (input.bundleId !== topic) {
    throw new ApnsConfigurationError("Device topic does not match APNS_BUNDLE_ID");
  }
  const environment = input.environment ?? defaultEnvironment();
  const providerToken = await getProviderToken();
  const apnsRequest = buildApnsRequest({
    deviceToken: input.deviceToken,
    environment,
    topic,
    apnsId: input.apnsId,
    providerToken,
  });

  return new Promise<ApnsResult>((resolve, reject) => {
    const session = connect(apnsRequest.host);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      session.close();
      callback();
    };

    session.once("error", () => {
      finish(() => reject(new Error("APNs connection failed")));
    });

    const request = session.request(apnsRequest.headers);
    request.setEncoding("utf8");

    let status = 0;
    let apnsId: string | null = null;
    let retryAfter: string | null = null;
    let body = "";
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
      const responseId = headers["apns-id"];
      apnsId = typeof responseId === "string" ? responseId : null;
      const retryHeader = headers["retry-after"];
      retryAfter =
        typeof retryHeader === "string" ? retryHeader.slice(0, 128) : null;
    });
    request.on("data", (chunk: string) => {
      if (body.length < 2048) body += chunk;
    });
    request.once("end", () => {
      finish(() =>
        resolve({ status, reason: parseReason(body), apnsId, retryAfter })
      );
    });
    request.once("error", () => {
      finish(() => reject(new Error("APNs request failed")));
    });
    request.setTimeout(10_000, () => {
      request.close(http2Constants.NGHTTP2_CANCEL);
      finish(() => reject(new Error("APNs request timed out")));
    });
    request.end(JSON.stringify(input.payload));
  });
}
