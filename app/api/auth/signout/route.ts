import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

function getStatusCode(status: unknown, fallback: number) {
  return typeof status === "number" && status >= 100 && status <= 599
    ? status
    : fallback;
}

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: getStatusCode(error.status, 400) }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unhandled signout error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
