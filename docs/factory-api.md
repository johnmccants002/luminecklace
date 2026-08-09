# Lumi Factory order API

The Factory API exposes the existing paid Shopify order data needed by the
internal Lumi Factory iOS app. It does not assign necklaces, persist NFC state,
lock production sessions, or mutate fulfillment.

## Authentication

Every endpoint requires a valid Supabase session and the server-controlled
`super_admin` role. Mobile clients should send their Supabase access token as:

```http
Authorization: Bearer <supabase-access-token>
```

The API returns `401` when no valid Supabase user is present and `403` when the
authenticated user does not have the required role. The service-role key stays
on the server and must never be shipped in the iOS app.

## Endpoints

### `GET /api/factory/orders`

Returns newest-first paid, non-cancelled orders containing at least one
Lumi-eligible unit.

Query parameters:

- `page`: positive page number; defaults to `1`.
- `limit`: page size from `1` through `100`; defaults to `25`.
- `status`: `needs_nfc`, `in_progress`, `ready`, `completed`, or
  `manual_review`.
- `search`: order number, Shopify order ID, or purchaser email. Input is capped
  at 100 characters and PostgREST control characters are removed.

```json
{
  "orders": [
    {
      "id": "internal-order-uuid",
      "orderNumber": "1048",
      "customer": { "name": null, "email": "buyer@example.com" },
      "shopifyCreatedAt": "2026-08-09T12:00:00Z",
      "financialStatus": "paid",
      "currency": "USD",
      "totalPrice": "49.00",
      "lumiUnits": { "total": 1, "assigned": 0, "unassigned": 1 },
      "factoryStatus": "needs_nfc"
    }
  ],
  "nextPage": null
}
```

### `GET /api/factory/orders/:id`

Returns one paid, non-cancelled order by its internal UUID. Only eligible line
items and their purchased units are returned.

### `GET /api/factory/orders/lookup?orderNumber=1048`

Returns one production-facing order by Shopify's human order number. It also
accepts the stored Shopify order ID for historical compatibility. A leading
`#` is accepted and removed.

Detail and lookup responses use this shape:

```json
{
  "order": {
    "id": "internal-order-uuid",
    "orderNumber": "1048",
    "customer": {
      "name": null,
      "email": "buyer@example.com",
      "authUserId": "supabase-auth-user-uuid"
    },
    "financialStatus": "paid",
    "shopifyCreatedAt": "2026-08-09T12:00:00Z",
    "factoryStatus": "needs_nfc",
    "items": [
      {
        "id": "order-item-uuid",
        "shopifyLineItemId": "9991",
        "title": "Lumi Necklace",
        "sku": "LUMI-SILVER",
        "quantity": 1,
        "isLumiEligible": true,
        "units": [
          {
            "id": "unit-uuid",
            "unitOrdinal": 1,
            "allocationStatus": "unassigned"
          }
        ]
      }
    ]
  }
}
```

## Status derivation and current limitations

- `manual_review`: the paid-order ingestion outcome requires manual review.
- `needs_nfc`: no eligible unit has a necklace allocation yet.
- `in_progress`: some, but not all, eligible units are allocated.
- `ready`: every eligible unit is allocated.
- `completed`: reserved for a later production-state implementation and is not
  currently derived.

These values describe existing allocation data only. The database does not yet
persist NFC write, read-back verification, experience-test, production lock, or
shipment state, so the API does not claim those actions occurred.

Purchaser names are not currently persisted. `customer.name` is therefore
`null`; the API does not infer a name from email. Migration
`20260809120000_factory_order_lookup.sql` adds `shopify_order_number` for future
webhooks. Historical orders fall back to Shopify order ID until explicitly
backfilled from Shopify.

When a `status` filter is used, status is derived after the database page is
loaded. A filtered page can therefore contain fewer than `limit` results while
`nextPage` points to another candidate page.

## Local testing

1. Apply Supabase migrations through the project's normal migration workflow.
2. Configure the existing Supabase variables in `.env`.
3. Run `npm run test:factory`.
4. Run `npm run lint` and `npm run build`.
5. Start `npm run dev`, sign in as a `super_admin`, and call the endpoints with
   the session bearer token.
