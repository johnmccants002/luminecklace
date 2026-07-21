import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveNextRecipientTap } from "@/lib/tap/recipient";

type ResolveBody = {
  token?: unknown;
};

const MAX_TOKEN_LENGTH = 1024;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(req: Request) {
  try {
    let body: ResolveBody;

    try {
      body = (await req.json()) as ResolveBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const token = isNonEmptyString(body.token) ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    if (token.length > MAX_TOKEN_LENGTH) {
      return NextResponse.json({ error: "token is too long" }, { status: 400 });
    }

    const tokenHash = hashToken(token);

    try {
      const result = await resolveNextRecipientTap(supabaseAdmin, tokenHash);
      return NextResponse.json(result);
    } catch (error) {
      console.error("Failed to resolve recipient tap", error);
      const errorMessage = getSupabaseConnectionErrorMessage(error);
      return NextResponse.json(
        { error: errorMessage ?? "Failed to resolve necklace" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Unhandled recipient resolve error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
