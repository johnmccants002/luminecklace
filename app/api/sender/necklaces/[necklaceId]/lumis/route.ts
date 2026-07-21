import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import {
  enqueueSenderLumi,
  normalizeLumiText,
  SenderApiError,
} from "@/lib/sender/necklaces";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";

type CreateLumiBody = {
  text?: unknown;
};

type RouteContext = {
  params: Promise<{ necklaceId: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(req: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const { necklaceId } = await context.params;

    if (!UUID_PATTERN.test(necklaceId)) {
      return NextResponse.json({ error: "necklaceId must be a UUID" }, { status: 400 });
    }

    let body: CreateLumiBody;
    try {
      body = (await req.json()) as CreateLumiBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const text = normalizeLumiText(body.text);

    const lumi = await enqueueSenderLumi(supabaseAdmin, user.id, necklaceId, text);
    return NextResponse.json({ lumi }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof SenderApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Failed to add sender Lumi", error);
    const connectionMessage = getSupabaseConnectionErrorMessage(error);
    return NextResponse.json(
      { error: connectionMessage ?? "Failed to add your Lumi" },
      { status: 500 }
    );
  }
}
