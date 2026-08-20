import assert from "node:assert/strict";
import test from "node:test";

import {
  createFactoryOrderDetailHandler,
  createFactoryOrderLookupHandler,
  createFactoryOrdersListHandler,
} from "../lib/factory/handlers";
import {
  serializeFactoryOrderDetail,
  serializeFactoryOrderList,
  serializeFactoryOrderSummary,
  type FactoryOrderRow,
} from "../lib/factory/serialize";
import type { FactoryOrderDetail } from "../lib/factory/types";
import {
  FactoryApiError,
  parseFactoryOrderListInput,
} from "../lib/factory/validation";

const ORDER_ID = "00000000-0000-4000-8000-000000000001";

function orderRow(overrides: Partial<FactoryOrderRow> = {}): FactoryOrderRow {
  return {
    id: ORDER_ID,
    order_source: "shopify",
    factory_reference: "1048",
    production_state: "queued",
    purchaser_name: null,
    shopify_order_id: "820982911946154508",
    shopify_order_number: "1048",
    purchaser_email_normalized: "buyer@example.com",
    purchaser_auth_user_id: "00000000-0000-4000-8000-000000000002",
    financial_status: "paid",
    ingestion_outcome: "ready",
    created_at: "2026-08-09T12:00:01Z",
    shopify_created_at: "2026-08-09T12:00:00Z",
    currency: "USD",
    total_price: "49.00",
    shop_domain: "private-store.myshopify.com",
    raw_payload: { secret: "must-not-leak" },
    order_items: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        shopify_line_item_id: "9991",
        title: "Lumi Necklace",
        sku: "LUMI-SILVER",
        quantity: 1,
        current_quantity: 1,
        is_lumi_eligible: true,
        order_item_units: [
          {
            id: "00000000-0000-4000-8000-000000000004",
            unit_ordinal: 1,
            allocation_status: "awaiting_necklace",
            internal_note: "not returned",
          },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        shopify_line_item_id: "9992",
        title: "Gift wrap",
        sku: "GIFT-WRAP",
        quantity: 1,
        current_quantity: 1,
        is_lumi_eligible: false,
        order_item_units: [],
      },
    ],
    ...overrides,
  };
}

function detail(): FactoryOrderDetail {
  const result = serializeFactoryOrderDetail(orderRow());
  assert.ok(result);
  return result;
}

test("unauthenticated factory order list returns 401", async () => {
  const handler = createFactoryOrdersListHandler({
    authorize: async () => {
      throw new FactoryApiError("Authentication required", 401);
    },
    listOrders: async () => ({ orders: [], nextPage: null }),
  });
  const response = await handler(
    new Request("http://localhost/api/factory/orders")
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required" });
});

test("authenticated non-admin factory order list returns 403", async () => {
  const handler = createFactoryOrdersListHandler({
    authorize: async () => {
      throw new FactoryApiError("Insufficient administrator permission", 403);
    },
    listOrders: async () => ({ orders: [], nextPage: null }),
  });
  const response = await handler(
    new Request("http://localhost/api/factory/orders")
  );
  assert.equal(response.status, 403);
});

test("super_admin factory order list returns shaped orders", async () => {
  const summary = serializeFactoryOrderSummary(orderRow());
  assert.ok(summary);
  let authorized = false;
  const handler = createFactoryOrdersListHandler({
    authorize: async () => {
      authorized = true;
    },
    listOrders: async (input) => {
      assert.equal(input.limit, 10);
      return { orders: [summary], nextPage: 2 };
    },
  });
  const response = await handler(
    new Request("http://localhost/api/factory/orders?limit=10")
  );
  assert.equal(authorized, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    orders: [summary],
    nextPage: 2,
  });
});

test("factory list omits orders without Lumi-eligible units", () => {
  const ineligible = orderRow({
    id: "00000000-0000-4000-8000-000000000099",
    order_items: [
      {
        id: "00000000-0000-4000-8000-000000000098",
        shopify_line_item_id: "123",
        title: "Gift wrap",
        sku: "GIFT-WRAP",
        quantity: 1,
        current_quantity: 1,
        is_lumi_eligible: false,
        order_item_units: [],
      },
    ],
  });
  assert.deepEqual(serializeFactoryOrderList([orderRow(), ineligible]), [
    serializeFactoryOrderSummary(orderRow()),
  ]);
});

test("factory order detail returns only eligible line items and units", () => {
  const result = detail();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Lumi Necklace");
  assert.equal(result.items[0].units.length, 1);
  assert.deepEqual(result.items[0].units[0], {
    id: "00000000-0000-4000-8000-000000000004",
    unitOrdinal: 1,
    allocationStatus: "unassigned",
  });
  assert.equal(result.factoryStatus, "needs_nfc");
  assert.equal(result.source, "shopify");
  assert.equal(result.createdAt, "2026-08-09T12:00:00Z");
});

test("factory serializers expose complimentary gifts without payment data", () => {
  const result = serializeFactoryOrderSummary(
    orderRow({
      order_source: "complimentary",
      factory_reference: "GIFT-000001",
      purchaser_name: "Avery Friend",
      shopify_order_id: null,
      shopify_order_number: null,
      shopify_created_at: null,
      financial_status: null,
      currency: null,
      total_price: null,
    })
  );
  assert.ok(result);
  assert.equal(result.orderNumber, "GIFT-000001");
  assert.equal(result.source, "complimentary");
  assert.equal(result.customer.name, "Avery Friend");
  assert.equal(result.createdAt, "2026-08-09T12:00:01Z");
  assert.equal(result.shopifyCreatedAt, null);
  assert.equal(result.financialStatus, null);
  assert.equal(result.totalPrice, null);
});

test("invalid factory order id returns 404 without querying data", async () => {
  let queried = false;
  const handler = createFactoryOrderDetailHandler({
    authorize: async () => undefined,
    getOrder: async () => {
      queried = true;
      return detail();
    },
  });
  const response = await handler(
    new Request("http://localhost/api/factory/orders/not-a-uuid"),
    { params: Promise.resolve({ id: "not-a-uuid" }) }
  );
  assert.equal(response.status, 404);
  assert.equal(queried, false);
});

test("factory lookup resolves a normalized order number", async () => {
  let received = "";
  const handler = createFactoryOrderLookupHandler({
    authorize: async () => undefined,
    getOrder: async (orderNumber) => {
      received = orderNumber;
      return detail();
    },
  });
  const response = await handler(
    new Request(
      "http://localhost/api/factory/orders/lookup?orderNumber=%231048"
    )
  );
  assert.equal(response.status, 200);
  assert.equal(received, "1048");
  assert.equal((await response.json()).order.orderNumber, "1048");
});

test("factory lookup accepts normalized complimentary references", async () => {
  let received = "";
  const handler = createFactoryOrderLookupHandler({
    authorize: async () => undefined,
    getOrder: async (orderNumber) => {
      received = orderNumber;
      return detail();
    },
  });
  const response = await handler(
    new Request(
      "http://localhost/api/factory/orders/lookup?orderNumber=gift-000001"
    )
  );
  assert.equal(response.status, 200);
  assert.equal(received, "GIFT-000001");
});

test("factory search strips PostgREST control characters and caps limits", () => {
  const input = parseFactoryOrderListInput(
    new URL(
      "http://localhost/api/factory/orders?search=%25%2C_%28%29buyer%40example.com&limit=100"
    )
  );
  assert.equal(input.search, "buyer@example.com");
  assert.equal(input.limit, 100);
  assert.throws(
    () =>
      parseFactoryOrderListInput(
        new URL("http://localhost/api/factory/orders?limit=101")
      ),
    FactoryApiError
  );
});

test("factory serializers never expose raw or secret database fields", () => {
  const serialized = JSON.stringify({
    summary: serializeFactoryOrderSummary(orderRow()),
    detail: serializeFactoryOrderDetail(orderRow()),
  });
  for (const forbidden of [
    "shop_domain",
    "private-store",
    "raw_payload",
    "must-not-leak",
    "internal_note",
    "SUPABASE_SECRET_KEY",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
