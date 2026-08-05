import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import {
  parsePushPreferences,
  PushValidationError,
} from "@/lib/push/validation";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type PreferenceRow = {
  reveals_enabled?: unknown;
  reactions_enabled?: unknown;
  responses_enabled?: unknown;
};

function publicPreferences(row?: PreferenceRow | null) {
  return {
    revealsEnabled:
      typeof row?.reveals_enabled === "boolean" ? row.reveals_enabled : true,
    reactionsEnabled:
      typeof row?.reactions_enabled === "boolean" ? row.reactions_enabled : true,
    responsesEnabled:
      typeof row?.responses_enabled === "boolean" ? row.responses_enabled : true,
  };
}

export async function GET(req: Request) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const { data, error } = await supabaseAdmin
      .from("push_preferences")
      .select("reveals_enabled, reactions_enabled, responses_enabled")
      .eq("user_id", user.id)
      .maybeSingle<PreferenceRow>();
    if (error) throw new Error("Push preference read failed");
    return NextResponse.json(publicPreferences(data));
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Failed to load push preferences");
    return NextResponse.json(
      { error: "Failed to load push preferences" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new PushValidationError("Invalid JSON body");
    }
    const input = parsePushPreferences(body);
    const { data, error } = await supabaseAdmin.rpc("set_push_preferences", {
      p_user_id: user.id,
      p_reveals_enabled: input.revealsEnabled ?? null,
      p_reactions_enabled: input.reactionsEnabled ?? null,
      p_responses_enabled: input.responsesEnabled ?? null,
    });
    if (error) throw new Error("Push preference update failed");
    return NextResponse.json(publicPreferences(data as PreferenceRow));
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof PushValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to update push preferences");
    return NextResponse.json(
      { error: "Failed to update push preferences" },
      { status: 500 }
    );
  }
}
