import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { submitLumiResponse } from "@/lib/tap/feedback";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const unsupportedKey = Object.keys(body).find(
      (key) => key !== "revealSessionId" && key !== "text"
    );
    if (unsupportedKey) {
      return NextResponse.json(
        { error: `${unsupportedKey} is not supported` },
        { status: 400 }
      );
    }

    if (typeof body.revealSessionId !== "string" || !body.revealSessionId) {
      return NextResponse.json(
        { error: "revealSessionId is required" },
        { status: 400 }
      );
    }
    if (!UUID_PATTERN.test(body.revealSessionId)) {
      return NextResponse.json(
        { error: "revealSessionId must be a UUID" },
        { status: 400 }
      );
    }
    if (typeof body.text !== "string") {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }

    const responseText = body.text.trim();
    if (!responseText) {
      return NextResponse.json(
        { error: "text must not be empty" },
        { status: 400 }
      );
    }
    if (Array.from(responseText).length > 250) {
      return NextResponse.json(
        { error: "text must be 250 characters or fewer" },
        { status: 400 }
      );
    }

    try {
      const result = await submitLumiResponse(
        supabaseAdmin,
        body.revealSessionId,
        responseText
      );
      if (result.status === "responded") {
        schedulePushDispatch();
        return NextResponse.json(result);
      }
      if (result.status === "already_responded") {
        return NextResponse.json(
          {
            status: result.status,
            error: "A written response has already been submitted",
          },
          { status: 409 }
        );
      }
      if (result.status === "unavailable") {
        return NextResponse.json(result, { status: 404 });
      }
      if (result.status === "not_revealed") {
        return NextResponse.json(result, { status: 409 });
      }
      if (result.status === "expired") {
        return NextResponse.json(result, { status: 410 });
      }
      if (result.status === "invalid_response") {
        return NextResponse.json(
          { error: "text must contain 1 to 250 characters" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Failed to submit Lumi response" },
        { status: 500 }
      );
    } catch (error) {
      console.error("Failed to submit recipient response", error);
      const errorMessage = getSupabaseConnectionErrorMessage(error);
      return NextResponse.json(
        { error: errorMessage ?? "Failed to submit Lumi response" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Unhandled recipient response error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
