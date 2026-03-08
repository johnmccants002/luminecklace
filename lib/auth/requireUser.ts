import "server-only";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UNAUTHORIZED_RESPONSE = NextResponse.json(
  { error: "Unauthorized" },
  { status: 401 }
);

export async function requireUser(req?: Request) {
  const authHeader = req?.headers.get("Authorization");
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1];

  if (token) {
    const { data } = await supabaseAdmin.auth.getUser(token);

    if (data.user) {
      return { user: data.user };
    }

    throw UNAUTHORIZED_RESPONSE;
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    throw UNAUTHORIZED_RESPONSE;
  }

  return { user: data.user };
}
