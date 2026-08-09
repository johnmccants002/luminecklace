import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import {
  enqueueSharedLinkLumi,
  normalizeLumiPresentation,
  normalizeQueueSection,
  normalizeSharedLumiText,
  SenderApiError,
} from "@/lib/sender/necklaces";
import { normalizeSharedUrl } from "@/lib/shared-links/public-url";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";

type ShareLumiBody = {
  clientRequestId?: unknown;
  url?: unknown;
  text?: unknown;
  destination?: unknown;
  presentation?: unknown;
};

type RouteContext = {
  params: Promise<{ necklaceId: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const { necklaceId } = await context.params;
    if (!UUID_PATTERN.test(necklaceId)) {
      throw new SenderApiError("necklaceId must be a UUID", 400);
    }

    let body: ShareLumiBody;
    try {
      body = (await req.json()) as ShareLumiBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new SenderApiError("body must be an object", 400);
    }
    const supportedFields = new Set([
      "clientRequestId",
      "url",
      "text",
      "destination",
      "presentation",
    ]);
    if (Object.keys(body).some((key) => !supportedFields.has(key))) {
      throw new SenderApiError("body contains unsupported fields", 400);
    }
    if (
      typeof body.clientRequestId !== "string" ||
      !UUID_PATTERN.test(body.clientRequestId)
    ) {
      throw new SenderApiError("clientRequestId must be a UUID", 400);
    }

    let link;
    try {
      link = normalizeSharedUrl(body.url);
    } catch (error) {
      throw new SenderApiError(
        error instanceof Error ? error.message : "url is invalid",
        400
      );
    }
    const result = await enqueueSharedLinkLumi(
      supabaseAdmin,
      user.id,
      necklaceId,
      body.clientRequestId,
      link,
      normalizeSharedLumiText(body.text),
      normalizeQueueSection(body.destination ?? "up_next"),
      normalizeLumiPresentation(body.presentation)
    );

    return NextResponse.json(result, {
      status: result.idempotentReplay ? 200 : 201,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof SenderApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    // Do not log the request URL; shared URLs can contain private identifiers.
    console.error("Failed to add shared sender Lumi");
    const connectionMessage = getSupabaseConnectionErrorMessage(error);
    return NextResponse.json(
      { error: connectionMessage ?? "Failed to add your shared Lumi" },
      { status: 500 }
    );
  }
}
