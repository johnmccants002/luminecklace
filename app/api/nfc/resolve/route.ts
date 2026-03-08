import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type ResolveBody = {
  tagId?: unknown;
};

type TagRow = {
  tag_id?: string | null;
  sku?: string | null;
  status?: string | null;
  owner_user_id?: string | null;
};

function isOptionalScanLogError(code: string | undefined) {
  return code === "42P01" || code === "42703";
}

export async function POST(req: Request) {
  try {
    let body: ResolveBody;

    try {
      body = (await req.json()) as ResolveBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const tagId = typeof body.tagId === "string" ? body.tagId.trim() : "";
    if (!tagId) {
      return NextResponse.json({ error: "tagId is required" }, { status: 400 });
    }

    const { data: tag, error: tagError } = await supabaseAdmin
      .from("tags")
      .select("tag_id, sku, status, owner_user_id")
      .eq("tag_id", tagId)
      .maybeSingle<TagRow>();

    if (tagError) {
      console.error("Failed to resolve NFC tag", tagError);
      return NextResponse.json(
        { error: "Failed to resolve necklace" },
        { status: 500 }
      );
    }

    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    const { error: scanError } = await supabaseAdmin.from("scans").insert({
      necklace_id: tag.tag_id,
      timestamp: new Date().toISOString(),
    });

    if (scanError && !isOptionalScanLogError(scanError.code)) {
      console.error("Failed to log NFC scan", scanError);
    }

    return NextResponse.json({
      success: true,
      tag: {
        tagId: tag.tag_id,
        sku: tag.sku,
        status: tag.status,
        isClaimed: tag.status === "claimed",
      },
    });
  } catch (error) {
    console.error("Unhandled NFC resolve error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
