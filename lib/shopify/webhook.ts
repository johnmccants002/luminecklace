import { createHmac, timingSafeEqual } from "node:crypto";

import JSONBigInt from "json-bigint";

const jsonBigInt = JSONBigInt({ storeAsString: true, strict: true });
const MONEY_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
const ID_PATTERN = /^\d+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UnknownRecord = Record<string, unknown>;

export type ShopifyWebhookConfig = {
  webhookSecret: string;
  storeDomain: string;
  lumiSkus: ReadonlySet<string>;
};

export type ShopifyOrderForIngestion = {
  shopify_order_id: string;
  shopify_order_number: string | null;
  purchaser_email_normalized: string | null;
  ingestion_outcome: "ready" | "ignored" | "manual_review";
  shopify_created_at: string | null;
  shopify_updated_at: string | null;
  processed_at: string | null;
  cancelled_at: string | null;
  currency: string | null;
  presentment_currency: string | null;
  financial_status: string | null;
  subtotal_price: string | null;
  current_subtotal_price: string | null;
  total_discounts: string | null;
  current_total_discounts: string | null;
  total_shipping: string | null;
  current_total_shipping: string | null;
  total_tax: string | null;
  current_total_tax: string | null;
  total_price: string | null;
  current_total_price: string | null;
  total_outstanding: string | null;
};

export type ShopifyLineItemForIngestion = {
  shopify_line_item_id: string;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  current_quantity: number;
  unit_price: string | null;
  total_discount: string | null;
  is_lumi_eligible: boolean;
};

export type ParsedShopifyPaidOrder = {
  order: ShopifyOrderForIngestion;
  lineItems: ShopifyLineItemForIngestion[];
};

export class ShopifyProtocolError extends Error {}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredId(value: unknown, field: string): string {
  if (typeof value === "string" && ID_PATTERN.test(value)) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }

  throw new ShopifyProtocolError(`${field} must be an integer identifier`);
}

function optionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requiredId(value, field);
}

function requiredQuantity(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ShopifyProtocolError(`${field} must be a non-negative integer`);
  }

  return parsed;
}

function optionalMoney(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new ShopifyProtocolError(`${field} must be a decimal string`);
  }

  const money = value;
  if (!MONEY_PATTERN.test(money)) {
    throw new ShopifyProtocolError(`${field} must be a non-negative decimal amount`);
  }

  return money;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  const timestamp = optionalString(value);
  if (timestamp === null) {
    return null;
  }

  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new ShopifyProtocolError(`${field} must be an ISO-8601 timestamp`);
  }

  return timestamp;
}

function nestedMoney(
  source: UnknownRecord,
  field: string,
  fallback: unknown = null
): string | null {
  const value = source[field];
  if (!isRecord(value)) {
    return optionalMoney(fallback, field);
  }

  const shopMoney = value.shop_money;
  return optionalMoney(isRecord(shopMoney) ? shopMoney.amount : fallback, field);
}

export function normalizeEmail(value: unknown): string | null {
  const email = optionalString(value)?.toLowerCase() ?? null;
  return email && EMAIL_PATTERN.test(email) ? email : null;
}

export function isValidEmail(value: unknown): value is string {
  return normalizeEmail(value) !== null;
}

export function parseShopifyLumiSkus(value: string | undefined): ReadonlySet<string> {
  const skus = (value ?? "")
    .split(",")
    .map((sku) => sku.trim())
    .filter(Boolean);

  if (skus.length === 0) {
    throw new Error(
      "Missing SHOPIFY_LUMI_SKUS. Set a comma-separated list of eligible Shopify SKUs."
    );
  }

  return new Set(skus);
}

export function getShopifyWebhookConfig(): ShopifyWebhookConfig {
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim().toLowerCase();

  if (!webhookSecret) {
    throw new Error("Missing SHOPIFY_WEBHOOK_SECRET");
  }

  if (!storeDomain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(storeDomain)) {
    throw new Error(
      "Missing or invalid SHOPIFY_STORE_DOMAIN; expected <store>.myshopify.com"
    );
  }

  return {
    webhookSecret,
    storeDomain,
    lumiSkus: parseShopifyLumiSkus(process.env.SHOPIFY_LUMI_SKUS),
  };
}

export function verifyShopifyHmac(
  rawBody: string,
  providedHmac: string | null,
  secret: string
): boolean {
  if (!providedHmac || !/^[A-Za-z0-9+/]+={0,2}$/.test(providedHmac)) {
    return false;
  }

  let provided: Buffer;
  try {
    provided = Buffer.from(providedHmac, "base64");
  } catch {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function parseShopifyPaidOrder(
  rawBody: string,
  lumiSkus: ReadonlySet<string>
): ParsedShopifyPaidOrder {
  let payload: unknown;
  try {
    payload = jsonBigInt.parse(rawBody);
  } catch {
    throw new ShopifyProtocolError("Invalid JSON body");
  }

  if (!isRecord(payload)) {
    throw new ShopifyProtocolError("Webhook body must be a JSON object");
  }

  if (!Array.isArray(payload.line_items)) {
    throw new ShopifyProtocolError("line_items must be an array");
  }

  const contactEmail =
    normalizeEmail(payload.contact_email) ??
    normalizeEmail(payload.email) ??
    (isRecord(payload.customer) ? normalizeEmail(payload.customer.email) : null);

  const lineItems = payload.line_items.map((value, index) => {
    if (!isRecord(value)) {
      throw new ShopifyProtocolError(`line_items[${index}] must be an object`);
    }

    const quantity = requiredQuantity(value.quantity, `line_items[${index}].quantity`);
    const currentQuantity =
      value.current_quantity === null || value.current_quantity === undefined
        ? quantity
        : requiredQuantity(
            value.current_quantity,
            `line_items[${index}].current_quantity`
          );
    const sku = optionalString(value.sku);

    return {
      shopify_line_item_id: requiredId(
        value.id,
        `line_items[${index}].id`
      ),
      shopify_product_id: optionalId(
        value.product_id,
        `line_items[${index}].product_id`
      ),
      shopify_variant_id: optionalId(
        value.variant_id,
        `line_items[${index}].variant_id`
      ),
      sku,
      title: optionalString(value.title) ?? optionalString(value.name),
      quantity,
      current_quantity: currentQuantity,
      unit_price: optionalMoney(value.price, `line_items[${index}].price`),
      total_discount: optionalMoney(
        value.total_discount,
        `line_items[${index}].total_discount`
      ),
      is_lumi_eligible: sku !== null && lumiSkus.has(sku),
    } satisfies ShopifyLineItemForIngestion;
  });

  const hasEligibleSku = lineItems.some((line) => line.is_lumi_eligible);
  const ingestionOutcome = !contactEmail
    ? "manual_review"
    : hasEligibleSku
      ? "ready"
      : "ignored";

  return {
    order: {
      shopify_order_id: requiredId(payload.id, "id"),
      shopify_order_number: optionalId(payload.order_number, "order_number"),
      purchaser_email_normalized: contactEmail,
      ingestion_outcome: ingestionOutcome,
      shopify_created_at: optionalTimestamp(payload.created_at, "created_at"),
      shopify_updated_at: optionalTimestamp(payload.updated_at, "updated_at"),
      processed_at: optionalTimestamp(payload.processed_at, "processed_at"),
      cancelled_at: optionalTimestamp(payload.cancelled_at, "cancelled_at"),
      currency: optionalString(payload.currency),
      presentment_currency: optionalString(payload.presentment_currency),
      financial_status: optionalString(payload.financial_status),
      subtotal_price: optionalMoney(payload.subtotal_price, "subtotal_price"),
      current_subtotal_price: optionalMoney(
        payload.current_subtotal_price,
        "current_subtotal_price"
      ),
      total_discounts: optionalMoney(payload.total_discounts, "total_discounts"),
      current_total_discounts: optionalMoney(
        payload.current_total_discounts,
        "current_total_discounts"
      ),
      total_shipping: nestedMoney(
        payload,
        "total_shipping_price_set",
        payload.total_shipping_price
      ),
      current_total_shipping: nestedMoney(
        payload,
        "current_shipping_price_set",
        payload.current_total_shipping_price
      ),
      total_tax: optionalMoney(payload.total_tax, "total_tax"),
      current_total_tax: optionalMoney(
        payload.current_total_tax,
        "current_total_tax"
      ),
      total_price: optionalMoney(payload.total_price, "total_price"),
      current_total_price: optionalMoney(
        payload.current_total_price,
        "current_total_price"
      ),
      total_outstanding: optionalMoney(
        payload.total_outstanding,
        "total_outstanding"
      ),
    },
    lineItems,
  };
}
