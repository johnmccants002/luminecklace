import type { FactoryStatus } from "@/lib/factory/types";

const FACTORY_STATUSES = new Set<FactoryStatus>([
  "needs_nfc",
  "in_progress",
  "ready",
  "completed",
  "manual_review",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_NUMBER_PATTERN = /^\d{1,32}$/;

export class FactoryApiError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409
  ) {
    super(message);
  }
}

export type FactoryOrderListInput = {
  page: number;
  limit: number;
  status: FactoryStatus | null;
  search: string | null;
};

function positiveInteger(
  value: string | null,
  fallback: number,
  maximum: number,
  label: string
) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new FactoryApiError(`${label} must be a positive integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new FactoryApiError(`${label} is outside the allowed range`, 400);
  }
  return parsed;
}

export function sanitizeFactorySearch(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().slice(0, 100);
  if (!trimmed) return null;
  const sanitized = trimmed
    .replace(/[^a-zA-Z0-9@.+\-\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) {
    throw new FactoryApiError("search does not contain searchable characters", 400);
  }
  return sanitized;
}

export function parseFactoryOrderListInput(url: URL): FactoryOrderListInput {
  const statusValue = url.searchParams.get("status")?.trim() ?? null;
  if (statusValue && !FACTORY_STATUSES.has(statusValue as FactoryStatus)) {
    throw new FactoryApiError("Unsupported factory status", 400);
  }

  return {
    page: positiveInteger(url.searchParams.get("page"), 1, 10_000, "page"),
    limit: positiveInteger(url.searchParams.get("limit"), 25, 100, "limit"),
    status: statusValue as FactoryStatus | null,
    search: sanitizeFactorySearch(url.searchParams.get("search")),
  };
}

export function parseFactoryOrderId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new FactoryApiError("Order not found", 404);
  }
  return value;
}

export function parseFactoryOrderNumber(value: string | null): string {
  const normalized = value?.trim().replace(/^#/, "") ?? "";
  if (!ORDER_NUMBER_PATTERN.test(normalized)) {
    throw new FactoryApiError("A valid orderNumber is required", 400);
  }
  return normalized;
}
