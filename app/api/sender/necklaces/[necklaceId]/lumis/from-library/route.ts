import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import { enqueueSenderLibraryMessage } from "@/lib/sender/message-library";
import {
  normalizeQueueSection,
  SenderApiError,
} from "@/lib/sender/necklaces";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";

type RouteContext = {
  params: Promise<{ necklaceId: string }>;
};

type FromLibraryBody = {
  messageId?: unknown;
  destination?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const { necklaceId } = await context.params;
    if (!UUID_PATTERN.test(necklaceId)) {
      throw new SenderApiError("necklaceId must be a UUID", 400);
    }

    let body: FromLibraryBody;
    try {
      body = (await req.json()) as FromLibraryBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) => !["messageId", "destination"].includes(key)
      )
    ) {
      throw new SenderApiError("body contains unsupported fields", 400);
    }
    if (typeof body.messageId !== "string" || !UUID_PATTERN.test(body.messageId)) {
      throw new SenderApiError("messageId must be a UUID", 400);
    }
    const destination = normalizeQueueSection(body.destination);

    const result = await enqueueSenderLibraryMessage(
      supabaseAdmin,
      user.id,
      necklaceId,
      body.messageId,
      destination
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof SenderApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to enqueue sender library message");
    return NextResponse.json(
      {
        error:
          getSupabaseConnectionErrorMessage(error) ??
          "Failed to add library message",
      },
      { status: 500 }
    );
  }
}
