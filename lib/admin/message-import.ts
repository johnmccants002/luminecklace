import { DEFAULT_MESSAGE_LIBRARY_CATEGORIES } from "@/lib/sender/message-library-contract";
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

export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_ROWS = 1_000;

export type TemplateImportRow = {
  importKey: string;
  title: string;
  content: string;
  category: string | null;
  status: "draft" | "published" | "archived";
  sortOrder: number;
  metadata: Record<string, unknown>;
  themeKey: string;
  animationKey: string;
  soundKey: string;
  backgroundKey: LumiBackgroundKey;
  fontKey: LumiFontKey;
  textSizeKey: LumiTextSizeKey;
  textAlignmentKey: LumiTextAlignmentKey;
  textPositionKey: LumiTextPositionKey;
  reserveEligible: boolean;
  reserveDefaultApproved: boolean;
  reserveSortOrder: number | null;
};

export type ImportIssue = {
  rowNumber: number;
  importKey: string | null;
  message: string;
};

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSource(text: string, sourceType: "csv" | "json") {
  if (sourceType === "csv") return parseCsv(text);
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("JSON import must be an array of objects");
  return parsed.map((value) => asRecord(value) ?? {});
}

function textValue(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (typeof row[key] === "string") return row[key].trim();
  }
  return "";
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") return true;
    if (value.trim().toLowerCase() === "false") return false;
  }
  return fallback;
}

export function parseMessageTemplateImport(
  text: string,
  sourceType: "csv" | "json",
  supportedCategories: ReadonlySet<string> = new Set(
    DEFAULT_MESSAGE_LIBRARY_CATEGORIES.map((category) => category.key)
  )
): { validRows: TemplateImportRow[]; issues: ImportIssue[]; totalRows: number } {
  const sourceRows = parseSource(text.replace(/^\uFEFF/, ""), sourceType);
  if (sourceRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import exceeds the ${MAX_IMPORT_ROWS} row limit`);
  }

  const validRows: TemplateImportRow[] = [];
  const issues: ImportIssue[] = [];
  const keys = new Set<string>();

  sourceRows.forEach((rawRow, index) => {
    const row = asRecord(rawRow) ?? {};
    const rowNumber = index + 2;
    const importKey = textValue(row, "import_key", "importKey", "external_key");
    const title = textValue(row, "title");
    const content = textValue(row, "content", "message", "message_text", "text");
    const category = textValue(row, "category") || null;
    const statusValue = textValue(row, "status") || "draft";
    const sortRaw = row.sort_order ?? row.sortOrder ?? 0;
    const sortOrder =
      typeof sortRaw === "number"
        ? sortRaw
        : typeof sortRaw === "string" && /^\d+$/.test(sortRaw.trim())
          ? Number(sortRaw)
          : Number.NaN;
    let metadata: Record<string, unknown> = {};
    const metadataRaw = row.metadata;
    if (asRecord(metadataRaw)) metadata = asRecord(metadataRaw) ?? {};
    else if (typeof metadataRaw === "string" && metadataRaw.trim()) {
      try {
        metadata = asRecord(JSON.parse(metadataRaw)) ?? {};
      } catch {
        issues.push({ rowNumber, importKey: importKey || null, message: "metadata must be valid JSON" });
        return;
      }
    }
    const reserveEligible = booleanValue(
      row.reserve_eligible ?? row.reserveEligible ?? metadata.reserveEligible,
      false
    );
    const reserveDefaultApproved = booleanValue(
      row.reserve_default_approved ??
        row.reserveDefaultApproved ??
        metadata.reserveDefaultApproved,
      false
    );
    const reserveSortRaw =
      row.reserve_sort_order ??
      row.reserveSortOrder ??
      metadata.reserveSortOrder ??
      null;
    const reserveSortOrder =
      reserveSortRaw === null || reserveSortRaw === ""
        ? null
        : typeof reserveSortRaw === "number"
          ? reserveSortRaw
          : typeof reserveSortRaw === "string" &&
              /^\d+$/.test(reserveSortRaw.trim())
            ? Number(reserveSortRaw)
            : Number.NaN;
    const themeKey =
      textValue(row, "theme", "theme_key", "themeKey") ||
      textValue(metadata, "theme", "themeKey") ||
      "heart";
    const animationKey =
      textValue(row, "animation", "animation_key", "animationKey") ||
      textValue(metadata, "animation", "animationKey") ||
      "breathe";
    const soundKey =
      textValue(row, "sound", "sound_key", "soundKey") ||
      textValue(metadata, "sound", "soundKey") ||
      "soft";
    const backgroundKey =
      textValue(row, "background", "background_key", "backgroundKey") ||
      textValue(metadata, "background", "backgroundKey") ||
      themeKey;
    const fontKey =
      textValue(row, "font", "font_key", "fontKey") ||
      textValue(metadata, "font", "fontKey") ||
      DEFAULT_LUMI_PRESENTATION.font;
    const textSizeKey =
      textValue(row, "text_size", "text_size_key", "textSizeKey", "textSize") ||
      textValue(metadata, "textSize", "textSizeKey") ||
      DEFAULT_LUMI_PRESENTATION.textSize;
    const textAlignmentKey =
      textValue(
        row,
        "text_alignment",
        "text_alignment_key",
        "textAlignmentKey",
        "textAlignment"
      ) ||
      textValue(metadata, "textAlignment", "textAlignmentKey") ||
      DEFAULT_LUMI_PRESENTATION.textAlignment;
    const textPositionKey =
      textValue(
        row,
        "text_position",
        "text_position_key",
        "textPositionKey",
        "textPosition"
      ) ||
      textValue(metadata, "textPosition", "textPositionKey") ||
      DEFAULT_LUMI_PRESENTATION.textPosition;

    const errors: string[] = [];
    if (!importKey || importKey.length > 160) errors.push("import_key is required and must be 160 characters or fewer");
    if (!title || title.length > 200) errors.push("title is required and must be 200 characters or fewer");
    if (!content || content.length > 500) errors.push("content is required and must be 500 characters or fewer");
    if (!category || !supportedCategories.has(category)) {
      errors.push("category must match an active message category");
    }
    if (!["draft", "published", "archived"].includes(statusValue)) errors.push("status must be draft, published, or archived");
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) errors.push("sort_order must be a non-negative integer");
    if (
      reserveSortOrder !== null &&
      (!Number.isSafeInteger(reserveSortOrder) || reserveSortOrder < 1)
    ) {
      errors.push("reserve_sort_order must be a positive integer when provided");
    }
    if (reserveDefaultApproved && !reserveEligible) {
      errors.push("reserve_default_approved requires reserve_eligible");
    }
    for (const [label, value] of [
      ["theme", themeKey],
      ["animation", animationKey],
      ["sound", soundKey],
    ]) {
      if (!/^[a-z0-9][a-z0-9_-]{0,49}$/i.test(value)) {
        errors.push(`${label} must use letters, numbers, hyphens, or underscores`);
      }
    }
    if (!LUMI_BACKGROUND_KEYS.includes(backgroundKey as LumiBackgroundKey)) {
      errors.push("background_key is not supported");
    }
    if (!LUMI_FONT_KEYS.includes(fontKey as LumiFontKey)) {
      errors.push("font_key is not supported");
    }
    if (!LUMI_TEXT_SIZE_KEYS.includes(textSizeKey as LumiTextSizeKey)) {
      errors.push("text_size_key is not supported");
    }
    if (
      !LUMI_TEXT_ALIGNMENT_KEYS.includes(
        textAlignmentKey as LumiTextAlignmentKey
      )
    ) {
      errors.push("text_alignment_key is not supported");
    }
    if (
      !LUMI_TEXT_POSITION_KEYS.includes(textPositionKey as LumiTextPositionKey)
    ) {
      errors.push("text_position_key is not supported");
    }
    if (keys.has(importKey)) errors.push("duplicate import_key in this file");

    if (errors.length) {
      issues.push({ rowNumber, importKey: importKey || null, message: errors.join("; ") });
      return;
    }
    keys.add(importKey);
    validRows.push({
      importKey,
      title,
      content,
      category,
      status: statusValue as TemplateImportRow["status"],
      sortOrder,
      metadata,
      themeKey: backgroundKey as LumiBackgroundKey,
      animationKey,
      soundKey,
      backgroundKey: backgroundKey as LumiBackgroundKey,
      fontKey: fontKey as LumiFontKey,
      textSizeKey: textSizeKey as LumiTextSizeKey,
      textAlignmentKey: textAlignmentKey as LumiTextAlignmentKey,
      textPositionKey: textPositionKey as LumiTextPositionKey,
      reserveEligible,
      reserveDefaultApproved,
      reserveSortOrder,
    });
  });

  return { validRows, issues, totalRows: sourceRows.length };
}

export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function parseInventoryImport(text: string, sourceType: "csv" | "json") {
  let rawRows: Array<Record<string, unknown>>;
  if (sourceType === "csv") {
    rawRows = parseCsv(text.replace(/^\uFEFF/, ""));
  } else {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!Array.isArray(parsed)) throw new Error("Inventory JSON must be an array");
    rawRows = parsed.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row)
    );
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import exceeds ${MAX_IMPORT_ROWS} rows`);
  }

  const seen = new Set<string>();
  const rows = rawRows.map((row, index) => {
    const tagRef = String(row.tag_ref ?? row.tagRef ?? "").trim();
    const sku = String(row.sku ?? "").trim();
    const tapTokenHash = String(row.tap_token_hash ?? row.tapTokenHash ?? "").trim();
    if (!tagRef || !sku || tapTokenHash.length < 16) {
      throw new Error(
        `Row ${index + 2} requires tag_ref, sku, and a secure tap_token_hash`
      );
    }
    if (seen.has(tagRef)) throw new Error(`Duplicate tag_ref at row ${index + 2}`);
    seen.add(tagRef);
    return { tag_ref: tagRef, sku, tap_token_hash: tapTokenHash };
  });
  if (!rows.length) throw new Error("The inventory file has no data rows");
  return rows;
}
