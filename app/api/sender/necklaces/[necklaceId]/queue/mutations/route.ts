import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import {
  mutateSenderQueue,
  normalizeQueueSection,
  SenderApiError,
  type SenderQueueMutation,
} from "@/lib/sender/necklaces";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";

type RouteContext = {
  params: Promise<{ necklaceId: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new SenderApiError(`${field} must be a UUID`, 400);
  }
  return value;
}

function rejectExtraKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new SenderApiError("operation contains unsupported fields", 400);
  }
}

function parseOperation(value: unknown): SenderQueueMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SenderApiError("operation must be an object", 400);
  }
  const operation = value as Record<string, unknown>;

  if (operation.type === "reorder") {
    rejectExtraKeys(operation, ["type", "section", "orderedMessageIds"]);
    const section = normalizeQueueSection(operation.section);
    if (
      !Array.isArray(operation.orderedMessageIds) ||
      !operation.orderedMessageIds.every(
        (id) => typeof id === "string" && UUID_PATTERN.test(id)
      )
    ) {
      throw new SenderApiError(
        "orderedMessageIds must be an array of UUIDs",
        400
      );
    }
    const orderedMessageIds = operation.orderedMessageIds as string[];
    if (new Set(orderedMessageIds).size !== orderedMessageIds.length) {
      throw new SenderApiError("orderedMessageIds must be unique", 400);
    }
    return { type: "reorder", section, orderedMessageIds };
  }

  if (operation.type === "move") {
    rejectExtraKeys(operation, [
      "type",
      "messageId",
      "section",
      "destination",
      "placement",
    ]);
    const placement = operation.placement;
    if (placement !== "first" && placement !== "last") {
      throw new SenderApiError(
        'placement must be "first" or "last"',
        400
      );
    }
    return {
      type: "move",
      messageId: requireUuid(operation.messageId, "messageId"),
      section: normalizeQueueSection(operation.section),
      destination: normalizeQueueSection(operation.destination),
      placement,
    };
  }

  if (operation.type === "remove") {
    rejectExtraKeys(operation, ["type", "messageId", "section"]);
    return {
      type: "remove",
      messageId: requireUuid(operation.messageId, "messageId"),
      section: normalizeQueueSection(operation.section),
    };
  }

  throw new SenderApiError(
    'operation.type must be "reorder", "move", or "remove"',
    400
  );
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const { necklaceId } = await context.params;
    requireUuid(necklaceId, "necklaceId");

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new SenderApiError("body must be an object", 400);
    }
    if (
      Object.keys(body).some(
        (key) =>
          !["expectedRevision", "idempotencyKey", "operation"].includes(key)
      )
    ) {
      throw new SenderApiError("body contains unsupported fields", 400);
    }
    if (
      typeof body.expectedRevision !== "number" ||
      !Number.isSafeInteger(body.expectedRevision) ||
      body.expectedRevision < 0
    ) {
      throw new SenderApiError(
        "expectedRevision must be a non-negative integer",
        400
      );
    }

    const result = await mutateSenderQueue(
      supabaseAdmin,
      user.id,
      necklaceId,
      body.expectedRevision,
      requireUuid(body.idempotencyKey, "idempotencyKey"),
      parseOperation(body.operation)
    );
    return NextResponse.json(
      { queue: result.queue },
      { status: result.stale ? 409 : 200 }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof SenderApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to mutate sender queue", error);
    return NextResponse.json(
      {
        error:
          getSupabaseConnectionErrorMessage(error) ??
          "Failed to update your queue",
      },
      { status: 500 }
    );
  }
}
