import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { dispatchPushDeliveries } from "@/lib/push/dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function isAuthorizedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const authorization = req.headers.get("Authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

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
