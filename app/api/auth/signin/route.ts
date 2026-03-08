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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: getStatusCode(error.status, 401) }
      );
    }

    if (!data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!data.session?.access_token) {
      return NextResponse.json(
        {
          error:
            "No access token returned from auth provider. Ensure the account can sign in (for example, email confirmation may be required).",
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
        tokenType: data.session.token_type,
      },
    });
  } catch (error) {
    console.error("Unhandled signin error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
