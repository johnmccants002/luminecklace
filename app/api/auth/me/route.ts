import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";

export async function GET(req: Request) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email ?? "",
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Unhandled me error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
