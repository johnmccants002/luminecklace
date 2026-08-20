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
unconfirmed Auth user with an eligible queued order (Shopify or complimentary),
never creates a new user, and has a persisted per-email cooldown.

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

### Complimentary gift orders

Apply `20260818120000_complimentary_orders.sql` before deploying the application
code; the Orders admin page and generalized account-confirmation routes depend
on its new columns and RPCs.

Administrators can create non-Shopify gift orders from `/admin/orders`. Enter
the friend's name and email, select an eligible Lumi SKU and quantity, and add
an optional internal note. Lumi reuses an existing Auth account or sends an
account setup invitation immediately, then releases the order to the factory
queue under a `GIFT-000001` style reference. The friend—not the administrator—
owns and controls every necklace allocated to that order.

Complimentary orders do not contain Shopify payment data or webhook delivery
records. Failed invitations remain outside the factory queue and can be
retried from the order detail page. Unassigned complimentary orders can be
cancelled; allocated necklaces must be unlinked first.

After applying the migration to a disposable test project, set
`COMPLIMENTARY_TEST_ADMIN_USER_ID` to an existing `super_admin` and run
`npm run test:complimentary:integration`. The test exercises append-only audit
logging, so it intentionally requires an explicitly selected test admin.

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

## Recipient reveal feedback

Reveal feedback is a one-way acknowledgment attached to a revealed personal
Lumi. It is not messaging: there is no reply thread, sender reply, recipient
history, inbox, or typing state.

The recipient authorizes both actions with the random `revealSessionId` from
the tap resolve response. Necklace, Lumi, sender, and author IDs are resolved
server-side and must not be supplied by the public client. The session must
have completed its reveal and must not be expired.

Supported stable reaction keys are `heart`, `touched`, `laugh`, `sparkle`,
`hug`, and `wow`. The client maps these keys to display emoji.

### Set or replace a reaction

```text
POST /api/tap/reaction
Content-Type: application/json
```

```json
{
  "revealSessionId": "00000000-0000-4000-8000-000000000000",
  "reaction": "touched"
}
```

HTTP 200 returns:

```json
{
  "status": "reacted",
  "feedback": {
    "reaction": "touched",
    "reactionAt": "2026-08-04T20:00:00.000Z",
    "responseText": null,
    "respondedAt": null
  }
}
```

Repeating the same reaction is idempotent. Choosing another supported key
updates the single feedback record and preserves any written response.

### Submit the one written response

```text
POST /api/tap/response
Content-Type: application/json
```

```json
{
  "revealSessionId": "00000000-0000-4000-8000-000000000000",
  "text": "This was exactly what I needed today."
}
```

HTTP 200 returns the same `feedback` shape with `status: "responded"`. Text is
trimmed and must contain 1–250 characters. The first written response is
permanent; later submissions return HTTP 409 with
`status: "already_responded"` and never replace it.

Both endpoints return HTTP 400 for malformed input, 404 for an unavailable
session, 409 when reveal has not completed, and 410 for an expired session.
The authenticated sender necklace response exposes this acknowledgment as
`recentlyRevealed[].feedback`, or `null` when none exists. It never exposes the
reveal session or internal feedback identifiers.

Apply the feedback table and security-definer RPCs before deploying the API:

```bash
supabase db push
```

## Share to Lumi: Instagram links

The backend accepts an Instagram link as an immutable attachment on a normal
queued Lumi:

```text
POST /api/sender/necklaces/<necklaceId>/lumis/from-share
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
```

Example request:

```json
{
  "clientRequestId": "00000000-0000-4000-8000-000000000000",
  "url": "https://www.instagram.com/reel/example/?igsh=tracking",
  "text": "This made me think of you.",
  "destination": "up_next",
  "presentation": {
    "background": "heart",
    "font": "serif",
    "textSize": "medium",
    "textAlignment": "center",
    "textPosition": "center"
  }
}
```

`clientRequestId` is required. The first successful request returns `201`;
an identical retry returns the same Lumi with `200` and
`"idempotentReplay": true`. Reusing the ID with a different necklace, URL,
text, destination, or presentation returns `409`. Blank or omitted text uses
`This made me think of you.`, and the destination defaults to `up_next`.
`reserve` is also supported.

The response uses the existing queue snapshot and adds this object only to
link-backed Lumis:

```json
{
  "attachment": {
    "type": "link",
    "provider": "instagram",
    "contentKind": "reel",
    "url": "https://instagram.com/reel/example/",
    "host": "instagram.com",
    "ctaLabel": "View on Instagram",
    "openMode": "external"
  }
}
```

Posts (`/p/`), Reels (`/reel/` and legacy `/tv/`), Stories, profiles, and
other valid paths on `instagram.com` are supported. The backend stores only a
normalized HTTPS URL. It removes common tracking parameters and fragments; it
does not call Instagram APIs, scrape pages, download media, or generate
previews. Private or expired content may therefore be unavailable to the
recipient. The iOS client opens the returned HTTPS URL, allowing Instagram
Universal Links to select the app or website.

Apply `20260731120000_share_to_lumi_instagram.sql` with the other Supabase
migrations. No Instagram credentials or new environment variables are
required.

Shared-link checks:

```bash
npm run test:shared-links
```

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

## iOS push notifications

Lumi sends owner notifications directly through APNs when a recipient reveals a
personal Lumi, adds the first reaction, or submits the one written response.
The recipient RPC mutation and a deduplicated `push_events` row are committed in
the same Postgres transaction. Per-device `push_deliveries` are claimed with
`SKIP LOCKED`; recipient requests never wait for Apple. Next.js `after()` makes
the first delivery attempt, and `/api/cron/push` recovers pending or retryable
deliveries every five minutes.

Push payloads contain only the event type and internal necklace and Lumi UUIDs.
They never include Lumi text, written responses, email addresses, NFC values,
access tokens, or APNs device tokens.

### Server environment

Configure these server-only values in local development and every deployed
Vercel environment that sends pushes:

```text
APNS_TEAM_ID=<10-character Apple Developer team ID>
APNS_KEY_ID=<Apple push key ID>
APNS_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
APNS_BUNDLE_ID=luminecklace.luminecklace
APNS_DEFAULT_ENVIRONMENT=production
CRON_SECRET=<long random secret>
```

`APNS_PRIVATE_KEY` is the full multiline contents of the downloaded `.p8`
file. Literal `\n` separators are also supported. As an alternative for secret
stores that cannot preserve newlines, set `APNS_PRIVATE_KEY_BASE64` to the
base64 encoding of the complete `.p8` file and omit `APNS_PRIVATE_KEY`.

Never commit the `.p8` file or any Apple credential. Keep `CRON_SECRET` and all
APNs variables free of the `NEXT_PUBLIC_` prefix.

### Apple Developer setup

1. Confirm the full iOS app uses bundle ID `luminecklace.luminecklace` and has
   the Push Notifications capability and remote-notification entitlement.
2. In Apple Developer Certificates, Identifiers & Profiles, create a token-based
   APNs key with Apple Push Notifications service enabled. Download the `.p8`
   file once and record its key ID and the developer-team ID.
3. Add the values above to Vercel Production, Preview, and Development only
   where that environment should send notifications. Redeploy after changing
   them.
4. Apply `supabase/migrations/20260805120000_ios_push_notifications.sql` before
   deploying the API code.

A debug/development build receives a sandbox token. TestFlight and App Store
builds receive production tokens. Tokens are not interchangeable, so the iOS
app must register the matching `environment` with each token. The database
keeps sandbox and production installations distinct.

### Register a development device

After iOS receives the APNs token, send it with the signed-in owner's Supabase
access token:

```bash
curl -X PUT https://<host>/api/push/devices \
  -H "Authorization: Bearer <supabase-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceToken":"<lowercase-hex-apns-token>",
    "environment":"sandbox",
    "bundleId":"luminecklace.luminecklace",
    "appVersion":"1.0",
    "deviceModel":"iPhone"
  }'
```

Registration is idempotent. Registering the same installation after another
owner signs in atomically reassigns it, so the prior owner stops receiving
pushes. Before sign-out, call `DELETE /api/push/devices` with `deviceToken` and
`environment`; the operation is also idempotent.

Owner settings are available through `GET /api/push/preferences` and partial
boolean updates through `PATCH /api/push/preferences`.

### Test and operate delivery

To exercise the production path, register a sandbox device, reveal a test Lumi,
and confirm that the owner receives the safe lock-screen notification. A
protected manual recovery run is available with:

```bash
curl https://<host>/api/cron/push \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Successful deliveries are retained as `sent`. APNs `429` and temporary server
or HTTP/2 failures honor a valid `Retry-After` response and otherwise use
exponential backoff with jitter for up to eight attempts.
Permanent payload/configuration failures are marked `failed`. `Unregistered`,
`ExpiredToken`, `BadDeviceToken`, `DeviceTokenNotForTopic`, and HTTP 410 mark the
installation inactive so it is excluded from future events. A later successful
device registration activates it again.

Manual verification checklist:

- Apply the migration and deploy with all APNs and cron secrets configured.
- Register a sandbox device and verify the row is active without exposing its
  token in logs or API responses.
- Reveal one Lumi twice and confirm only one reveal event/delivery exists.
- React, change the reaction, and confirm only the first reaction notified.
- Submit a response and inspect the APNs payload to confirm response/Lumi text
  is absent.
- Disable each preference and confirm its event is recorded without a delivery.
- Sign out, deactivate the device, and confirm later events do not target it.
- Run the protected cron route and confirm it returns only aggregate counts.

Focused verification:

```bash
npm run test:push
npm run test:recipient-tap
npm run lint
npm run build
```
