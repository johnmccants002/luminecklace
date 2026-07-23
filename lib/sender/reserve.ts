import type { SupabaseClient } from "@supabase/supabase-js";

type ReserveMessageRow = {
  id: string;
  category: string | null;
};

type ReserveSettingRow = {
  necklace_id: string;
  is_enabled: boolean;
};

type ReserveItemRow = {
  necklace_id: string;
  message_id: string;
  is_approved: boolean;
};

export type SenderReserveCategorySummary = {
  key: string;
  approvedCount: number;
  totalCount: number;
};

export type SenderReserveSummary = {
  enabled: boolean;
  approvedCount: number;
  totalCount: number;
  categories: SenderReserveCategorySummary[];
};

export async function listSenderReserveSummaries(
  client: SupabaseClient,
  necklaceIds: string[]
): Promise<Map<string, SenderReserveSummary>> {
  if (necklaceIds.length === 0) {
    return new Map();
  }

  const [
    { data: settingData, error: settingError },
    { data: itemData, error: itemError },
    { data: messageData, error: messageError },
  ] = await Promise.all([
    client
      .from("necklace_reserve_settings")
      .select("necklace_id, is_enabled")
      .in("necklace_id", necklaceIds),
    client
      .from("necklace_reserve_items")
      .select("necklace_id, message_id, is_approved")
      .in("necklace_id", necklaceIds),
    client
      .from("messages")
      .select("id, category")
      .eq("is_reserve_eligible", true)
      .order("reserve_sort_order", { ascending: true }),
  ]);

  if (settingError) {
    throw new Error(settingError.message);
  }
  if (itemError) {
    throw new Error(itemError.message);
  }
  if (messageError) {
    throw new Error(messageError.message);
  }

  const settings = (settingData ?? []) as ReserveSettingRow[];
  const items = (itemData ?? []) as ReserveItemRow[];
  const messages = (messageData ?? []) as ReserveMessageRow[];
  const settingByNecklace = new Map(
    settings.map((setting) => [setting.necklace_id, setting])
  );
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const categoryKeys = Array.from(
    new Set(messages.map((message) => message.category ?? "uncategorized"))
  );

  return new Map(
    necklaceIds.map((necklaceId) => {
      const necklaceItems = items.filter(
        (item) => item.necklace_id === necklaceId && messageById.has(item.message_id)
      );
      const approvedMessageIds = new Set(
        necklaceItems
          .filter((item) => item.is_approved)
          .map((item) => item.message_id)
      );

      return [
        necklaceId,
        {
          enabled: settingByNecklace.get(necklaceId)?.is_enabled === true,
          approvedCount: approvedMessageIds.size,
          totalCount: messages.length,
          categories: categoryKeys.map((key) => {
            const categoryMessages = messages.filter(
              (message) => (message.category ?? "uncategorized") === key
            );
            return {
              key,
              approvedCount: categoryMessages.filter((message) =>
                approvedMessageIds.has(message.id)
              ).length,
              totalCount: categoryMessages.length,
            };
          }),
        },
      ];
    })
  );
}
