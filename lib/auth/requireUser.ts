import "server-only";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RequireUserOptions = {
  bearerOnly?: boolean;
};

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function getBearerToken(req?: Request): string | null {
  const authHeader = req?.headers.get("Authorization");
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim();

  return token && token.length > 0 ? token : null;
}

export async function requireUser(req?: Request, options: RequireUserOptions = {}) {
  const token = getBearerToken(req);

  if (options.bearerOnly) {
    if (!token) {
      throw unauthorizedResponse();
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!data.user || error) {
      throw unauthorizedResponse();
    }

    return { user: data.user };
  }

  if (token) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (data.user && !error) {
      return { user: data.user };
    }

    throw unauthorizedResponse();
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    throw unauthorizedResponse();
  }

  return { user: data.user };
}
