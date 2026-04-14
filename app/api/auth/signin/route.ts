import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthBody = {
  email?: unknown;
  password?: unknown;
};

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
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (!data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hasValidSession =
      typeof data.session?.access_token === "string" &&
      typeof data.session?.refresh_token === "string" &&
      typeof data.session?.expires_in === "number" &&
      typeof data.session?.token_type === "string";

    if (!hasValidSession || !data.session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email ?? "",
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
