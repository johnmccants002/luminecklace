import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  parseShopifyLumiSkus,
  parseShopifyPaidOrder,
  ShopifyProtocolError,
  verifyShopifyHmac,
} from "../lib/shopify/webhook";

const SECRET = "test-shopify-secret";

function signed(body: string) {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
}

function paidOrder(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "820982911946154508",
    order_number: 1048,
    contact_email: "Buyer@Example.com",
    created_at: "2026-07-22T12:00:00Z",
    updated_at: "2026-07-22T12:01:00Z",
    processed_at: "2026-07-22T12:01:00Z",
    currency: "USD",
    presentment_currency: "USD",
    financial_status: "paid",
    subtotal_price: "120.00",
    current_subtotal_price: "120.00",
    total_discounts: "10.00",
    current_total_discounts: "10.00",
    total_tax: "8.25",
    current_total_tax: "8.25",
    total_price: "118.25",
    current_total_price: "118.25",
    total_outstanding: "0.00",
    total_shipping_price_set: {
      shop_money: { amount: "0.00", currency_code: "USD" },
    },
    current_shipping_price_set: {
      shop_money: { amount: "0.00", currency_code: "USD" },
    },
    line_items: [
      {
        id: "999999999999999991",
        product_id: "999999999999999992",
        variant_id: "999999999999999993",
        sku: "LUMI-GOLD",
        title: "Gold Lumi",
        quantity: 2,
        current_quantity: 2,
        price: "40.00",
        total_discount: "5.00",
      },
      {
        id: "999999999999999994",
        product_id: "999999999999999995",
        variant_id: "999999999999999996",
        sku: "GIFT-WRAP",
        title: "Gift wrap",
        quantity: 1,
        current_quantity: 1,
        price: "5.00",
        total_discount: "0.00",
      },
    ],
    ...overrides,
  }).replace(/"(\d{16,})"/g, "$1");
}

test("verifies the HMAC over exact raw bytes", () => {
  const body = paidOrder();
  const hmac = signed(body);

  assert.equal(verifyShopifyHmac(body, hmac, SECRET), true);
  assert.equal(verifyShopifyHmac(`${body}\n`, hmac, SECRET), false);
  assert.equal(verifyShopifyHmac(body, null, SECRET), false);
  assert.equal(verifyShopifyHmac(body, "not base64!", SECRET), false);
  assert.equal(verifyShopifyHmac(body, Buffer.alloc(5).toString("base64"), SECRET), false);
});

test("parses SKU configuration exactly and rejects empty configuration", () => {
  assert.deepEqual(
    [...parseShopifyLumiSkus(" LUMI-GOLD, LUMI-SILVER ,,")],
    ["LUMI-GOLD", "LUMI-SILVER"]
  );
  assert.throws(() => parseShopifyLumiSkus(" , "), /Missing SHOPIFY_LUMI_SKUS/);
});

test("preserves large Shopify IDs and marks only exact eligible SKUs", () => {
  const parsed = parseShopifyPaidOrder(
    paidOrder(),
    new Set(["LUMI-GOLD"])
  );

  assert.equal(parsed.order.shopify_order_id, "820982911946154508");
  assert.equal(parsed.order.shopify_order_number, "1048");
  assert.equal(parsed.order.purchaser_email_normalized, "buyer@example.com");
  assert.equal(parsed.order.ingestion_outcome, "ready");
  assert.equal(parsed.order.total_price, "118.25");
  assert.equal(parsed.order.total_shipping, "0.00");
  assert.deepEqual(
    parsed.lineItems.map((line) => ({
      id: line.shopify_line_item_id,
      quantity: line.quantity,
      eligible: line.is_lumi_eligible,
    })),
    [
      { id: "999999999999999991", quantity: 2, eligible: true },
      { id: "999999999999999994", quantity: 1, eligible: false },
    ]
  );
});

test("classifies a valid order without an email for manual review", () => {
  const parsed = parseShopifyPaidOrder(
    paidOrder({ contact_email: null, email: null, customer: null }),
    new Set(["LUMI-GOLD"])
  );

  assert.equal(parsed.order.purchaser_email_normalized, null);
  assert.equal(parsed.order.ingestion_outcome, "manual_review");
  assert.equal(parsed.lineItems[0].is_lumi_eligible, true);
  assert.equal(parsed.lineItems[0].quantity, 2);
});

test("classifies a valid order without eligible lines as ignored", () => {
  const parsed = parseShopifyPaidOrder(paidOrder(), new Set(["LUMI-SILVER"]));
  assert.equal(parsed.order.ingestion_outcome, "ignored");
  assert.equal(parsed.lineItems.every((line) => !line.is_lumi_eligible), true);
});

test("uses customer email as a final fallback and normalizes case", () => {
  const parsed = parseShopifyPaidOrder(
    paidOrder({
      contact_email: null,
      email: null,
      customer: { email: " Mixed.Case@Example.COM " },
    }),
    new Set(["LUMI-GOLD"])
  );

  assert.equal(parsed.order.purchaser_email_normalized, "mixed.case@example.com");
});

test("rejects malformed protocol fields", () => {
  assert.throws(
    () => parseShopifyPaidOrder("{", new Set(["LUMI-GOLD"])),
    ShopifyProtocolError
  );
  assert.throws(
    () =>
      parseShopifyPaidOrder(
        paidOrder({ id: null }),
        new Set(["LUMI-GOLD"])
      ),
    /id must be an integer identifier/
  );
  assert.throws(
    () =>
      parseShopifyPaidOrder(
        paidOrder({ line_items: [{ id: 1, sku: "LUMI-GOLD", quantity: -1 }] }),
        new Set(["LUMI-GOLD"])
      ),
    /quantity must be a non-negative integer/
  );
  assert.throws(
    () =>
      parseShopifyPaidOrder(
        paidOrder({ total_price: "1.234" }),
        new Set(["LUMI-GOLD"])
      ),
    /total_price must be a non-negative decimal amount/
  );
});
