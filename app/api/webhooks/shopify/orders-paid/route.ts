import { NextResponse } from "next/server";

import { processShopifyPaidOrder } from "@/lib/shopify/orders";
import {
  getShopifyWebhookConfig,
  parseShopifyPaidOrder,
  ShopifyProtocolError,
  verifyShopifyHmac,
} from "@/lib/shopify/webhook";

export const runtime = "nodejs";

const WEBHOOK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let config: ReturnType<typeof getShopifyWebhookConfig>;
  try {
    config = getShopifyWebhookConfig();
  } catch (error) {
    console.error("Shopify webhook configuration error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (
    !verifyShopifyHmac(
      rawBody,
      req.headers.get("x-shopify-hmac-sha256"),
      config.webhookSecret
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topic = req.headers.get("x-shopify-topic")?.trim().toLowerCase();
  const shopDomain = req.headers
    .get("x-shopify-shop-domain")
    ?.trim()
    .toLowerCase();
  const webhookId = req.headers.get("x-shopify-webhook-id")?.trim() ?? "";

  if (
    topic !== "orders/paid" ||
    shopDomain !== config.storeDomain ||
    !WEBHOOK_ID_PATTERN.test(webhookId)
  ) {
    return NextResponse.json(
      { error: "Malformed Shopify webhook protocol" },
      { status: 400 }
    );
  }

  let parsed;
  try {
    parsed = parseShopifyPaidOrder(rawBody, config.lumiSkus);
  } catch (error) {
    if (error instanceof ShopifyProtocolError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Unexpected Shopify payload parsing error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    const result = await processShopifyPaidOrder(shopDomain, webhookId, parsed);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Retryable Shopify paid-order processing failure", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
