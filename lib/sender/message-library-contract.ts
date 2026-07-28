import { SenderApiError } from "@/lib/sender/necklaces";

export const DEFAULT_MESSAGE_LIBRARY_CATEGORIES = [
  { key: "affection", name: "Affection", sortOrder: 1 },
  { key: "comfort", name: "Comfort", sortOrder: 2 },
  { key: "encouragement", name: "Encouragement", sortOrder: 3 },
  { key: "presence", name: "Presence", sortOrder: 4 },
  { key: "reassurance", name: "Reassurance", sortOrder: 5 },
] as const;

export type MessageLibraryCategoryKey = string;

export type MessageLibraryCursor = {
  category: MessageLibraryCategoryKey;
  sortOrder: number;
  id: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeLibrarySearch(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    throw new SenderApiError("search must be text", 400);
  }
  const search = value.trim().replace(/\s+/g, " ");
  if (!search) return undefined;
  if (search.length > 80) {
    throw new SenderApiError("search must be 80 characters or fewer", 400);
  }
  return search.replace(/[%_]/g, "") || undefined;
}

export function parseLibraryCategory(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  if (
    typeof value !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
    value.length > 50
  ) {
    throw new SenderApiError("category is not supported", 400);
  }
  return value;
}

export function parseLibraryLimit(value: unknown) {
  if (value === null || value === undefined || value === "") return 20;
  const limit =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new SenderApiError("limit must be between 1 and 50", 400);
  }
  return limit;
}

export function encodeLibraryCursor(cursor: MessageLibraryCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeLibraryCursor(
  value: unknown
): MessageLibraryCursor | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 300) {
    throw new SenderApiError("cursor is invalid", 400);
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as
      | Partial<MessageLibraryCursor>
      | null;
    if (
      !parsed ||
      typeof parsed.category !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.category) ||
      parsed.category.length > 50 ||
      !Number.isInteger(parsed.sortOrder) ||
      (parsed.sortOrder ?? -1) < 0 ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id)
    ) {
      throw new Error("invalid");
    }
    return parsed as MessageLibraryCursor;
  } catch {
    throw new SenderApiError("cursor is invalid", 400);
  }
}
