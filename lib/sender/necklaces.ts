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
};

type LumiRow = {
  id: string;
  necklace_id: string;
  content: string;
  queue_position: number;
  theme_key: string | null;
  animation_key: string | null;
  sound_key: string | null;
  created_at?: string;
  revealed_at?: string | null;
};

type EnqueueRpcResult = {
  id?: unknown;
  content?: unknown;
  queue_position?: unknown;
  theme_key?: unknown;
  animation_key?: unknown;
  sound_key?: unknown;
};

type QueueRpcResult = {
  status?: unknown;
  queue?: unknown;
  lumi?: unknown;
  deleted_lumi_id?: unknown;
};

export type SenderLumi = {
  id: string;
  text: string;
  queuePosition: number;
  presentation: {
    theme: string;
    animation: string;
    sound: string;
  };
};

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
  queue: SenderLumi[];
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

function mapLumi(row: LumiRow, fallbackTheme: string): SenderLumi {
  return {
    id: row.id,
    text: row.content,
    queuePosition: row.queue_position,
    presentation: {
      theme: row.theme_key ?? fallbackTheme,
      animation: row.animation_key ?? "breathe",
      sound: row.sound_key ?? "soft",
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
        .select("id, name, sku, theme_key, lifecycle_status")
        .in("id", necklaceIds),
      client
        .from("necklace_lumis")
        .select(
          "id, necklace_id, content, queue_position, theme_key, animation_key, sound_key, created_at"
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
          "id, necklace_id, content, queue_position, theme_key, animation_key, sound_key, revealed_at"
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
      const queue = available.map((lumi) => mapLumi(lumi, themeKey));
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
        availableLumiCount: queue.length,
        nextLumi: queue[0] ?? null,
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

function parseRpcLumi(value: unknown): SenderLumi {
  const result = value as EnqueueRpcResult | null;
  if (
    !result ||
    typeof result.id !== "string" ||
    typeof result.content !== "string" ||
    typeof result.queue_position !== "number"
  ) {
    throw new Error("Invalid Lumi response");
  }

  return {
    id: result.id,
    text: result.content,
    queuePosition: result.queue_position,
    presentation: {
      theme: typeof result.theme_key === "string" ? result.theme_key : "heart",
      animation:
        typeof result.animation_key === "string" ? result.animation_key : "breathe",
      sound: typeof result.sound_key === "string" ? result.sound_key : "soft",
    },
  };
}

function parseRpcQueue(value: unknown): SenderLumi[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid queue response");
  }
  return value.map(parseRpcLumi);
}

function throwRpcStatus(status: unknown): never {
  if (status === "not_found") {
    throw new SenderApiError("Necklace or Lumi not found", 404);
  }
  if (status === "forbidden") {
    throw new SenderApiError("Forbidden", 403);
  }
  if (status === "conflict") {
    throw new SenderApiError("Lumi is no longer in the active queue", 409);
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

export async function editSenderLumi(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  lumiId: string,
  text: string
): Promise<SenderLumi> {
  const result = await callQueueRpc(client, "edit_necklace_lumi_for_sender", {
    p_user_id: userId,
    p_necklace_id: necklaceId,
    p_lumi_id: lumiId,
    p_content: text,
  });
  if (result.status !== "ok") {
    throwRpcStatus(result.status);
  }
  return parseRpcLumi(result.lumi);
}

export async function removeSenderLumi(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  lumiId: string
): Promise<{ deletedLumiId: string; queue: SenderLumi[] }> {
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
    queue: parseRpcQueue(result.queue),
  };
}

export async function enqueueSenderLumi(
  client: SupabaseClient,
  userId: string,
  necklaceId: string,
  text: string
): Promise<SenderLumi> {
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
  if (!["active", "pending_sender_setup"].includes(necklaceData.lifecycle_status)) {
    throw new SenderApiError("This Lumi cannot accept new messages", 409);
  }

  const { data, error } = await client.rpc("enqueue_necklace_lumi_for_sender", {
    p_user_id: userId,
    p_necklace_id: necklaceId,
    p_content: text,
  });

  if (error) {
    throw new Error(error.message);
  }

  return parseRpcLumi(data);
}
