import {
  APNS_BUNDLE_ID,
  type ApnsEnvironment,
} from "@/lib/push/types";

const DEVICE_TOKEN_PATTERN = /^[0-9a-f]{64,200}$/;

export class PushValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  supportedKeys: readonly string[]
) {
  const unknownKey = Object.keys(value).find(
    (key) => !supportedKeys.includes(key)
  );
  if (unknownKey) {
    throw new PushValidationError(`${unknownKey} is not supported`);
  }
}

function parseEnvironment(value: unknown): ApnsEnvironment {
  if (value !== "sandbox" && value !== "production") {
    throw new PushValidationError(
      "environment must be sandbox or production"
    );
  }
  return value;
}

export function normalizeDeviceToken(value: unknown): string {
  if (typeof value !== "string") {
    throw new PushValidationError("deviceToken is required");
  }
  const token = value.trim().toLowerCase();
  if (
    !DEVICE_TOKEN_PATTERN.test(token) ||
    token.length % 2 !== 0
  ) {
    throw new PushValidationError(
      "deviceToken must be a valid hexadecimal APNs token"
    );
  }
  return token;
}

function parseBundleId(value: unknown, required: boolean): string {
  if (value === undefined && !required) return APNS_BUNDLE_ID;
  if (value !== APNS_BUNDLE_ID) {
    throw new PushValidationError(`bundleId must be ${APNS_BUNDLE_ID}`);
  }
  return value;
}

function parseOptionalLabel(
  value: unknown,
  fieldName: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new PushValidationError(`${fieldName} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new PushValidationError(
      `${fieldName} must contain 1 to ${maxLength} characters`
    );
  }
  return normalized;
}

export type RegisterPushDeviceInput = {
  deviceToken: string;
  environment: ApnsEnvironment;
  bundleId: string;
  appVersion: string | null;
  deviceModel: string | null;
};

export function parseRegisterPushDevice(
  value: unknown
): RegisterPushDeviceInput {
  if (!isRecord(value)) {
    throw new PushValidationError("Invalid JSON body");
  }
  rejectUnknownKeys(value, [
    "deviceToken",
    "environment",
    "bundleId",
    "appVersion",
    "deviceModel",
  ]);

  return {
    deviceToken: normalizeDeviceToken(value.deviceToken),
    environment: parseEnvironment(value.environment),
    bundleId: parseBundleId(value.bundleId, true),
    appVersion: parseOptionalLabel(value.appVersion, "appVersion", 64),
    deviceModel: parseOptionalLabel(value.deviceModel, "deviceModel", 120),
  };
}

export type DeletePushDeviceInput = Pick<
  RegisterPushDeviceInput,
  "deviceToken" | "environment" | "bundleId"
>;

export function parseDeletePushDevice(value: unknown): DeletePushDeviceInput {
  if (!isRecord(value)) {
    throw new PushValidationError("Invalid JSON body");
  }
  rejectUnknownKeys(value, ["deviceToken", "environment", "bundleId"]);
  return {
    deviceToken: normalizeDeviceToken(value.deviceToken),
    environment: parseEnvironment(value.environment),
    bundleId: parseBundleId(value.bundleId, false),
  };
}

export type PushPreferencesInput = {
  revealsEnabled?: boolean;
  reactionsEnabled?: boolean;
  responsesEnabled?: boolean;
};

export function parsePushPreferences(value: unknown): PushPreferencesInput {
  if (!isRecord(value)) {
    throw new PushValidationError("Invalid JSON body");
  }
  const supported = [
    "revealsEnabled",
    "reactionsEnabled",
    "responsesEnabled",
  ] as const;
  rejectUnknownKeys(value, supported);
  if (Object.keys(value).length === 0) {
    throw new PushValidationError("At least one preference is required");
  }

  const result: PushPreferencesInput = {};
  for (const key of supported) {
    if (!(key in value)) continue;
    if (typeof value[key] !== "boolean") {
      throw new PushValidationError(`${key} must be a boolean`);
    }
    result[key] = value[key];
  }
  return result;
}
