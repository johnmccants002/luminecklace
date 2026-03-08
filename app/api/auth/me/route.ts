import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

function getStatusCode(status: unknown, fallback: number) {
  return typeof status === "number" && status >= 100 && status <= 599
    ? status
    : fallback;
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: getStatusCode(error.status, 401) }
      );
    }

    if (!data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (error) {
    console.error("Unhandled me error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
