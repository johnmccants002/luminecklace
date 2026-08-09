import {
  LUMI_BACKGROUND_KEYS,
  LUMI_FONT_KEYS,
  safeTextAlignment,
  safeTextPosition,
  safeTextSize,
  type LumiBackgroundKey,
  type LumiFontKey,
  type LumiLinkAttachment,
} from "@/lib/sender/necklaces";

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

type ResolveRpcResult = {
  status?: string | null;
  reveal_session_id?: string | null;
  necklace_display_name?: string | null;
  lumi_id?: string | null;
  necklace_lumi_id?: string | null;
  lumi_text?: string | null;
  experience_preset_key?: string | null;
  secondary_text?: string | null;
  presentation?: {
    theme?: string | null;
    animation?: string | null;
    sound?: string | null;
    revealPreset?: string | null;
    background?: string | null;
    font?: string | null;
    textSize?: string | null;
    textAlignment?: string | null;
    textPosition?: string | null;
  } | null;
  attachment?: unknown;
};

type RevealRpcResult = {
  status?: string | null;
  revealed_at?: string | null;
};

export type PublicRecipientResolveResponse =
  | {
      status: "ready";
      revealSessionId: string;
      necklace: { displayName: string };
      lumi: {
        id: string;
        text: string;
        experiencePresetKey: string;
        secondaryText?: string;
      };
      presentation: {
        theme: string;
        animation: string;
        sound: string;
        revealPreset: string;
        background: string;
        font: string;
        textSize: "small" | "medium" | "large";
        textAlignment: "leading" | "center" | "trailing";
        textPosition: "top" | "center" | "bottom";
      };
      attachment?: LumiLinkAttachment;
    }
  | { status: "empty" }
  | { status: "unavailable" };

export type PublicRecipientRevealResponse =
  | { status: "revealed"; revealedAt: string }
  | { status: "expired" }
  | { status: "unavailable" };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeRecipientBackground(value: unknown): LumiBackgroundKey {
  return typeof value === "string" &&
    LUMI_BACKGROUND_KEYS.includes(value as LumiBackgroundKey)
    ? (value as LumiBackgroundKey)
    : "heart";
}

function safeFont(value: unknown): LumiFontKey {
  return typeof value === "string" &&
    LUMI_FONT_KEYS.includes(value as LumiFontKey)
    ? (value as LumiFontKey)
    : "serif";
}

function isResolveRpcResult(value: unknown): value is ResolveRpcResult {
  return typeof value === "object" && value !== null && "status" in value;
}

function isRevealRpcResult(value: unknown): value is RevealRpcResult {
  return typeof value === "object" && value !== null && "status" in value;
}

function parseRecipientAttachment(value: unknown): LumiLinkAttachment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const attachment = value as Record<string, unknown>;
  if (
    attachment.type !== "link" ||
    attachment.provider !== "instagram" ||
    !["post", "reel", "story", "profile", "instagram_link"].includes(
      String(attachment.contentKind)
    ) ||
    typeof attachment.url !== "string" ||
    !attachment.url.startsWith("https://instagram.com/") ||
    attachment.host !== "instagram.com" ||
    attachment.ctaLabel !== "View on Instagram" ||
    attachment.openMode !== "external"
  ) {
    return undefined;
  }
  return attachment as LumiLinkAttachment;
}

export async function resolveNextRecipientTap(
  client: RpcClient,
  tokenHash: string
): Promise<PublicRecipientResolveResponse> {
  const { data, error } = await client.rpc("resolve_next_necklace_lumi", {
    p_token_hash: tokenHash,
  });

  if (error) {
    throw new Error(error.message ?? "Failed to resolve necklace");
  }

  if (!isResolveRpcResult(data)) {
    throw new Error("Failed to resolve necklace");
  }

  if (data.status === "ready") {
    const lumiId = isNonEmptyString(data.lumi_id)
      ? data.lumi_id
      : data.necklace_lumi_id;
    if (
      !isNonEmptyString(data.reveal_session_id) ||
      !isNonEmptyString(lumiId) ||
      !isNonEmptyString(data.lumi_text)
    ) {
      throw new Error("Failed to resolve necklace");
    }

    const presentation = data.presentation ?? {};
    const background = safeRecipientBackground(
      presentation.theme ?? presentation.background
    );

    const response: Extract<
      PublicRecipientResolveResponse,
      { status: "ready" }
    > = {
      status: "ready",
      revealSessionId: data.reveal_session_id,
      necklace: {
        displayName: isNonEmptyString(data.necklace_display_name)
          ? data.necklace_display_name
          : "Lumi Necklace",
      },
      lumi: {
        id: lumiId,
        text: data.lumi_text,
        experiencePresetKey: isNonEmptyString(data.experience_preset_key)
          ? data.experience_preset_key
          : "classic_word_rise_v1",
        ...(isNonEmptyString(data.secondary_text)
          ? { secondaryText: data.secondary_text }
          : {}),
      },
      presentation: {
        theme: background,
        animation: isNonEmptyString(presentation.animation)
          ? presentation.animation
          : "breathe",
        sound: isNonEmptyString(presentation.sound) ? presentation.sound : "soft",
        revealPreset: isNonEmptyString(presentation.revealPreset)
          ? presentation.revealPreset
          : "wordRise",
        background,
        font: safeFont(presentation.font),
        textSize: safeTextSize(presentation.textSize),
        textAlignment: safeTextAlignment(presentation.textAlignment),
        textPosition: safeTextPosition(presentation.textPosition),
      },
    };
    const attachment = parseRecipientAttachment(data.attachment);
    if (attachment) response.attachment = attachment;
    return response;
  }

  if (data.status === "empty") {
    return { status: "empty" };
  }

  if (data.status === "unavailable") {
    return { status: "unavailable" };
  }

  throw new Error("Failed to resolve necklace");
}

export async function confirmRecipientReveal(
  client: RpcClient,
  revealSessionId: string
): Promise<PublicRecipientRevealResponse> {
  const { data, error } = await client.rpc("confirm_necklace_lumi_reveal", {
    p_reveal_session_id: revealSessionId,
  });

  if (error) {
    throw new Error(error.message ?? "Failed to reveal necklace");
  }

  if (!isRevealRpcResult(data)) {
    throw new Error("Failed to reveal necklace");
  }

  if (data.status === "revealed") {
    if (!isNonEmptyString(data.revealed_at)) {
      throw new Error("Failed to reveal necklace");
    }

    return {
      status: "revealed",
      revealedAt: data.revealed_at,
    };
  }

  if (data.status === "expired") {
    return { status: "expired" };
  }

  if (data.status === "unavailable") {
    return { status: "unavailable" };
  }

  throw new Error("Failed to reveal necklace");
}
