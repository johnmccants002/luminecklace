import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";
import {
  isLumiReactionKey,
  setLumiReaction,
} from "@/lib/tap/feedback";

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
      (key) => key !== "revealSessionId" && key !== "reaction"
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
    if (!isLumiReactionKey(body.reaction)) {
      return NextResponse.json(
        { error: "reaction is not supported" },
        { status: 400 }
      );
    }

    try {
      const result = await setLumiReaction(
        supabaseAdmin,
        body.revealSessionId,
        body.reaction
      );
      if (result.status === "reacted") {
        return NextResponse.json(result);
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
      if (result.status === "invalid_reaction") {
        return NextResponse.json(
          { error: "reaction is not supported" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Failed to set Lumi reaction" },
        { status: 500 }
      );
    } catch (error) {
      console.error("Failed to set recipient reaction", error);
      const errorMessage = getSupabaseConnectionErrorMessage(error);
      return NextResponse.json(
        { error: errorMessage ?? "Failed to set Lumi reaction" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Unhandled recipient reaction error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
