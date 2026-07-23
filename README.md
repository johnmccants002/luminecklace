This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# luminecklace

## Shopify paid-order webhook

The production endpoint is:

```text
POST /api/webhooks/shopify/orders-paid
```

Subscribe it to Shopify's `orders/paid` topic. The endpoint verifies the HMAC
over the untouched request body, stores the paid-order financial snapshot,
creates one `order_item_units` row per eligible purchased unit, and provisions
the purchaser's Supabase account. It does not allocate physical necklaces.

Required server-only environment variables:

```text
SHOPIFY_WEBHOOK_SECRET=<Shopify app client secret>
SHOPIFY_STORE_DOMAIN=<store>.myshopify.com
SHOPIFY_LUMI_SKUS=LUMI-GOLD,LUMI-SILVER
```

`SHOPIFY_LUMI_SKUS` is trimmed but case-sensitive. All Shopify line items are
recorded, while only exact SKU matches create units. Changing the allowlist
does not retroactively change existing orders.

### Supabase email setup

Production must use custom SMTP configured in Supabase Auth. Do not depend on
the default Supabase SMTP service for purchase invitations. Add the production
Lumi origin to the Auth redirect allowlist and disable provider email-link
tracking.

Configure the **Invite user** template link as:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">
  Set up your Lumi account
</a>
```

Configure the **Magic link** template link as:

```html
<a href="{{ .SiteURL }}/auth/recover/confirm?token_hash={{ .TokenHash }}&type=magiclink">
  Continue setting up your Lumi account
</a>
```

Expired invite recovery is available through:

```text
POST /api/auth/invitations/recover
{ "email": "buyer@example.com" }
```

The response is intentionally non-enumerating. Recovery only sends for an
unconfirmed Auth user with an eligible paid order, never creates a new user,
and has a persisted per-email cooldown.

### Deferred Shopify events

This integration intentionally does not process `orders/cancelled` or
`refunds/create`. Cancellation/refund financial reconciliation, unit voiding,
and physical necklace allocation require separate handlers and migrations.
