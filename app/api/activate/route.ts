import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createClaimToken, hashClaimToken } from "@/lib/activation/claimToken";
import { getSupabaseConnectionErrorMessage } from "@/lib/supabase/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ActivateBody = {
  activationCode?: unknown;
};

type ReserveResultRow = {
  result?: string | null;
  tag_id?: string | null;
  sku?: string | null;
  necklace_name?: string | null;
  base_package_ids?: unknown;
  reserved_until?: string | null;
};

const ACTIVATION_SESSION_COOKIE = "lumi_activation_session";
const ACTIVATION_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function normalizePackageIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function parseCookieValue(req: Request, cookieName: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) {
    return null;
  }

  const cookieParts = header.split(";");
  for (const part of cookieParts) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== cookieName) {
      continue;
    }

    const value = rawValue.join("=").trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }

  return null;
}

function buildActivationCodeHash(activationCode: string): string {
  return createHash("sha256").update(activationCode).digest("hex");
}

function reservationErrorStatus(result: string | null | undefined): number {
  if (result === "not_found") {
    return 404;
  }

  if (result === "reservation_expired") {
    return 410;
  }

  if (result === "already_claimed") {
    return 409;
  }

  return 500;
}

function reservationErrorMessage(result: string | null | undefined): string {
  if (result === "not_found") {
    return "Activation code not found";
  }

  if (result === "reservation_expired") {
    return "Reservation expired";
  }

  if (result === "already_claimed") {
    return "Activation code has already been claimed";
  }

  if (result === "sku_not_found") {
    return "Necklace sku not found for activated tag";
  }

  return "Failed to reserve activation code";
}

export async function POST(req: Request) {
  try {
    let body: ActivateBody;

    try {
      body = (await req.json()) as ActivateBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rawActivationCode =
      typeof body === "object" && body !== null ? body.activationCode : undefined;

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

    const claimToken = createClaimToken();
    const claimTokenHash = hashClaimToken(claimToken.token);
    const activationCodeHash = buildActivationCodeHash(activationCode);

    const existingSessionId = parseCookieValue(req, ACTIVATION_SESSION_COOKIE);
    const reservationSessionId = existingSessionId ?? randomUUID();

    const { data: reserveRows, error: reserveError } = await supabaseAdmin.rpc(
      "reserve_activation_code",
      {
        p_activation_code_hash: activationCodeHash,
        p_claim_token_hash: claimTokenHash,
        p_reserved_until: claimToken.expiresAt,
        p_reserved_by_session: reservationSessionId,
      }
    );

    if (reserveError) {
      console.error("Failed to reserve activation code", reserveError);
      const errorMessage = getSupabaseConnectionErrorMessage(reserveError);
      return NextResponse.json(
        { error: errorMessage ?? "Failed to reserve activation code" },
        { status: 500 }
      );
    }

    const reserveResult = Array.isArray(reserveRows)
      ? (reserveRows[0] as ReserveResultRow | undefined)
      : undefined;

    if (!reserveResult || reserveResult.result !== "reserved") {
      return NextResponse.json(
        { error: reservationErrorMessage(reserveResult?.result) },
        { status: reservationErrorStatus(reserveResult?.result) }
      );
    }

    if (!reserveResult.tag_id || !reserveResult.sku) {
      return NextResponse.json(
        { error: "Reserved activation is missing tag metadata" },
        { status: 500 }
      );
    }

    const basePackageIDs = normalizePackageIds(reserveResult.base_package_ids);

    const response = NextResponse.json({
      success: true,
      activation: {
        tagId: reserveResult.tag_id,
        sku: reserveResult.sku,
        necklaceName: reserveResult.necklace_name ?? reserveResult.sku,
        basePackageIDs,
      },
      claim: {
        status: "reserved",
        reservedUntil: reserveResult.reserved_until ?? claimToken.expiresAt,
        claimToken: claimToken.token,
      },
    });

    if (!existingSessionId) {
      response.cookies.set({
        name: ACTIVATION_SESSION_COOKIE,
        value: reservationSessionId,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ACTIVATION_SESSION_COOKIE_MAX_AGE_SECONDS,
      });
    }

    return response;
  } catch (error) {
    console.error("Unhandled activation error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
