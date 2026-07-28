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

## Internal admin dashboard

The production admin application is available at `/admin`. All operational
pages are protected by a server-side Supabase Auth and `admin_user_roles`
check. Every mutation and admin API handler repeats authorization
independently. Phase one authorizes only `super_admin`; the database enum
reserves `support` and `content_admin` for later permission work.
Authenticated customers without an admin role receive a forbidden state.

Apply all Supabase migrations before opening the dashboard:

```bash
supabase db push
```

The admin migration adds server-controlled roles and append-only audit logs;
inventory state and purchased-unit allocation; transactional assignment,
transfer, and unlink functions; Lumi-owned message templates and import
history; and indexes for operational search.

### Grant the first super administrator

Never store admin status in a public environment variable or a
customer-editable profile field. Find the intended Auth user in the Supabase
dashboard, verify its UUID and email out-of-band, then run this once in the SQL
editor while signed in as a trusted project administrator:

```sql
insert into public.admin_user_roles (user_id, role)
values ('00000000-0000-0000-0000-000000000000', 'super_admin');
```

Replace the sample UUID with the verified `auth.users.id`. Later grants should
also populate `granted_by`. The table is RLS-enabled and has no grants for
browser roles.

### Environment

The dashboard reuses the application environment:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_SITE_URL=https://luminecklace.com
```

`SUPABASE_SECRET_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_`.
Shopify visibility additionally depends on the webhook variables documented
above.

### Imports

`/admin/imports/messages` accepts CSV or JSON up to 1 MB and 1,000 rows. It
performs a server-side dry run before commit. Supported fields:

```csv
import_key,title,content,category,status,sort_order,metadata
welcome-001,Welcome,You are loved,affirmation,published,10,"{""tone"":""warm""}"
```

`import_key`, `title`, `content`, and a supported `category` are required.
`status` is `draft`, `published`, or `archived`. `metadata` must be a JSON
object and may configure presentation and Reserve settings. Imports upsert by
stable `import_key` into the global `messages` catalog while excluding
customer-private messages. Error-report CSV output neutralizes spreadsheet
formula prefixes.

The same catalog can be browsed and edited directly at `/admin/messages`.
Admins can create a reusable category inline while creating or editing a message.
Explore publication, Reserve eligibility, ordering, activity, category, and
presentation defaults are independently editable.

Inventory imports on `/admin/necklaces` accept CSV/JSON fields `tag_ref`, `sku`,
and `tap_token_hash`. Existing tag identifiers are skipped and never
overwritten.

### Security and operational notes

- Service-role reads live only in modules marked `server-only`.
- Customer-facing RLS and recipient tap RPC contracts remain unchanged.
- Necklace assignment/unlink is transactional and constrained to one physical
  necklace per eligible purchased unit.
- Audit details reject sensitive key names and do not store private message
  bodies, tokens, secrets, or raw webhook payloads.
- Customer email correction uses Supabase Auth Admin. Invitation recovery
  reuses the existing eligibility and cooldown service.
- Pausing a customer applies a long-lived Supabase Auth ban and records the
  operational state. Already-issued short-lived access tokens expire normally.

### Verification

```bash
npm run lint
npm run build
npm run test:admin
npm run test:shopify
npm run test:recipient-tap
```

Supabase-backed integration tests require the environment variables above and
the latest migrations applied.

### Explicitly deferred

Refund/cancellation mutations, unit voiding, billing changes, arbitrary
webhook replay, advanced charts, background uploads, complete RBAC management,
and animation editing are not part of phase one. App Clip/full-app conversion
is not displayed because the current schema does not record it. Exact
purchase-to-activation duration is available only for activations recorded
after the admin migration.

## Sender Explore Messages API

The native sender app accesses the Explore catalog through Lumi APIs only.
Both endpoints require:

```text
Authorization: Bearer <supabase-access-token>
```

### Browse the library

```text
GET /api/sender/message-library
GET /api/sender/message-library?category=encouragement&search=better&limit=20
GET /api/sender/message-library?necklaceId=<uuid>&cursor=<opaque-cursor>
```

`limit` defaults to 20 and is bounded to 1–50. `cursor` is opaque and must be
returned unchanged. Supported categories are `affection`, `comfort`,
`encouragement`, `presence`, and `reassurance`.

```json
{
  "categories": [
    {
      "key": "encouragement",
      "name": "Encouragement",
      "sortOrder": 3,
      "messageCount": 8
    }
  ],
  "messages": [
    {
      "id": "00000000-0000-0000-0000-000000000000",
      "text": "I believe in you, especially right now.",
      "category": {
        "key": "encouragement",
        "name": "Encouragement"
      },
      "presentation": {
        "theme": "heart",
        "animation": "breathe",
        "sound": "soft"
      },
      "isQueued": false,
      "wasRecentlyRevealed": false,
      "lastUsedAt": null
    }
  ],
  "nextCursor": null
}
```

The three usage fields are included only when `necklaceId` is supplied and the
authenticated sender owns that necklace. “Recently” means revealed within the
last 30 days.

### Add a suggestion to the queue

```text
POST /api/sender/necklaces/<necklaceId>/lumis/from-library
Content-Type: application/json
```

Use the template text:

```json
{
  "messageId": "00000000-0000-0000-0000-000000000000"
}
```

Or provide a personalized snapshot:

```json
{
  "messageId": "00000000-0000-0000-0000-000000000000",
  "text": "This one is just for you."
}
```

Success returns HTTP 201 using the existing sender Lumi contract:

```json
{
  "lumi": {
    "id": "00000000-0000-0000-0000-000000000000",
    "text": "This one is just for you.",
    "queuePosition": 4,
    "presentation": {
      "theme": "heart",
      "animation": "breathe",
      "sound": "soft"
    }
  }
}
```

The queued content and presentation are snapshots. Later template edits or
unpublishing do not alter the queued Lumi. `source_message_id` is retained only
for analytics and duplicate hints.

Explore publication (`is_explore_published`) and automatic Reserve eligibility
(`is_reserve_eligible`) are independent. Direct client reads of the catalog are
not granted; the bearer-authenticated API returns only active Explore records.

After applying migrations, seed the catalog:

```bash
npm run seed
```

The seed is idempotent and publishes the existing five-category Heart
Collection in deterministic category order.
