import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import { reorderSenderLumis, SenderApiError } from "@/lib/sender/necklaces";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";

type ReorderBody = {
  lumiIds?: unknown;
};

type RouteContext = {
  params: Promise<{ necklaceId: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PUT(req: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const { necklaceId } = await context.params;

    if (!UUID_PATTERN.test(necklaceId)) {
      return NextResponse.json({ error: "necklaceId must be a UUID" }, { status: 400 });
    }

    let body: ReorderBody;
    try {
      body = (await req.json()) as ReorderBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!Array.isArray(body.lumiIds) || !body.lumiIds.every((id) => UUID_PATTERN.test(id))) {
      return NextResponse.json(
        { error: "lumiIds must be an array of UUIDs" },
        { status: 400 }
      );
    }

    const lumiIds = body.lumiIds as string[];
    if (new Set(lumiIds).size !== lumiIds.length) {
      return NextResponse.json({ error: "lumiIds must be unique" }, { status: 400 });
    }

    const queue = await reorderSenderLumis(
      supabaseAdmin,
      user.id,
      necklaceId,
      lumiIds
    );
    return NextResponse.json({ queue });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof SenderApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Failed to reorder sender Lumis", error);
    const connectionMessage = getSupabaseConnectionErrorMessage(error);
    return NextResponse.json(
      { error: connectionMessage ?? "Failed to reorder your Lumis" },
      { status: 500 }
    );
  }
}
