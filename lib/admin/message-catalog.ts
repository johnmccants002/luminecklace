import {
  DEFAULT_LUMI_PRESENTATION,
  LUMI_BACKGROUND_KEYS,
  LUMI_FONT_KEYS,
  LUMI_TEXT_ALIGNMENT_KEYS,
  LUMI_TEXT_POSITION_KEYS,
  LUMI_TEXT_SIZE_KEYS,
  type LumiBackgroundKey,
  type LumiFontKey,
  type LumiTextAlignmentKey,
  type LumiTextPositionKey,
  type LumiTextSizeKey,
} from "@/lib/sender/necklaces";

export type CatalogMessageInput = {
  importKey: string | null;
  title: string | null;
  text: string;
  category: string;
  newCategoryName: string | null;
  tone: string | null;
  isActive: boolean;
  isExplorePublished: boolean;
  exploreSortOrder: number;
  isReserveEligible: boolean;
  reserveDefaultApproved: boolean;
  reserveSortOrder: number | null;
  themeKey: string;
  animationKey: string;
  soundKey: string;
  backgroundKey: LumiBackgroundKey;
  fontKey: LumiFontKey;
  textSizeKey: LumiTextSizeKey;
  textAlignmentKey: LumiTextAlignmentKey;
  textPositionKey: LumiTextPositionKey;
};

function optionalText(value: FormDataEntryValue | null, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`Value must be ${maxLength} characters or fewer`);
  return text;
}

function requiredPresentationKey(
  value: FormDataEntryValue | null,
  fallback: string,
  label: string
) {
  const key = typeof value === "string" ? value.trim() : "";
  const normalized = key || fallback;
  if (!/^[a-z0-9][a-z0-9_-]{0,49}$/i.test(normalized)) {
    throw new Error(`${label} must use letters, numbers, hyphens, or underscores`);
  }
  return normalized;
}

function presetKey<T extends string>(
  value: FormDataEntryValue | null,
  fallback: T,
  supported: readonly T[],
  label: string
) {
  const key = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!supported.includes(key as T)) {
    throw new Error(`${label} is not supported`);
  }
  return key as T;
}

function nonNegativeInteger(value: FormDataEntryValue | null, label: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  const number = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative whole number`);
  }
  return number;
}

export function categoryKeyFromName(name: string) {
  const key = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  if (!key) {
    throw new Error("Category name must include at least one letter or number");
  }
  return key;
}

export function parseCatalogMessageForm(formData: FormData): CatalogMessageInput {
  const text = typeof formData.get("text") === "string"
    ? String(formData.get("text")).trim()
    : "";
  if (!text || text.length > 500) {
    throw new Error("Message text must be between 1 and 500 characters");
  }

  const categoryValue = formData.get("category");
  const newCategoryName = optionalText(formData.get("newCategoryName"), 60);
  if (categoryValue === "__new__") {
    if (!newCategoryName) throw new Error("Enter a name for the new category");
  } else if (
    typeof categoryValue !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categoryValue) ||
    categoryValue.length > 50
  ) {
    throw new Error("Choose a message category");
  }

  const isActive = formData.get("isActive") === "on";
  const isExplorePublished = formData.get("isExplorePublished") === "on";
  const isReserveEligible = formData.get("isReserveEligible") === "on";
  const reserveDefaultApproved =
    formData.get("reserveDefaultApproved") === "on";
  if (reserveDefaultApproved && !isReserveEligible) {
    throw new Error("Reserve default approval requires Reserve eligibility");
  }

  const reserveSortRaw = formData.get("reserveSortOrder");
  const reserveSortOrder =
    typeof reserveSortRaw === "string" && reserveSortRaw.trim()
      ? nonNegativeInteger(reserveSortRaw, "Reserve order")
      : null;
  if (reserveSortOrder === 0) {
    throw new Error("Reserve order must be greater than zero");
  }

  return {
    importKey: optionalText(formData.get("importKey"), 160),
    title: optionalText(formData.get("title"), 200),
    text,
    category: String(categoryValue),
    newCategoryName,
    tone: optionalText(formData.get("tone"), 50),
    isActive,
    isExplorePublished,
    exploreSortOrder: nonNegativeInteger(
      formData.get("exploreSortOrder"),
      "Explore order"
    ),
    isReserveEligible,
    reserveDefaultApproved,
    reserveSortOrder,
    themeKey: requiredPresentationKey(
      formData.get("themeKey"),
      "heart",
      "Theme"
    ),
    animationKey: requiredPresentationKey(
      formData.get("animationKey"),
      "breathe",
      "Animation"
    ),
    soundKey: requiredPresentationKey(
      formData.get("soundKey"),
      "soft",
      "Sound"
    ),
    backgroundKey: presetKey(
      formData.get("backgroundKey"),
      DEFAULT_LUMI_PRESENTATION.background,
      LUMI_BACKGROUND_KEYS,
      "Background"
    ),
    fontKey: presetKey(
      formData.get("fontKey"),
      DEFAULT_LUMI_PRESENTATION.font,
      LUMI_FONT_KEYS,
      "Font"
    ),
    textSizeKey: presetKey(
      formData.get("textSizeKey"),
      DEFAULT_LUMI_PRESENTATION.textSize,
      LUMI_TEXT_SIZE_KEYS,
      "Text size"
    ),
    textAlignmentKey: presetKey(
      formData.get("textAlignmentKey"),
      DEFAULT_LUMI_PRESENTATION.textAlignment,
      LUMI_TEXT_ALIGNMENT_KEYS,
      "Text alignment"
    ),
    textPositionKey: presetKey(
      formData.get("textPositionKey"),
      DEFAULT_LUMI_PRESENTATION.textPosition,
      LUMI_TEXT_POSITION_KEYS,
      "Text position"
    ),
  };
}
