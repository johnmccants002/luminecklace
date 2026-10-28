import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/push/cron-auth";
import { dispatchPushDeliveries } from "@/lib/push/dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await dispatchPushDeliveries({ batchSize: 50 });
    return NextResponse.json(summary);
  } catch {
    console.error("Push retry dispatch failed");
    return NextResponse.json(
      { error: "Push dispatch failed" },
      { status: 500 }
    );
  }
}
