import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import {
  normalizeLibrarySearch,
  parseLibraryCategory,
  parseLibraryLimit,
} from "@/lib/sender/message-library-contract";
import { listSenderMessageLibrary } from "@/lib/sender/message-library";
import { SenderApiError } from "@/lib/sender/necklaces";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });
    const url = new URL(req.url);
    const necklaceId = url.searchParams.get("necklaceId")?.trim() || undefined;
    if (necklaceId && !UUID_PATTERN.test(necklaceId)) {
      throw new SenderApiError("necklaceId must be a UUID", 400);
    }

    const library = await listSenderMessageLibrary(supabaseAdmin, user.id, {
      category: parseLibraryCategory(url.searchParams.get("category")),
      search: normalizeLibrarySearch(url.searchParams.get("search")),
      limit: parseLibraryLimit(url.searchParams.get("limit")),
      cursor: url.searchParams.get("cursor") || undefined,
      necklaceId,
    });
    return NextResponse.json(library);
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof SenderApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to load sender message library");
    return NextResponse.json(
      {
        error:
          getSupabaseConnectionErrorMessage(error) ??
          "Failed to load message library",
      },
      { status: 500 }
    );
  }
}
