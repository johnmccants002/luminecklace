import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  type MessageLibraryCategoryKey,
} from "@/lib/sender/message-library-contract";
import {
  parseQueueSnapshot,
  parseRpcLumi,
  requireSenderOwnedNecklace,
  safeTextAlignment,
  safeTextPosition,
  safeTextSize,
  SenderApiError,
  type SenderQueueSection,
  type SenderQueueSnapshot,
  type SenderLumi,
} from "@/lib/sender/necklaces";

type CatalogRow = {
  id: string;
  text: string;
  category: MessageLibraryCategoryKey;
  explore_sort_order: number;
  theme_key: string | null;
  animation_key: string | null;
  sound_key: string | null;
  background_key: string | null;
  font_key: string | null;
  text_size_key: string | null;
  text_alignment_key: string | null;
  text_position_key: string | null;
};

type UsageRow = {
  source_message_id: string | null;
  is_enabled: boolean;
  revealed_at: string | null;
  created_at: string;
};

type CategoryRow = {
  key: string;
  name: string;
  sort_order: number;
};

export type MessageLibraryQuery = {
  category?: MessageLibraryCategoryKey;
  search?: string;
  limit: number;
  cursor?: string;
  necklaceId?: string;
};

export async function listSenderMessageLibrary(
  client: SupabaseClient,
  userId: string,
  options: MessageLibraryQuery
) {
  if (options.necklaceId) {
    await requireSenderOwnedNecklace(client, userId, options.necklaceId);
  }

  const categoriesResult = await client
    .from("message_categories")
    .select("key, name, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (categoriesResult.error) {
    throw new Error("Failed to load message library categories");
  }
  const categories = (categoriesResult.data ?? []) as CategoryRow[];
  const categoryByKey = new Map(
    categories.map((category) => [category.key, category])
  );
  if (options.category && !categoryByKey.has(options.category)) {
    throw new SenderApiError("category is not supported", 400);
  }

  const cursor = decodeLibraryCursor(options.cursor);
  if (cursor && !categoryByKey.has(cursor.category)) {
    throw new SenderApiError("cursor is invalid", 400);
  }
  if (cursor && options.category && cursor.category !== options.category) {
    throw new SenderApiError("cursor does not match category", 400);
  }
  if (!categories.length) {
    return { categories: [], messages: [], nextCursor: null };
  }
  let query = client
    .from("messages")
    .select(
      "id, text, category, explore_sort_order, theme_key, animation_key, sound_key, background_key, font_key, text_size_key, text_alignment_key, text_position_key"
    )
    .eq("is_active", true)
    .eq("is_explore_published", true)
    .in("category", categories.map((category) => category.key))
    .order("category", { ascending: true })
    .order("explore_sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(options.limit + 1);

  if (options.category) query = query.eq("category", options.category);
  if (options.search) query = query.ilike("text", `%${options.search}%`);
  if (cursor) {
    query = query.or(
      `category.gt.${cursor.category},and(category.eq.${cursor.category},explore_sort_order.gt.${cursor.sortOrder}),and(category.eq.${cursor.category},explore_sort_order.eq.${cursor.sortOrder},id.gt.${cursor.id})`
    );
  }

  const [messagesResult, ...categoryResults] = await Promise.all([
    query,
    ...categories.map((category) =>
      client
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("is_explore_published", true)
        .eq("category", category.key)
    ),
  ]);
  if (messagesResult.error || categoryResults.some((result) => result.error)) {
    throw new Error("Failed to load message library");
  }

  const fetched = (messagesResult.data ?? []) as CatalogRow[];
  const hasMore = fetched.length > options.limit;
  const rows = fetched.slice(0, options.limit);
  const messageIds = rows.map((row) => row.id);
  let usageRows: UsageRow[] = [];
  if (options.necklaceId && messageIds.length) {
    const usage = await client
      .from("necklace_lumis")
      .select("source_message_id, is_enabled, revealed_at, created_at")
      .eq("necklace_id", options.necklaceId)
      .in("source_message_id", messageIds);
    if (usage.error) throw new Error("Failed to load library usage");
    usageRows = (usage.data ?? []) as UsageRow[];
  }

  const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return {
    categories: categories.map((category, index) => ({
      key: category.key,
      name: category.name,
      sortOrder: category.sort_order,
      messageCount: categoryResults[index].count ?? 0,
    })),
    messages: rows.map((row) => {
      const category = categoryByKey.get(row.category);
      if (!category) throw new Error("Invalid message category");
      const usages = usageRows.filter(
        (usage) => usage.source_message_id === row.id
      );
      const lastUsedAt = usages
        .map((usage) => usage.created_at)
        .sort((left, right) => right.localeCompare(left))[0] ?? null;
      return {
        id: row.id,
        text: row.text,
        category: { key: category.key, name: category.name },
        presentation: {
          theme: row.theme_key ?? "heart",
          animation: row.animation_key ?? "breathe",
          sound: row.sound_key ?? "soft",
          revealPreset: "wordRise",
          background: row.background_key ?? "rose_glow",
          font: row.font_key ?? "serif",
          textSize: safeTextSize(row.text_size_key),
          textAlignment: safeTextAlignment(row.text_alignment_key),
          textPosition: safeTextPosition(row.text_position_key),
        },
        ...(options.necklaceId
          ? {
              isQueued: usages.some(
                (usage) => usage.is_enabled && usage.revealed_at === null
              ),
              wasRecentlyRevealed: usages.some(
                (usage) =>
                  usage.revealed_at !== null &&
                  Date.parse(usage.revealed_at) >= recentThreshold
              ),
              lastUsedAt,
            }
          : {}),
      };
    }),
    nextCursor: hasMore
      ? encodeLibraryCursor({
          category: rows[rows.length - 1].category,
          sortOrder: rows[rows.length - 1].explore_sort_order,
          id: rows[rows.length - 1].id,
        })
      : null,
  };
}

export async function enqueueSenderLibraryMessage(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  messageId: string,
  destination: SenderQueueSection
): Promise<{ lumi: SenderLumi; queue: SenderQueueSnapshot }> {
  const necklace = await requireSenderOwnedNecklace(
    client,
    userId,
    necklaceId
  );
  if (!["active", "pending_sender_setup"].includes(necklace.lifecycleStatus)) {
    throw new SenderApiError("This Lumi cannot accept new messages", 409);
  }

  const { data, error } = await client.rpc(
    "enqueue_library_message_for_sender",
    {
      p_user_id: userId,
      p_necklace_id: necklaceId,
      p_message_id: messageId,
      p_destination: destination,
    }
  );
  if (error) {
    if (error.message.includes("library message not found")) {
      throw new SenderApiError("Library message not found", 404);
    }
    if (error.message.includes("invalid content")) {
      throw new SenderApiError("text must be between 1 and 500 characters", 400);
    }
    if (error.message.includes("duplicate queue membership")) {
      throw new SenderApiError("Message is already in the queue", 409);
    }
    throw new Error(error.message);
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid queue response");
  }
  const result = data as {
    status?: unknown;
    lumi?: unknown;
    queue?: unknown;
  };
  if (result.status !== "ok") {
    throw new Error("Invalid queue response");
  }
  return {
    lumi: parseRpcLumi(result.lumi),
    queue: parseQueueSnapshot(result.queue),
  };
}
