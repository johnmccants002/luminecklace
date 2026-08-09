import { SenderApiError } from "@/lib/sender/necklaces";

export const LUMI_EXPERIENCE_PRESET_KEYS = [
  "classic_word_rise_v1",
  "golden_hour_v1",
  "midnight_v1",
  "proud_of_you_v1",
  "playful_v1",
  "calm_v1",
  "memory_v1",
  "timed_surprise_v1",
] as const;

export type LumiExperiencePresetKey =
  (typeof LUMI_EXPERIENCE_PRESET_KEYS)[number];

export const CLASSIC_EXPERIENCE_PRESET_KEY: LumiExperiencePresetKey =
  "classic_word_rise_v1";

export type LibraryTextCustomization = {
  primaryText?: string;
  secondaryText?: string | null;
};

export function safeExperiencePresetKey(
  value: unknown
): LumiExperiencePresetKey {
  return typeof value === "string" &&
    LUMI_EXPERIENCE_PRESET_KEYS.includes(value as LumiExperiencePresetKey)
    ? (value as LumiExperiencePresetKey)
    : CLASSIC_EXPERIENCE_PRESET_KEY;
}

export function normalizeLibraryCustomization(
  value: unknown
): LibraryTextCustomization | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SenderApiError("customization must be an object", 400);
  }

  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !["primaryText", "secondaryText"].includes(key)
    )
  ) {
    throw new SenderApiError(
      "customization contains unsupported fields",
      400
    );
  }

  const result: LibraryTextCustomization = {};
  if ("primaryText" in record) {
    if (typeof record.primaryText !== "string") {
      throw new SenderApiError("primaryText must be text", 400);
    }
    const primaryText = record.primaryText.trim();
    if (!primaryText || primaryText.length > 500) {
      throw new SenderApiError(
        "primaryText must be between 1 and 500 characters",
        400
      );
    }
    result.primaryText = primaryText;
  }

  if ("secondaryText" in record) {
    if (record.secondaryText === null) {
      result.secondaryText = null;
    } else if (typeof record.secondaryText !== "string") {
      throw new SenderApiError("secondaryText must be text or null", 400);
    } else {
      const secondaryText = record.secondaryText.trim();
      if (secondaryText.length > 250) {
        throw new SenderApiError(
          "secondaryText must be 250 characters or fewer",
          400
        );
      }
      result.secondaryText = secondaryText || null;
    }
  }

  return result;
}
