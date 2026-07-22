import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import {
  editSenderLumi,
  normalizeLumiText,
  removeSenderLumi,
  SenderApiError,
} from "@/lib/sender/necklaces";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";

type EditBody = {
  text?: unknown;
};

type RouteContext = {
  params: Promise<{ necklaceId: string; lumiId: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateIds(necklaceId: string, lumiId: string) {
  if (!UUID_PATTERN.test(necklaceId)) {
    return NextResponse.json({ error: "necklaceId must be a UUID" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(lumiId)) {
    return NextResponse.json({ error: "lumiId must be a UUID" }, { status: 400 });
  }
  return null;
}

function handleError(error: unknown, operation: "edit" | "remove") {
  if (error instanceof Response) {
    return error;
  }
  if (error instanceof SenderApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(`Failed to ${operation} sender Lumi`, error);
  const connectionMessage = getSupabaseConnectionErrorMessage(error);
  return NextResponse.json(
    { error: connectionMessage ?? `Failed to ${operation} your Lumi` },
    { status: 500 }
  );
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const { necklaceId, lumiId } = await context.params;
    const validationResponse = validateIds(necklaceId, lumiId);
    if (validationResponse) {
      return validationResponse;
    }

    let body: EditBody;
    try {
      body = (await req.json()) as EditBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const text = normalizeLumiText(body.text);
    const lumi = await editSenderLumi(
      supabaseAdmin,
      user.id,
      necklaceId,
      lumiId,
      text
    );
    return NextResponse.json({ lumi });
  } catch (error) {
    return handleError(error, "edit");
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const { necklaceId, lumiId } = await context.params;
    const validationResponse = validateIds(necklaceId, lumiId);
    if (validationResponse) {
      return validationResponse;
    }

    const result = await removeSenderLumi(
      supabaseAdmin,
      user.id,
      necklaceId,
      lumiId
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleError(error, "remove");
  }
}
