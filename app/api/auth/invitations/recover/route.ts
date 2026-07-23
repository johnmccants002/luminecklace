import { NextResponse } from "next/server";

import { requestShopifyInvitationRecovery } from "@/lib/shopify/orders";
import { isValidEmail } from "@/lib/shopify/webhook";

type RecoveryBody = {
  email?: unknown;
};

const ACCEPTED_RESPONSE = {
  success: true,
  message: "If the account is eligible, a new setup link will be sent.",
};

export async function POST(req: Request) {
  let body: RecoveryBody;
  try {
    body = (await req.json()) as RecoveryBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidEmail(body.email)) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 }
    );
  }

  try {
    await requestShopifyInvitationRecovery(body.email);
  } catch (error) {
    // Keep the public response non-enumerating even when the provider is unavailable.
    console.error("Invitation recovery request failed", error);
  }

  return NextResponse.json(ACCEPTED_RESPONSE, { status: 202 });
}
