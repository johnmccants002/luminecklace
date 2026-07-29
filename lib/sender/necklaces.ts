import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listSenderReserveSummaries,
  type SenderReserveSummary,
} from "@/lib/sender/reserve";

type OwnershipRow = {
  necklace_id: string;
  is_primary: boolean | null;
  claimed_at: string | null;
};

type NecklaceRow = {
  id: string;
  name: string;
  sku: string;
  theme_key: string | null;
  lifecycle_status: string;
  queue_revision: number;
};

type LumiRow = {
  id: string;
  necklace_id: string;
  content: string;
  queue_position: number;
  queue_section: string | null;
  theme_key: string | null;
  animation_key: string | null;
  sound_key: string | null;
  background_key: string | null;
  font_key: string | null;
  text_size_key: string | null;
  text_alignment_key: string | null;
  text_position_key: string | null;
  created_at?: string;
  revealed_at?: string | null;
};

type EnqueueRpcResult = {
  id?: unknown;
  text?: unknown;
  content?: unknown;
  queue_position?: unknown;
  queuePosition?: unknown;
  theme_key?: unknown;
  animation_key?: unknown;
  sound_key?: unknown;
  background_key?: unknown;
  font_key?: unknown;
  text_size_key?: unknown;
  text_alignment_key?: unknown;
  text_position_key?: unknown;
  presentation?: unknown;
};

type QueueRpcResult = {
  status?: unknown;
  queue?: unknown;
  lumi?: unknown;
  deleted_lumi_id?: unknown;
};

export type LumiPresentation = {
  theme: string;
  animation: string;
  sound: string;
  revealPreset: string;
  background: string;
  font: string;
  textSize: LumiTextSizeKey;
  textAlignment: LumiTextAlignmentKey;
  textPosition: LumiTextPositionKey;
};

export type SenderLumi = {
  id: string;
  text: string;
  queuePosition: number;
  presentation: LumiPresentation;
};

export type SenderQueueSection = "up_next" | "reserve";

export type SenderQueueSnapshot = {
  revision: number;
  current: SenderLumi | null;
  upNext: SenderLumi[];
  reserve: SenderLumi[];
};

export type SenderQueueMutation =
  | {
      type: "reorder";
      section: SenderQueueSection;
      orderedMessageIds: string[];
    }
  | {
      type: "move";
      messageId: string;
      section: SenderQueueSection;
      destination: SenderQueueSection;
      placement: "first" | "last";
    }
  | {
      type: "remove";
      messageId: string;
      section: SenderQueueSection;
    };

export const LUMI_BACKGROUND_KEYS = [
  "heart",
  "champagne",
  "rose",
  "midnight",
] as const;
export const LUMI_FONT_KEYS = ["serif", "rounded"] as const;
export const LUMI_TEXT_SIZE_KEYS = ["small", "medium", "large"] as const;
export const LUMI_TEXT_ALIGNMENT_KEYS = [
  "leading",
  "center",
  "trailing",
] as const;
export const LUMI_TEXT_POSITION_KEYS = ["top", "center", "bottom"] as const;

export type LumiBackgroundKey = (typeof LUMI_BACKGROUND_KEYS)[number];
export type LumiFontKey = (typeof LUMI_FONT_KEYS)[number];
export type LumiTextSizeKey = (typeof LUMI_TEXT_SIZE_KEYS)[number];
export type LumiTextAlignmentKey =
  (typeof LUMI_TEXT_ALIGNMENT_KEYS)[number];
export type LumiTextPositionKey = (typeof LUMI_TEXT_POSITION_KEYS)[number];
export type NormalizedLumiPresentation = {
  background: LumiBackgroundKey;
  font: LumiFontKey;
  textSize: LumiTextSizeKey;
  textAlignment: LumiTextAlignmentKey;
  textPosition: LumiTextPositionKey;
};
export type LumiPresentationPatch = Partial<NormalizedLumiPresentation>;

export const DEFAULT_LUMI_PRESENTATION: NormalizedLumiPresentation = {
  background: "heart",
  font: "serif",
  textSize: "medium",
  textAlignment: "center",
  textPosition: "center",
};

export function safeBackground(value: unknown): LumiBackgroundKey {
  return typeof value === "string" &&
    LUMI_BACKGROUND_KEYS.includes(value as LumiBackgroundKey)
    ? (value as LumiBackgroundKey)
    : DEFAULT_LUMI_PRESENTATION.background;
}

export function safeFont(value: unknown): LumiFontKey {
  return typeof value === "string" &&
    LUMI_FONT_KEYS.includes(value as LumiFontKey)
    ? (value as LumiFontKey)
    : DEFAULT_LUMI_PRESENTATION.font;
}

export function safeTextSize(value: unknown): LumiTextSizeKey {
  return typeof value === "string" &&
    LUMI_TEXT_SIZE_KEYS.includes(value as LumiTextSizeKey)
    ? (value as LumiTextSizeKey)
    : DEFAULT_LUMI_PRESENTATION.textSize;
}

export function safeTextAlignment(value: unknown): LumiTextAlignmentKey {
  return typeof value === "string" &&
    LUMI_TEXT_ALIGNMENT_KEYS.includes(value as LumiTextAlignmentKey)
    ? (value as LumiTextAlignmentKey)
    : DEFAULT_LUMI_PRESENTATION.textAlignment;
}

export function safeTextPosition(value: unknown): LumiTextPositionKey {
  return typeof value === "string" &&
    LUMI_TEXT_POSITION_KEYS.includes(value as LumiTextPositionKey)
    ? (value as LumiTextPositionKey)
    : DEFAULT_LUMI_PRESENTATION.textPosition;
}

export type RevealedLumi = {
  id: string;
  text: string;
  revealedAt: string;
  presentation: SenderLumi["presentation"];
};

export type SenderNecklace = {
  id: string;
  name: string;
  sku: string;
  themeKey: string;
  lifecycleStatus: string;
  isPrimary: boolean;
  availableLumiCount: number;
  nextLumi: SenderLumi | null;
  queue: SenderQueueSnapshot;
  recentlyRevealed: RevealedLumi[];
  reserve: SenderReserveSummary;
};

export class SenderApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export type SenderOwnedNecklace = {
  id: string;
  lifecycleStatus: string;
};

export async function requireSenderOwnedNecklace(
  client: SupabaseClient,
  userId: string,
  necklaceId: string
): Promise<SenderOwnedNecklace> {
  const { data: necklaceData, error: necklaceError } = await client
    .from("necklaces")
    .select("id, lifecycle_status")
    .eq("id", necklaceId)
    .maybeSingle<{ id: string; lifecycle_status: string }>();

  if (necklaceError) {
    throw new Error(necklaceError.message);
  }
  if (!necklaceData) {
    throw new SenderApiError("Necklace not found", 404);
  }

  const { data: ownershipData, error: ownershipError } = await client
    .from("necklace_ownerships")
    .select("id")
    .eq("necklace_id", necklaceId)
    .eq("sender_user_id", userId)
    .maybeSingle<{ id: string }>();

  if (ownershipError) {
    throw new Error(ownershipError.message);
  }
  if (!ownershipData) {
    throw new SenderApiError("Forbidden", 403);
  }

  return {
    id: necklaceData.id,
    lifecycleStatus: necklaceData.lifecycle_status,
  };
}

export function normalizeLumiText(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new SenderApiError("text is required", 400);
  }
  if (text.length > 500) {
    throw new SenderApiError("text must be 500 characters or fewer", 400);
  }
  return text;
}

export function normalizeQueueSection(value: unknown): SenderQueueSection {
  if (value !== "up_next" && value !== "reserve") {
    throw new SenderApiError(
      'destination must be "up_next" or "reserve"',
      400
    );
  }
  return value;
}

export function normalizeLumiPresentation(
  value: unknown
): NormalizedLumiPresentation {
  return normalizeLumiPresentationInput(
    value,
    false
  ) as NormalizedLumiPresentation;
}

export function normalizeLumiPresentationPatch(
  value: unknown
): LumiPresentationPatch {
  return normalizeLumiPresentationInput(value, true);
}

function normalizeLumiPresentationInput(
  value: unknown,
  partial: boolean
): LumiPresentationPatch {
  if (value === undefined) {
    return partial ? {} : DEFAULT_LUMI_PRESENTATION;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SenderApiError("presentation must be an object", 400);
  }

  const presentation = value as Record<string, unknown>;
  const unsupportedKeys = Object.keys(presentation).filter(
    (key) =>
      key !== "background" &&
      key !== "font" &&
      key !== "textSize" &&
      key !== "textAlignment" &&
      key !== "textPosition"
  );
  if (unsupportedKeys.length > 0) {
    throw new SenderApiError(
      `presentation.${unsupportedKeys[0]} is not supported`,
      400
    );
  }

  const background =
    presentation.background === undefined
      ? partial
        ? undefined
        : DEFAULT_LUMI_PRESENTATION.background
      : presentation.background;
  const font =
    presentation.font === undefined
      ? partial
        ? undefined
        : DEFAULT_LUMI_PRESENTATION.font
      : presentation.font;
  const textSize =
    presentation.textSize === undefined
      ? partial
        ? undefined
        : DEFAULT_LUMI_PRESENTATION.textSize
      : presentation.textSize;
  const textAlignment =
    presentation.textAlignment === undefined
      ? partial
        ? undefined
        : DEFAULT_LUMI_PRESENTATION.textAlignment
      : presentation.textAlignment;
  const textPosition =
    presentation.textPosition === undefined
      ? partial
        ? undefined
        : DEFAULT_LUMI_PRESENTATION.textPosition
      : presentation.textPosition;
  if (
    background !== undefined &&
    (typeof background !== "string" ||
      !LUMI_BACKGROUND_KEYS.includes(background as LumiBackgroundKey))
  ) {
    throw new SenderApiError("presentation.background is not supported", 400);
  }
  if (
    font !== undefined &&
    (typeof font !== "string" ||
      !LUMI_FONT_KEYS.includes(font as LumiFontKey))
  ) {
    throw new SenderApiError("presentation.font is not supported", 400);
  }
  if (
    textSize !== undefined &&
    (typeof textSize !== "string" ||
      !LUMI_TEXT_SIZE_KEYS.includes(textSize as LumiTextSizeKey))
  ) {
    throw new SenderApiError("presentation.textSize is not supported", 400);
  }
  if (
    textAlignment !== undefined &&
    (typeof textAlignment !== "string" ||
      !LUMI_TEXT_ALIGNMENT_KEYS.includes(
        textAlignment as LumiTextAlignmentKey
      ))
  ) {
    throw new SenderApiError(
      "presentation.textAlignment is not supported",
      400
    );
  }
  if (
    textPosition !== undefined &&
    (typeof textPosition !== "string" ||
      !LUMI_TEXT_POSITION_KEYS.includes(textPosition as LumiTextPositionKey))
  ) {
    throw new SenderApiError(
      "presentation.textPosition is not supported",
      400
    );
  }

  return Object.fromEntries(
    Object.entries({
      background,
      font,
      textSize,
      textAlignment,
      textPosition,
    }).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as LumiPresentationPatch;
}

function mapLumi(row: LumiRow, fallbackTheme: string): SenderLumi {
  const background = safeBackground(row.theme_key ?? fallbackTheme);
  return {
    id: row.id,
    text: row.content,
    queuePosition: row.queue_position,
    presentation: {
      theme: background,
      animation: row.animation_key ?? "breathe",
      sound: row.sound_key ?? "soft",
      revealPreset: "wordRise",
      background,
      font: safeFont(row.font_key),
      textSize: safeTextSize(row.text_size_key),
      textAlignment: safeTextAlignment(row.text_alignment_key),
      textPosition: safeTextPosition(row.text_position_key),
    },
  };
}

function mapRevealedLumi(row: LumiRow, fallbackTheme: string): RevealedLumi {
  if (!row.revealed_at) {
    throw new Error("Invalid revealed Lumi response");
  }

  const lumi = mapLumi(row, fallbackTheme);
  return {
    id: lumi.id,
    text: lumi.text,
    revealedAt: row.revealed_at,
    presentation: lumi.presentation,
  };
}

function compareQueueRows(left: LumiRow, right: LumiRow) {
  return (
    left.queue_position - right.queue_position ||
    (left.created_at ?? "").localeCompare(right.created_at ?? "") ||
    left.id.localeCompare(right.id)
  );
}

function buildQueueSnapshot(
  revision: number,
  rows: LumiRow[],
  fallbackTheme: string
): SenderQueueSnapshot {
  const activeIds = new Set<string>();
  const positions = new Set<string>();
  let current: SenderLumi | null = null;
  const upNext: SenderLumi[] = [];
  const reserve: SenderLumi[] = [];

  for (const row of [...rows].sort(compareQueueRows)) {
    if (
      row.queue_section !== "current" &&
      row.queue_section !== "up_next" &&
      row.queue_section !== "reserve"
    ) {
      throw new Error("Malformed queue membership");
    }
    if (activeIds.has(row.id)) {
      throw new Error("Duplicate queue membership");
    }
    activeIds.add(row.id);

    const positionKey = `${row.queue_section}:${row.queue_position}`;
    if (positions.has(positionKey)) {
      throw new Error("Duplicate queue position");
    }
    positions.add(positionKey);

    const lumi = mapLumi(row, fallbackTheme);
    if (row.queue_section === "current") {
      if (current) throw new Error("Duplicate current queue membership");
      current = lumi;
    } else if (row.queue_section === "up_next") {
      upNext.push(lumi);
    } else {
      reserve.push(lumi);
    }
  }

  return { revision, current, upNext, reserve };
}

function compareRevealedRows(left: LumiRow, right: LumiRow) {
  return (
    (right.revealed_at ?? "").localeCompare(left.revealed_at ?? "") ||
    right.id.localeCompare(left.id)
  );
}

export async function listSenderNecklaces(
  client: SupabaseClient,
  userId: string
): Promise<SenderNecklace[]> {
  const { data: ownershipData, error: ownershipError } = await client
    .from("necklace_ownerships")
    .select("necklace_id, is_primary, claimed_at")
    .eq("sender_user_id", userId);

  if (ownershipError) {
    throw new Error(ownershipError.message);
  }

  const ownerships = (ownershipData ?? []) as OwnershipRow[];
  if (ownerships.length === 0) {
    return [];
  }

  const necklaceIds = ownerships.map((ownership) => ownership.necklace_id);
  const [
    { data: necklaceData, error: necklaceError },
    { data: lumiData, error: lumiError },
    { data: revealedData, error: revealedError },
  ] =
    await Promise.all([
      client
        .from("necklaces")
        .select("id, name, sku, theme_key, lifecycle_status, queue_revision")
        .in("id", necklaceIds),
      client
        .from("necklace_lumis")
        .select(
          "id, necklace_id, content, queue_position, queue_section, theme_key, animation_key, sound_key, background_key, font_key, text_size_key, text_alignment_key, text_position_key, created_at"
        )
        .in("necklace_id", necklaceIds)
        .eq("is_enabled", true)
        .is("revealed_at", null)
        .order("queue_position", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      client
        .from("necklace_lumis")
        .select(
          "id, necklace_id, content, queue_position, theme_key, animation_key, sound_key, background_key, font_key, text_size_key, text_alignment_key, text_position_key, revealed_at"
        )
        .in("necklace_id", necklaceIds)
        .not("revealed_at", "is", null)
        .order("revealed_at", { ascending: false })
        .order("id", { ascending: false }),
    ]);

  if (necklaceError) {
    throw new Error(necklaceError.message);
  }
  if (lumiError) {
    throw new Error(lumiError.message);
  }
  if (revealedError) {
    throw new Error(revealedError.message);
  }

  const necklaces = (necklaceData ?? []) as NecklaceRow[];
  const lumis = (lumiData ?? []) as LumiRow[];
  const revealedLumis = (revealedData ?? []) as LumiRow[];
  const reserveByNecklace = await listSenderReserveSummaries(client, necklaceIds);
  const ownershipByNecklace = new Map(
    ownerships.map((ownership) => [ownership.necklace_id, ownership])
  );

  return necklaces
    .map((necklace) => {
      const ownership = ownershipByNecklace.get(necklace.id);
      const themeKey = necklace.theme_key ?? "heart";
      const available = lumis
        .filter((lumi) => lumi.necklace_id === necklace.id)
        .sort(compareQueueRows);
      const queue = buildQueueSnapshot(
        necklace.queue_revision,
        available,
        themeKey
      );
      const recentlyRevealed = revealedLumis
        .filter((lumi) => lumi.necklace_id === necklace.id)
        .sort(compareRevealedRows)
        .slice(0, 5)
        .map((lumi) => mapRevealedLumi(lumi, themeKey));

      return {
        id: necklace.id,
        name: necklace.name,
        sku: necklace.sku,
        themeKey,
        lifecycleStatus: necklace.lifecycle_status,
        isPrimary: ownership?.is_primary === true,
        availableLumiCount:
          (queue.current ? 1 : 0) + queue.upNext.length + queue.reserve.length,
        nextLumi: queue.current,
        queue,
        recentlyRevealed,
        reserve: reserveByNecklace.get(necklace.id) ?? {
          enabled: false,
          approvedCount: 0,
          totalCount: 0,
          categories: [],
        },
        claimedAt: ownership?.claimed_at ?? "",
      };
    })
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      const claimedComparison = left.claimedAt.localeCompare(right.claimedAt);
      return claimedComparison !== 0 ? claimedComparison : left.id.localeCompare(right.id);
    })
    .map(({ claimedAt, ...necklace }) => {
      void claimedAt;
      return necklace;
    });
}

export function parseRpcLumi(value: unknown): SenderLumi {
  const result = value as EnqueueRpcResult | null;
  const text =
    typeof result?.text === "string"
      ? result.text
      : typeof result?.content === "string"
        ? result.content
        : null;
  const queuePosition =
    typeof result?.queuePosition === "number"
      ? result.queuePosition
      : typeof result?.queue_position === "number"
        ? result.queue_position
        : null;
  if (
    !result ||
    typeof result.id !== "string" ||
    text === null
  ) {
    throw new Error("Invalid Lumi response");
  }

  const presentation =
    result.presentation &&
    typeof result.presentation === "object" &&
    !Array.isArray(result.presentation)
      ? (result.presentation as Record<string, unknown>)
      : null;

  return {
    id: result.id,
    text,
    queuePosition: queuePosition ?? 1,
    presentation: (() => {
      const background = safeBackground(
        result.theme_key ??
          presentation?.theme ??
          presentation?.background ??
          result.background_key
      );
      return {
        theme: background,
        animation:
          typeof presentation?.animation === "string"
            ? presentation.animation
            : typeof result.animation_key === "string"
              ? result.animation_key
              : "breathe",
        sound:
          typeof presentation?.sound === "string"
            ? presentation.sound
            : typeof result.sound_key === "string"
              ? result.sound_key
              : "soft",
        revealPreset:
          typeof presentation?.revealPreset === "string"
            ? presentation.revealPreset
            : "wordRise",
        background,
        font: safeFont(presentation?.font ?? result.font_key),
        textSize: safeTextSize(
          presentation?.textSize ?? result.text_size_key
        ),
        textAlignment: safeTextAlignment(
          presentation?.textAlignment ?? result.text_alignment_key
        ),
        textPosition: safeTextPosition(
          presentation?.textPosition ?? result.text_position_key
        ),
      };
    })(),
  };
}

function parseRpcQueue(value: unknown): SenderLumi[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid queue response");
  }
  return value.map(parseRpcLumi);
}

export function parseQueueSnapshot(value: unknown): SenderQueueSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid queue response");
  }
  const queue = value as Record<string, unknown>;
  if (
    typeof queue.revision !== "number" ||
    !Number.isSafeInteger(queue.revision) ||
    queue.revision < 0 ||
    !Array.isArray(queue.upNext) ||
    !Array.isArray(queue.reserve)
  ) {
    throw new Error("Invalid queue response");
  }

  const current = queue.current === null ? null : parseRpcLumi(queue.current);
  const upNext = queue.upNext.map(parseRpcLumi);
  const reserve = queue.reserve.map(parseRpcLumi);
  const ids = [
    ...(current ? [current.id] : []),
    ...upNext.map((lumi) => lumi.id),
    ...reserve.map((lumi) => lumi.id),
  ];
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate queue membership");
  }
  return { revision: queue.revision, current, upNext, reserve };
}

function throwRpcStatus(status: unknown): never {
  if (status === "not_found") {
    throw new SenderApiError("Necklace or Lumi not found", 404);
  }
  if (status === "forbidden") {
    throw new SenderApiError("Forbidden", 403);
  }
  if (status === "conflict") {
    throw new SenderApiError("Lumi is immutable or no longer editable", 409);
  }
  if (status === "stale") {
    throw new SenderApiError("Queue is stale", 409);
  }
  throw new Error("Invalid queue response");
}

async function callQueueRpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>
): Promise<QueueRpcResult> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    if (error.message.includes("duplicate queue membership")) {
      throw new SenderApiError("Message is already in the queue", 409);
    }
    throw new Error(error.message);
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid queue response");
  }
  return data as QueueRpcResult;
}

export async function reorderSenderLumis(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  lumiIds: string[]
): Promise<SenderLumi[]> {
  const result = await callQueueRpc(client, "reorder_necklace_lumis_for_sender", {
    p_user_id: userId,
    p_necklace_id: necklaceId,
    p_lumi_ids: lumiIds,
  });
  if (result.status !== "ok") {
    throwRpcStatus(result.status);
  }
  return parseRpcQueue(result.queue);
}

export async function mutateSenderQueue(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  expectedRevision: number,
  idempotencyKey: string,
  operation: SenderQueueMutation
): Promise<{ stale: boolean; queue: SenderQueueSnapshot }> {
  const result = await callQueueRpc(client, "mutate_necklace_queue_for_sender", {
    p_user_id: userId,
    p_necklace_id: necklaceId,
    p_expected_revision: expectedRevision,
    p_idempotency_key: idempotencyKey,
    p_operation: operation,
  });
  if (result.status === "stale") {
    return { stale: true, queue: parseQueueSnapshot(result.queue) };
  }
  if (result.status !== "ok") {
    throwRpcStatus(result.status);
  }
  return { stale: false, queue: parseQueueSnapshot(result.queue) };
}

export async function editSenderLumi(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  lumiId: string,
  text: string | undefined,
  presentation: LumiPresentationPatch = {}
): Promise<{ lumi: SenderLumi; queue: SenderQueueSnapshot }> {
  const result = await callQueueRpc(client, "edit_necklace_lumi_for_sender", {
    p_user_id: userId,
    p_necklace_id: necklaceId,
    p_lumi_id: lumiId,
    p_content: text ?? null,
    p_background_key: presentation.background ?? null,
    p_font_key: presentation.font ?? null,
    p_text_size_key: presentation.textSize ?? null,
    p_text_alignment_key: presentation.textAlignment ?? null,
    p_text_position_key: presentation.textPosition ?? null,
  });
  if (result.status !== "ok") {
    throwRpcStatus(result.status);
  }
  return {
    lumi: parseRpcLumi(result.lumi),
    queue: parseQueueSnapshot(result.queue),
  };
}

export async function removeSenderLumi(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  lumiId: string
): Promise<{ deletedLumiId: string; queue: SenderQueueSnapshot }> {
  const result = await callQueueRpc(client, "remove_necklace_lumi_for_sender", {
    p_user_id: userId,
    p_necklace_id: necklaceId,
    p_lumi_id: lumiId,
  });
  if (result.status !== "ok") {
    throwRpcStatus(result.status);
  }
  if (typeof result.deleted_lumi_id !== "string") {
    throw new Error("Invalid queue response");
  }
  return {
    deletedLumiId: result.deleted_lumi_id,
    queue: parseQueueSnapshot(result.queue),
  };
}

export async function enqueueSenderLumi(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  text: string,
  destination: SenderQueueSection,
  presentation: NormalizedLumiPresentation = DEFAULT_LUMI_PRESENTATION
): Promise<{ lumi: SenderLumi; queue: SenderQueueSnapshot }> {
  const necklace = await requireSenderOwnedNecklace(
    client,
    userId,
    necklaceId
  );
  if (!["active", "pending_sender_setup"].includes(necklace.lifecycleStatus)) {
    throw new SenderApiError("This Lumi cannot accept new messages", 409);
  }

  const { data, error } = await client.rpc("enqueue_necklace_lumi_for_sender", {
    p_user_id: userId,
    p_necklace_id: necklaceId,
    p_content: text,
    p_destination: destination,
    p_background_key: presentation.background,
    p_font_key: presentation.font,
    p_text_size_key: presentation.textSize,
    p_text_alignment_key: presentation.textAlignment,
    p_text_position_key: presentation.textPosition,
  });

  if (error) {
    if (error.message.includes("duplicate queue membership")) {
      throw new SenderApiError("Message is already in the queue", 409);
    }
    throw new Error(error.message);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Invalid queue response");
  }
  const result = data as QueueRpcResult;
  if (result.status !== "ok") throwRpcStatus(result.status);
  return {
    lumi: parseRpcLumi(result.lumi),
    queue: parseQueueSnapshot(result.queue),
  };
}
