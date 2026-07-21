import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import { listSenderNecklaces } from "@/lib/sender/necklaces";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";

export async function GET(req: Request) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const necklaces = await listSenderNecklaces(supabaseAdmin, user.id);
    return NextResponse.json({ necklaces });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Failed to list sender necklaces", error);
    const connectionMessage = getSupabaseConnectionErrorMessage(error);
    return NextResponse.json(
      { error: connectionMessage ?? "Failed to load your Lumis" },
      { status: 500 }
    );
  }
}
