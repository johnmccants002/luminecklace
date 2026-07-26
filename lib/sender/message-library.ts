import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  MESSAGE_LIBRARY_CATEGORIES,
  type MessageLibraryCategoryKey,
} from "@/lib/sender/message-library-contract";
import {
  normalizeLumiText,
  parseRpcLumi,
  requireSenderOwnedNecklace,
  SenderApiError,
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
};

type UsageRow = {
  source_message_id: string | null;
  is_enabled: boolean;
  revealed_at: string | null;
  created_at: string;
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

  const cursor = decodeLibraryCursor(options.cursor);
  if (cursor && options.category && cursor.category !== options.category) {
    throw new SenderApiError("cursor does not match category", 400);
  }
  let query = client
    .from("messages")
    .select(
      "id, text, category, explore_sort_order, theme_key, animation_key, sound_key"
    )
    .eq("is_active", true)
    .eq("is_explore_published", true)
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
    ...MESSAGE_LIBRARY_CATEGORIES.map((category) =>
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

  const categoryByKey = new Map(
    MESSAGE_LIBRARY_CATEGORIES.map((category) => [category.key, category])
  );
  const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return {
    categories: MESSAGE_LIBRARY_CATEGORIES.map((category, index) => ({
      ...category,
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
  personalizedText?: unknown
): Promise<SenderLumi> {
  const necklace = await requireSenderOwnedNecklace(
    client,
    userId,
    necklaceId
  );
  if (!["active", "pending_sender_setup"].includes(necklace.lifecycleStatus)) {
    throw new SenderApiError("This Lumi cannot accept new messages", 409);
  }

  const text =
    personalizedText === undefined
      ? null
      : normalizeLumiText(personalizedText);

  const { data, error } = await client.rpc(
    "enqueue_library_message_for_sender",
    {
      p_user_id: userId,
      p_necklace_id: necklaceId,
      p_message_id: messageId,
      p_personalized_content: text,
    }
  );
  if (error) {
    if (error.message.includes("library message not found")) {
      throw new SenderApiError("Library message not found", 404);
    }
    if (error.message.includes("invalid content")) {
      throw new SenderApiError("text must be between 1 and 500 characters", 400);
    }
    throw new Error(error.message);
  }
  return parseRpcLumi(data);
}
