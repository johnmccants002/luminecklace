import { NextResponse } from "next/server";

import { hashClaimToken, verifyClaimToken } from "@/lib/activation/claimToken";
import { requireUser } from "@/lib/auth/requireUser";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ClaimBody = {
  claimToken?: unknown;
};

type ClaimResultRow = {
  result?: string | null;
  tag_id?: string | null;
  sku?: string | null;
  owner_user_id?: string | null;
};

type NecklaceSkuRow = {
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

function claimErrorStatus(result: string | null | undefined): number {
  if (result === "invalid_token") {
    return 400;
  }

  if (result === "token_expired") {
    return 410;
  }

  if (result === "already_claimed") {
    return 409;
  }

  return 500;
}

function claimErrorMessage(result: string | null | undefined): string {
  if (result === "invalid_token") {
    return "Invalid claim token";
  }

  if (result === "token_expired") {
    return "Claim token expired";
  }

  if (result === "already_claimed") {
    return "Activation has already been claimed";
  }

  return "Failed to claim activation";
}

async function applyActivationPackages(userId: string, tagId: string, sku: string) {
  const { data: necklaceSku, error: necklaceSkuError } = await supabaseAdmin
    .from("necklace_skus")
    .select("base_package_ids")
    .eq("sku", sku)
    .maybeSingle<NecklaceSkuRow>();

  if (necklaceSkuError) {
    throw new Error(`Failed to fetch necklace packages: ${necklaceSkuError.message}`);
  }

  if (!necklaceSku) {
    throw new Error("Necklace sku not found for claimed activation");
  }

  const basePackageIDs = normalizePackageIds(necklaceSku.base_package_ids);

  const { data: existingSettings, error: settingsLookupError } = await supabaseAdmin
    .from("user_settings")
    .select("enabled_package_ids, equipped_tag_id")
    .eq("user_id", userId)
    .maybeSingle<UserSettingsRow>();

  if (settingsLookupError) {
    throw new Error(`Failed to fetch user settings: ${settingsLookupError.message}`);
  }

  const existingEnabledPackageIds = normalizePackageIds(
    existingSettings?.enabled_package_ids
  );

  const mergedEnabledPackageIds =
    existingEnabledPackageIds.length === 0
      ? basePackageIDs
      : Array.from(new Set([...existingEnabledPackageIds, ...basePackageIDs]));

  const { error: settingsUpsertError } = await supabaseAdmin
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        enabled_package_ids: mergedEnabledPackageIds,
        equipped_tag_id: existingSettings?.equipped_tag_id ?? tagId,
      },
      { onConflict: "user_id" }
    );

  if (settingsUpsertError) {
    throw new Error(`Failed to save user settings: ${settingsUpsertError.message}`);
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireUser(req, { bearerOnly: true });

    let body: ClaimBody;
    try {
      body = (await req.json()) as ClaimBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rawClaimToken = body.claimToken;
    if (typeof rawClaimToken !== "string" || rawClaimToken.trim().length === 0) {
      return NextResponse.json({ error: "Invalid claim token" }, { status: 400 });
    }

    const claimToken = rawClaimToken.trim();
    const verification = verifyClaimToken(claimToken);

    if (!verification.valid) {
      return NextResponse.json({ error: "Invalid claim token" }, { status: 400 });
    }

    if (verification.expired) {
      return NextResponse.json({ error: "Claim token expired" }, { status: 410 });
    }

    const claimTokenHash = hashClaimToken(claimToken);

    const { data: claimRows, error: claimError } = await supabaseAdmin.rpc(
      "claim_reserved_activation",
      {
        p_claim_token_hash: claimTokenHash,
        p_user_id: user.id,
      }
    );

    if (claimError) {
      console.error("Failed to claim reserved activation", claimError);
      const errorMessage = getSupabaseConnectionErrorMessage(claimError);
      return NextResponse.json(
        { error: errorMessage ?? "Failed to claim activation" },
        { status: 500 }
      );
    }

    const claimResult = Array.isArray(claimRows)
      ? (claimRows[0] as ClaimResultRow | undefined)
      : undefined;

    if (!claimResult) {
      return NextResponse.json(
        { error: "Failed to claim activation" },
        { status: 500 }
      );
    }

    if (claimResult.result !== "claimed" && claimResult.result !== "already_claimed_by_user") {
      return NextResponse.json(
        { error: claimErrorMessage(claimResult.result) },
        { status: claimErrorStatus(claimResult.result) }
      );
    }

    if (!claimResult.tag_id || !claimResult.sku) {
      return NextResponse.json(
        { error: "Claimed activation is missing tag metadata" },
        { status: 500 }
      );
    }

    try {
      await applyActivationPackages(user.id, claimResult.tag_id, claimResult.sku);
    } catch (settingsError) {
      console.error("Failed to apply activation packages", settingsError);
      return NextResponse.json(
        { error: "Failed to apply activation settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tagId: claimResult.tag_id,
      ownerUserId: user.id,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Unhandled activation claim error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
