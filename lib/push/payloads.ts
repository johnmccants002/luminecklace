import {
  PUSH_EVENT_TYPES,
  type ApnsPayload,
  type PushEventPayload,
  type PushEventType,
} from "@/lib/push/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPushEventType(value: unknown): value is PushEventType {
  return (
    typeof value === "string" &&
    PUSH_EVENT_TYPES.includes(value as PushEventType)
  );
}

export function parsePushEventPayload(
  value: unknown,
  expectedType: PushEventType
): PushEventPayload {
  if (!isRecord(value) || value.type !== expectedType) {
    throw new Error("Invalid push event payload");
  }
  if (
    typeof value.necklaceId !== "string" ||
    !UUID_PATTERN.test(value.necklaceId) ||
    typeof value.lumiId !== "string" ||
    !UUID_PATTERN.test(value.lumiId) ||
    (value.revealSessionId !== undefined &&
      (typeof value.revealSessionId !== "string" ||
        !UUID_PATTERN.test(value.revealSessionId)))
  ) {
    throw new Error("Invalid push event payload");
  }

  return {
    type: expectedType,
    necklaceId: value.necklaceId,
    lumiId: value.lumiId,
    ...(typeof value.revealSessionId === "string"
      ? { revealSessionId: value.revealSessionId }
      : {}),
    ...(typeof value.reaction === "string"
      ? { reaction: value.reaction }
      : {}),
  };
}

export function buildApnsPayload(
  eventType: PushEventType,
  event: PushEventPayload
): ApnsPayload {
  const common = {
    sound: "default" as const,
    "thread-id": `necklace:${event.necklaceId}`,
  };

  let alert: { title: string; body: string };
  if (eventType === "lumi.revealed") {
    alert = {
      title: "Your Lumi was opened",
      body: "Someone just revealed your message.",
    };
  } else if (eventType === "lumi.reacted") {
    alert = {
      title: "They reacted to your Lumi",
      body: "They reacted to your Lumi.",
    };
  } else {
    alert = {
      title: "You received a response",
      body: "Open Lumi to see their response.",
    };
  }

  return {
    aps: { alert, ...common },
    type: eventType,
    necklaceId: event.necklaceId,
    lumiId: event.lumiId,
  };
}
