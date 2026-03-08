import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthBody = {
  email?: unknown;
  password?: unknown;
};

function getStatusCode(status: unknown, fallback: number) {
  return typeof status === "number" && status >= 100 && status <= 599
    ? status
    : fallback;
}

export async function POST(req: Request) {
  try {
    let body: AuthBody;

    try {
      body = (await req.json()) as AuthBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: getStatusCode(error.status, 400) }
      );
    }

    return NextResponse.json({
      success: true,
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email,
          }
        : null,
      needsEmailConfirmation: !data.session,
      session: data.session
        ? {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresIn: data.session.expires_in,
            tokenType: data.session.token_type,
          }
        : null,
    });
  } catch (error) {
    console.error("Unhandled signup error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
