export const LUMI_REACTION_KEYS = [
  "heart",
  "touched",
  "laugh",
  "sparkle",
  "hug",
  "wow",
] as const;

export type LumiReactionKey = (typeof LUMI_REACTION_KEYS)[number];

export type LumiRevealFeedback = {
  reaction: LumiReactionKey | null;
  reactionAt: string | null;
  responseText: string | null;
  respondedAt: string | null;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

type RawFeedback = {
  necklace_lumi_id?: unknown;
  reveal_session_id?: unknown;
  reaction_key?: unknown;
  reacted_at?: unknown;
  response_text?: unknown;
  responded_at?: unknown;
};

type RawFeedbackResult = {
  status?: unknown;
  feedback?: unknown;
};

export type SetLumiReactionResult =
  | { status: "reacted"; feedback: LumiRevealFeedback }
  | { status: "invalid_reaction" }
  | { status: "not_revealed" }
  | { status: "expired" }
  | { status: "unavailable" };

export type SubmitLumiResponseResult =
  | { status: "responded"; feedback: LumiRevealFeedback }
  | { status: "already_responded"; feedback: LumiRevealFeedback }
  | { status: "invalid_response" }
  | { status: "not_revealed" }
  | { status: "expired" }
  | { status: "unavailable" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLumiReactionKey(value: unknown): value is LumiReactionKey {
  return (
    typeof value === "string" &&
    LUMI_REACTION_KEYS.includes(value as LumiReactionKey)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Invalid feedback response");
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Invalid feedback response");
  }
  return timestamp.toISOString();
}

function parseFeedback(
  value: unknown,
  expectedRevealSessionId: string
): LumiRevealFeedback {
  if (!isRecord(value)) {
    throw new Error("Invalid feedback response");
  }
  const feedback = value as RawFeedback;
  if (
    !UUID_PATTERN.test(expectedRevealSessionId) ||
    typeof feedback.necklace_lumi_id !== "string" ||
    !UUID_PATTERN.test(feedback.necklace_lumi_id) ||
    feedback.reveal_session_id !== expectedRevealSessionId
  ) {
    throw new Error("Invalid feedback response");
  }

  const reaction = feedback.reaction_key;
  if (reaction !== null && !isLumiReactionKey(reaction)) {
    throw new Error("Invalid feedback response");
  }
  const reactionAt = normalizeTimestamp(feedback.reacted_at);
  if ((reaction === null) !== (reactionAt === null)) {
    throw new Error("Invalid feedback response");
  }

  const responseText = feedback.response_text;
  if (
    responseText !== null &&
    (typeof responseText !== "string" ||
      responseText !== responseText.trim() ||
      responseText.length < 1 ||
      Array.from(responseText).length > 250)
  ) {
    throw new Error("Invalid feedback response");
  }
  const respondedAt = normalizeTimestamp(feedback.responded_at);
  if ((responseText === null) !== (respondedAt === null)) {
    throw new Error("Invalid feedback response");
  }
  if (reaction === null && responseText === null) {
    throw new Error("Invalid feedback response");
  }

  return { reaction, reactionAt, responseText, respondedAt };
}

function parseResult(data: unknown): RawFeedbackResult {
  if (!isRecord(data) || typeof data.status !== "string") {
    throw new Error("Invalid feedback response");
  }
  return data;
}

export async function setLumiReaction(
  client: RpcClient,
  revealSessionId: string,
  reaction: LumiReactionKey
): Promise<SetLumiReactionResult> {
  const { data, error } = await client.rpc("set_lumi_reaction", {
    p_reveal_session_id: revealSessionId,
    p_reaction_key: reaction,
  });
  if (error) {
    throw new Error(error.message ?? "Failed to set Lumi reaction");
  }

  const result = parseResult(data);
  if (result.status === "reacted") {
    const feedback = parseFeedback(result.feedback, revealSessionId);
    if (feedback.reaction !== reaction) {
      throw new Error("Invalid feedback response");
    }
    return { status: "reacted", feedback };
  }
  if (
    result.status === "invalid_reaction" ||
    result.status === "not_revealed" ||
    result.status === "expired" ||
    result.status === "unavailable"
  ) {
    return { status: result.status };
  }
  throw new Error("Invalid feedback response");
}

export async function submitLumiResponse(
  client: RpcClient,
  revealSessionId: string,
  responseText: string
): Promise<SubmitLumiResponseResult> {
  const { data, error } = await client.rpc("submit_lumi_response", {
    p_reveal_session_id: revealSessionId,
    p_response_text: responseText,
  });
  if (error) {
    throw new Error(error.message ?? "Failed to submit Lumi response");
  }

  const result = parseResult(data);
  if (result.status === "responded" || result.status === "already_responded") {
    const feedback = parseFeedback(result.feedback, revealSessionId);
    if (feedback.responseText === null) {
      throw new Error("Invalid feedback response");
    }
    return { status: result.status, feedback };
  }
  if (
    result.status === "invalid_response" ||
    result.status === "not_revealed" ||
    result.status === "expired" ||
    result.status === "unavailable"
  ) {
    return { status: result.status };
  }
  throw new Error("Invalid feedback response");
}
