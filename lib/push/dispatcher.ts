import "server-only";

import { ApnsConfigurationError, sendApnsNotification } from "@/lib/push/apns";
import {
  buildApnsPayload,
  isPushEventType,
  parsePushEventPayload,
} from "@/lib/push/payloads";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  ApnsEnvironment,
  ClaimedPushDelivery,
  DispatchSummary,
} from "@/lib/push/types";

const MAX_ATTEMPTS = 8;
const INVALID_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "ExpiredToken",
  "Unregistered",
]);
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

type RpcResult = { data: unknown; error: { message?: string } | null };
type PushRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};
type SendApns = typeof sendApnsNotification;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClaimedDelivery(value: unknown): ClaimedPushDelivery {
  if (
    !isRecord(value) ||
    typeof value.delivery_id !== "string" ||
    typeof value.claim_token !== "string" ||
    typeof value.attempt_count !== "number" ||
    typeof value.device_token !== "string" ||
    (value.apns_environment !== "sandbox" &&
      value.apns_environment !== "production") ||
    typeof value.bundle_id !== "string" ||
    !isPushEventType(value.event_type)
  ) {
    throw new Error("Invalid claimed push delivery");
  }
  return {
    deliveryId: value.delivery_id,
    claimToken: value.claim_token,
    attemptCount: value.attempt_count,
    deviceToken: value.device_token,
    environment: value.apns_environment as ApnsEnvironment,
    bundleId: value.bundle_id,
    eventType: value.event_type,
    eventPayload: parsePushEventPayload(value.event_payload, value.event_type),
  };
}

function sanitizedReason(reason: string | null, fallback: string): string {
  return (reason ?? fallback).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128);
}

function retryAfterTimestamp(value: string | null, now: number): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    const timestamp = now + seconds * 1000;
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(timestamp)
      ? timestamp
      : null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function retryAt(
  attemptCount: number,
  random: () => number,
  now: number,
  retryAfter: string | null = null
): string {
  const exponentialSeconds = Math.min(60 * 60, 30 * 2 ** (attemptCount - 1));
  const jitterSeconds = Math.floor(random() * 16);
  const fallback = now + (exponentialSeconds + jitterSeconds) * 1000;
  const requested = retryAfterTimestamp(retryAfter, now);
  return new Date(Math.max(fallback, requested ?? fallback)).toISOString();
}

async function finalize(
  client: PushRpcClient,
  delivery: ClaimedPushDelivery,
  input: {
    status: "retry" | "sent" | "invalid_token" | "failed";
    apnsId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    availableAt?: string | null;
  }
) {
  const { data, error } = await client.rpc("finalize_push_delivery", {
    p_delivery_id: delivery.deliveryId,
    p_claim_token: delivery.claimToken,
    p_status: input.status,
    p_apns_id: input.apnsId ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_available_at: input.availableAt ?? null,
  });
  if (error) throw new Error("Failed to finalize push delivery");
  return data === true;
}

export async function dispatchPushDeliveries(options: {
  client?: PushRpcClient;
  send?: SendApns;
  batchSize?: number;
  random?: () => number;
  now?: () => number;
} = {}): Promise<DispatchSummary> {
  const client = options.client ?? supabaseAdmin;
  const send = options.send ?? sendApnsNotification;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const batchSize = Math.min(Math.max(options.batchSize ?? 25, 1), 100);
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    retried: 0,
    invalid: 0,
    failed: 0,
  };

  const { data, error } = await client.rpc("claim_push_deliveries", {
    p_limit: batchSize,
  });
  if (error) throw new Error("Failed to claim push deliveries");
  if (!Array.isArray(data)) throw new Error("Invalid push claim response");

  const deliveries = data.map(parseClaimedDelivery);
  summary.claimed = deliveries.length;

  await Promise.all(
    deliveries.map(async (delivery) => {
      const payload = buildApnsPayload(delivery.eventType, delivery.eventPayload);
      let result: Awaited<ReturnType<SendApns>>;
      try {
        result = await send({
          deviceToken: delivery.deviceToken,
          environment: delivery.environment,
          bundleId: delivery.bundleId,
          apnsId: delivery.deliveryId,
          payload,
        });
      } catch (error) {
        const configurationFailure = error instanceof ApnsConfigurationError;
        const canRetry =
          !configurationFailure && delivery.attemptCount < MAX_ATTEMPTS;
        if (
          await finalize(client, delivery, {
            status: canRetry ? "retry" : "failed",
            errorCode: configurationFailure
              ? "APNS_CONFIGURATION"
              : "APNS_TRANSPORT",
            errorMessage: configurationFailure
              ? "APNs provider configuration is invalid"
              : delivery.attemptCount >= MAX_ATTEMPTS
                ? "APNs transport retry limit reached"
                : "Temporary APNs transport failure",
            availableAt: canRetry
              ? retryAt(delivery.attemptCount, random, now())
              : null,
          })
        ) {
          if (canRetry) summary.retried += 1;
          else summary.failed += 1;
        }
        return;
      }

      if (result.status === 200) {
        if (
          await finalize(client, delivery, {
            status: "sent",
            apnsId: result.apnsId ?? delivery.deliveryId,
          })
        ) {
          summary.sent += 1;
        }
        return;
      }

      const errorCode = sanitizedReason(result.reason, `HTTP_${result.status}`);
      if (result.status === 410 || INVALID_TOKEN_REASONS.has(errorCode)) {
        if (
          await finalize(client, delivery, {
            status: "invalid_token",
            apnsId: result.apnsId,
            errorCode,
            errorMessage: "APNs rejected this device registration",
          })
        ) {
          summary.invalid += 1;
        }
        return;
      }

      const retryable =
        result.status === 0 ||
        RETRYABLE_STATUS_CODES.has(result.status) ||
        result.status >= 500;
      if (retryable && delivery.attemptCount < MAX_ATTEMPTS) {
        if (
          await finalize(client, delivery, {
            status: "retry",
            apnsId: result.apnsId,
            errorCode,
            errorMessage: "APNs temporarily rejected the delivery",
            availableAt: retryAt(
              delivery.attemptCount,
              random,
              now(),
              result.retryAfter
            ),
          })
        ) {
          summary.retried += 1;
        }
        return;
      }

      if (
        await finalize(client, delivery, {
          status: "failed",
          apnsId: result.apnsId,
          errorCode,
          errorMessage: retryable
            ? "APNs retry limit reached"
            : "APNs permanently rejected the delivery",
        })
      ) {
        summary.failed += 1;
      }
    })
  );

  return summary;
}
