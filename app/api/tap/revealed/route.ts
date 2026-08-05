import { NextResponse } from "next/server";

import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { confirmRecipientReveal } from "@/lib/tap/recipient";
import { schedulePushDispatch } from "@/lib/push/schedule";

export const runtime = "nodejs";

type RevealedBody = {
  revealSessionId?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(req: Request) {
  try {
    let body: RevealedBody;

    try {
      body = (await req.json()) as RevealedBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const revealSessionId = isNonEmptyString(body.revealSessionId)
      ? body.revealSessionId.trim()
      : "";

    if (!revealSessionId) {
      return NextResponse.json(
        { error: "revealSessionId is required" },
        { status: 400 }
      );
    }

    if (!UUID_PATTERN.test(revealSessionId)) {
      return NextResponse.json(
        { error: "revealSessionId must be a UUID" },
        { status: 400 }
      );
    }

    try {
      const result = await confirmRecipientReveal(supabaseAdmin, revealSessionId);

      if (result.status === "revealed") {
        schedulePushDispatch();
        return NextResponse.json(result);
      }

      if (result.status === "expired") {
        return NextResponse.json(result, { status: 410 });
      }

      if (result.status === "unavailable") {
        return NextResponse.json(result, { status: 404 });
      }

      return NextResponse.json({ error: "Failed to reveal necklace" }, { status: 500 });
    } catch (error) {
      console.error("Failed to confirm recipient reveal", error);
      const errorMessage = getSupabaseConnectionErrorMessage(error);
      return NextResponse.json(
        { error: errorMessage ?? "Failed to reveal necklace" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Unhandled recipient reveal error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
