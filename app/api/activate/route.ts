import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/requireUser";
import { supabaseAdmin } from "@/lib/supabase/admin";

type TagRow = {
  tag_id?: string | null;
  sku?: string | null;
};

type NecklaceSkuRow = {
  sku?: string | null;
  name?: string | null;
  base_package_ids?: unknown;
};

type UserSettingsRow = {
  enabled_package_ids?: unknown;
  equipped_tag_id?: string | null;
};

function normalizePackageIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export async function POST(req: Request) {
  try {
    const { user } = await requireUser(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rawActivationCode =
      typeof body === "object" && body !== null && "activationCode" in body
        ? (body as { activationCode?: unknown }).activationCode
        : undefined;

    if (typeof rawActivationCode !== "string") {
      return NextResponse.json(
        { error: "activationCode must be a string" },
        { status: 400 }
      );
    }

    const activationCode = rawActivationCode.trim().toUpperCase();
    if (!activationCode.startsWith("LUMI-")) {
      return NextResponse.json(
        { error: "activationCode must start with LUMI-" },
        { status: 400 }
      );
    }

    const activationCodeHash = createHash("sha256")
      .update(activationCode)
      .digest("hex");

    const { data: tag, error: tagLookupError } = await supabaseAdmin
      .from("tags")
      .select("tag_id, sku")
      .eq("activation_code_hash", activationCodeHash)
      .eq("status", "unclaimed")
      .maybeSingle<TagRow>();

    if (tagLookupError) {
      console.error("Failed to query tag for activation", tagLookupError);
      return NextResponse.json(
        { error: "Failed to query activation code" },
        { status: 500 }
      );
    }

    if (!tag) {
      return NextResponse.json(
        { error: "Activation code not found" },
        { status: 404 }
      );
    }

    if (!tag.sku) {
      return NextResponse.json(
        { error: "Tag is missing required sku" },
        { status: 500 }
      );
    }

    let claimUpdate = supabaseAdmin
      .from("tags")
      .update({
        status: "claimed",
        owner_user_id: user.id,
        claimed_at: new Date().toISOString(),
      })
      .eq("status", "unclaimed");

    if (tag.tag_id) {
      claimUpdate = claimUpdate.eq("tag_id", tag.tag_id);
    } else {
      claimUpdate = claimUpdate.eq("activation_code_hash", activationCodeHash);
    }

    const { data: claimedTag, error: claimError } = await claimUpdate
      .select("tag_id, sku")
      .maybeSingle<TagRow>();

    if (claimError) {
      console.error("Failed to claim tag", claimError);
      return NextResponse.json({ error: "Failed to claim tag" }, { status: 500 });
    }

    if (!claimedTag) {
      return NextResponse.json(
        { error: "Tag is no longer available for claiming" },
        { status: 409 }
      );
    }

    const { data: necklaceSku, error: necklaceSkuError } = await supabaseAdmin
      .from("necklace_skus")
      .select("sku, name, base_package_ids")
      .eq("sku", tag.sku)
      .maybeSingle<NecklaceSkuRow>();

    if (necklaceSkuError) {
      console.error("Failed to fetch necklace sku", necklaceSkuError);
      return NextResponse.json(
        { error: "Failed to fetch necklace sku" },
        { status: 500 }
      );
    }

    if (!necklaceSku) {
      return NextResponse.json(
        { error: "Necklace sku not found for activated tag" },
        { status: 404 }
      );
    }

    const basePackageIDs = normalizePackageIds(necklaceSku.base_package_ids);

    const { data: existingSettings, error: settingsLookupError } =
      await supabaseAdmin
        .from("user_settings")
        .select("enabled_package_ids, equipped_tag_id")
        .eq("user_id", user.id)
        .maybeSingle<UserSettingsRow>();

    if (settingsLookupError) {
      console.error("Failed to fetch user settings", settingsLookupError);
      return NextResponse.json(
        { error: "Failed to load user settings" },
        { status: 500 }
      );
    }

    const existingEnabledPackageIds = normalizePackageIds(
      existingSettings?.enabled_package_ids
    );
    const mergedEnabledPackageIds =
      existingEnabledPackageIds.length === 0
        ? basePackageIDs
        : Array.from(new Set([...existingEnabledPackageIds, ...basePackageIDs]));

    const resolvedTagId = claimedTag.tag_id ?? "";
    if (!resolvedTagId) {
      return NextResponse.json(
        { error: "Claimed tag missing identifier" },
        { status: 500 }
      );
    }

    const { error: settingsUpsertError } = await supabaseAdmin
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          enabled_package_ids: mergedEnabledPackageIds,
          equipped_tag_id: existingSettings?.equipped_tag_id ?? resolvedTagId,
        },
        { onConflict: "user_id" }
      );

    if (settingsUpsertError) {
      console.error("Failed to upsert user settings", settingsUpsertError);
      return NextResponse.json(
        { error: "Failed to save user settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tagId: resolvedTagId,
      sku: claimedTag.sku ?? tag.sku,
      necklaceName: necklaceSku.name ?? tag.sku,
      basePackageIDs,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Unhandled activation error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
