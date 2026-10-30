# Tag Scanner

Cloudflare Pages app (static frontend + a single `_worker.js` handling all
API routes — see "Routing" below for why it's not file-based Pages
Functions).

## Two ways to take a card payment, for two different audiences

- **Square Point of Sale deep link** (Settings → Square Point of Sale) — for
  a solo vendor with just a phone and a **Square Reader** (the small
  swipe/tap dongle). A Reader has no Terminal API support of its own; it
  only works through Square's own POS app on the phone, which is what this
  deep link opens (`launchSquarePOS()` in `js/app.js`).
- **Charge via Terminal** (Settings → Square Terminals) — for an
  organization with dedicated **Square Terminal or Square Register**
  hardware (standalone devices with their own screen, using Square's
  Terminal API). Also just works fine for a single device — with only one
  terminal registered, every checkout goes straight to it with no queueing.

These are separate, independent code paths - don't try to route a Square
Reader user through the Terminal one, it won't work.

## Terminal queue (multi-terminal support)

Several people can run the app at once against a smaller pool of physical
Square Terminals. A checkout either gets a free terminal immediately or
joins a shared queue; when a terminal frees up (detected via Square webhook,
via polling, and via a client-side fallback - see `functions/api/webhooks/
square.js`, `functions/api/terminal-checkout/[id].js`, and `js/app.js`'s
`notifyTerminalFreedClientSide`), the next queued request gets pushed a
WebSocket message telling it which terminal to use. Closing the Review Sale
screen doesn't cancel a queued/in-progress sale - it keeps waiting in the
background (tracked in `pendingSales` client-side) so you can keep scanning
other items for a different sale in the meantime.

The `TerminalQueue` Durable Object class that backs this **does not live in
this project** - a Cloudflare Pages project can't self-host a Durable
Object class. It's defined in the sibling `../terminal-queue-worker/`
Worker instead, and this project binds to it cross-script via `script_name`
in `wrangler.toml`. That means **two separate deploys**:

- `tag-scanner` itself auto-deploys via the GitHub integration on push, as
  usual.
- `terminal-queue-worker/worker.js` does **not** auto-deploy - it needs its
  own manual `npx wrangler deploy` from that directory, both the first time
  and again any time that file changes. Easy to forget; check
  `git log -- ../terminal-queue-worker/worker.js` against what's actually
  live if the queue starts behaving oddly after a change.

## Organizations, locations, and shared inventory (D1)

The app is multi-tenant: **organizations** contain **locations**, and
everything scanned/sold at a location (inventory, and the Terminal queue
above) is shared by everyone bound to it, isolated from every other
location. Inventory lives in Cloudflare D1 (`migrations/0001_init.sql`)
instead of the old per-browser `localStorage` - see
`functions/_shared/location.js`, `functions/api/orgs.js`, and
`functions/api/items.js`/`items/[id].js`.

There's no full user login yet - a device binds to a location by entering
its **join code** once in Settings (Location section), stored in
`localStorage` (`js/storage.js`'s `getLocationCode`/`setLocationCode`) and
sent as an `X-Location-Code` header on every inventory/queue request
(query param `?locationCode=` for the WebSocket, which can't set custom
headers). Anyone holding a location's code can act as that location - not a
regression from the app's previous total lack of auth, but also not yet
more secure. A real per-staff auth key is a planned later phase, alongside
each organization connecting its own Square account via OAuth (so a global
`SQUARE_ACCESS_TOKEN` isn't shared across every organization using the app).

The Terminal queue is scoped the same way: `functions/_shared/queue.js`'s
`getQueueStub` addresses the Durable Object by `idFromName(locationId)`
instead of a single global instance, so each location gets its own
isolated terminal pool automatically. One exception: Square's webhook
(`functions/api/webhooks/square.js`) calls this server directly with no
request to read a location header from, so it looks the location up from
the `device_locations` D1 table by device id instead (kept in sync
whenever a terminal is registered, in `functions/api/queue/terminals.js`).

One-time setup for a fresh deploy:
```
wrangler d1 create vendorwit-inventory
```
Paste the `database_id` it prints into `wrangler.toml`'s `[[d1_databases]]`
block, then apply the schema:
```
wrangler d1 migrations apply vendorwit-inventory --remote
```
(drop `--remote` for local dev with `wrangler pages dev`). Unlike the
Durable Object above, D1 bindings work directly in a Pages project's
`wrangler.toml` - no separate Worker needed.

### Dev access (`/dev`)

One platform-wide key sits above every organization and location: the
`DEV_KEY` secret, sent as `X-Dev-Key` (`functions/_shared/dev.js`). The
unlinked `/dev` page uses it to list every organization/location with its
codes, open any location as admin, and add organizations and events.
Creating an organization (`POST /api/orgs`) is dev-only; Settings no longer
offers it.

Set it once per environment - the value is never shown again, so save it
in a password manager first:
```
openssl rand -base64 24            # generate a key
wrangler pages secret put DEV_KEY  # paste it at the prompt, not on the command line
```
Like any Pages secret, it takes effect on the next deployment. Locally,
put a throwaway `DEV_KEY=...` in `.dev.vars` (git-ignored) instead.

## Square OAuth per organization

Each organization can connect its own Square account instead of relying on
the single global `SQUARE_ACCESS_TOKEN` (Settings → Square Account →
"Connect with Square"). This is **additive, not a cutover**: an
organization that hasn't connected keeps working off the global fallback
token exactly as before - see `functions/_shared/square.js`'s
`getSquareCredentials(env, organizationId)`, which every Square-calling
endpoint (`terminal-checkout.js` and friends, plus the new
`functions/api/square/*` endpoints below) now goes through instead of
reading `env.SQUARE_ACCESS_TOKEN` directly.

The actual feature this unlocks: **generating Terminal pairing codes from
inside the app** (`functions/api/square/device-codes.js` +
`device-codes-status.js`, wired into Settings' "Square Account" section),
replacing the manual `curl` against Square's Devices API from earlier in
this project's life.

Flow: `oauth/start.js` redirects to Square's consent screen (organization
resolved from the location join code, same as everywhere else - see
`functions/_shared/location.js`); `oauth/callback.js` exchanges the
authorization code for tokens and stores them **encrypted** (AES-GCM via
`functions/_shared/crypto.js`) in the new `square_connections` D1 table
(`migrations/0002_square_oauth.sql`). Tokens are refreshed automatically
when near expiry (`getSquareCredentials` checks `expires_at` before every
use).

Setup this needs, on top of the D1 migration steps above:
- Register the app's OAuth redirect URI in the Square Developer Dashboard
  as `https://<deployed-url>/api/square/oauth/callback` (byte-for-byte,
  same lesson as the webhook URL)
- `SQUARE_OAUTH_CLIENT_ID` → not sensitive, `wrangler.toml`'s `[vars]`
- `SQUARE_OAUTH_CLIENT_SECRET` → sensitive, dashboard Secret
- `SQUARE_OAUTH_ENCRYPTION_KEY` → sensitive, dashboard Secret, generate
  once with `openssl rand -base64 32` (protects the tokens stored in D1,
  not the tokens themselves - losing this key means every connected
  organization needs to reconnect, so store it somewhere safe too)

**No role gating yet** — any device holding a location's join code can
currently connect/reconnect that organization's Square account or generate
pairing codes, the same no-auth posture the rest of the app has. An
admin-vs-staff distinction (only an "admin" should be able to touch Square
account connection) is a recognized, deliberately deferred next step.

## Consignment registration

The first of 3 planned public (non-staff) views: a self-service
registration flow for consignors at a ski-swap event, entirely separate
from the staff app's `join_code` auth. Staff set a shareable
`consignment_slug` and paste the event's `consignment_terms` text per
location (Settings → Consignment); consignors visit
`https://<deployed-url>/consign/<slug>`, verify their email with a
6-digit one-time code (5 min expiry, `migrations/0010_consignment.sql`'s
`login_codes` table), then fill in phone/address and digitally sign the
agreement (`consignors` table - `signed_terms_snapshot` captures the
agreement text exactly as it read at signing time, since staff could edit
it later). See `functions/api/consign/*.js`, `functions/_shared/
consignorSession.js`, and `consign/index.html`.

**Email provider setup (not configured yet)** - `functions/_shared/
email.js` sends the code via whichever provider `EMAIL_PROVIDER` names in
`wrangler.toml`'s `[vars]` (`"resend"` or `"smtp2go"` - both have similar
enough HTTP APIs that supporting either is cheap). Until one is set up,
`request-code.js` still works end-to-end except the actual send - the
code is logged instead (`console.warn`, visible via `wrangler pages
deployment tail`), so the registration flow is fully testable first.
To actually send real emails:
- **Resend**: create an account at resend.com, verify a sending domain,
  set `EMAIL_PROVIDER = "resend"` and `RESEND_FROM_EMAIL` in
  `wrangler.toml`'s `[vars]`, add `RESEND_API_KEY` as a dashboard Secret.
- **SMTP2GO**: create an account at smtp2go.com, verify a sending domain,
  set `EMAIL_PROVIDER = "smtp2go"` and `SMTP2GO_FROM_EMAIL` in
  `wrangler.toml`'s `[vars]`, add `SMTP2GO_API_KEY` as a dashboard Secret.

**Not built yet** (recognized, deliberately deferred): a staff-facing
list/export of submitted registrations - right now the only way to see
them is a direct D1 query against the `consignors` table.

## Phomemo label printer (Bluetooth)

The "Print Sticker" button on a matched item can print a real label -
description, the item's QR code (the same `uniqueId` the sticker image
already encoded), and price - directly to a Phomemo M110/M120/M220/M200
label printer over Bluetooth, instead of only generating the on-screen QR
to save/share into Phomemo's own Print Master app. Both still happen - the
on-screen QR and share flow are unchanged - printing to a connected printer
is additive.

**Chrome only, one device.** Printing uses the Web Bluetooth API
(`js/phomemo.js`), which only Chrome implements (desktop or Android) -
Safari never will on iOS, by Apple's own platform restriction, not
something fixable from here. The printer connects to *the single device*
that paired it (tap the printer icon, top-right of the header) - there's no
cross-device queue, so whichever phone/laptop paired the printer is the one
that has to run the Print Sticker click. If that one-device model stops
being enough (e.g. several staff need to print to a shared printer from
their own phones), that'd need a shared print-job queue - see
`TerminalQueue`'s Durable Object above for the existing pattern to copy.

**Protocol.** Phomemo has no public spec for this; the BLE service/
characteristic UUIDs, command bytes, and inter-write delays in
`js/phomemo.js` are ported from
[mkuhlmann/pyphomemo](https://github.com/mkuhlmann/pyphomemo) (itself
reverse-engineered from the vendor app's BLE traffic), which covers the
M110/M120/M220/M200 family as one 384-dot-wide (203dpi) protocol. The
delays between writes matter - sending the raster as one unbroken stream
is reported to make the printer flash and discard the job.

**Label size.** Settings -> Label Printer has Width/Height (mm) fields,
defaulting to 40x30mm - the die-cut roll the M120 ships with
(`MEDIA_LABEL_WITH_GAPS` in `js/phomemo.js` - the printer senses each
label's gap to register printing correctly; using `MEDIA_CONTINUOUS` on
die-cut stock will drift). `buildLabelCanvas()` (`js/app.js`) reads that
setting and scales the description/QR/price layout to it - width gets
rounded to a multiple of 8 dots (the raster byte-packing requirement) and
capped at the print head's physical 384-dot/48mm width; height is
unconstrained (any die-cut height, or a tall `MEDIA_CONTINUOUS` label if
that's ever wired up as a Settings option).

## Routing: why `_worker.js` instead of file-based Functions

This project uses Pages "Advanced Mode" - a single [`_worker.js`](_worker.js)
at the project root that routes every request by hand - instead of
file-based Pages Functions (`functions/api/**.js` auto-mapped to routes).
That's because a Durable Object binding needs a `script_name`, and
file-based routing's auto-generated entrypoint has no mechanism to express
that. The actual handler logic is unchanged and still lives under
`functions/`; `_worker.js` just imports and calls it directly.

## Config: `wrangler.toml`

Once `wrangler.toml` exists for a Pages project, Cloudflare treats it as the
source of truth for **plain** environment variables and locks the
dashboard's Environment Variables screen down to Secrets only. So:

- `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_NOTIFICATION_URL` → not sensitive,
  live in `wrangler.toml`'s `[vars]`.
- `SQUARE_ACCESS_TOKEN`, `SQUARE_WEBHOOK_SIGNATURE_KEY` → sensitive, stay as
  dashboard-managed Secrets (Settings → Environment variables → Production).

Forgetting `SQUARE_ENVIRONMENT` silently defaults every Square API call to
the *sandbox* endpoint regardless of what access token you've configured -
worth checking first if Square calls start failing with a generic
"could not be authorized" error.

## Debugging Square auth issues

`GET /api/debug-square` reports what the Worker actually sees at runtime
(resolved environment, whether the access token is present/its length and
first/last 4 characters, and a live `merchants/me` call using the current
config) without exposing the full secret. Useful for telling apart "wrong
value configured" from "value not deployed yet" from "token itself is bad."
This is a diagnostic tool, not something that should stay in production
long-term - remove `functions/api/debug-square.js` (and its route in
`_worker.js`) once things are stable.

Deploy with:

```
npx wrangler pages deploy tag-scanner --project-name <your-project>
```

(or via CI/GitHub integration, which is how this project actually deploys
day to day). The `TERMINAL_QUEUE` binding uses a SQLite-backed Durable
Object class, which is available on the Workers Free plan.

Register terminals from the app's Settings page (Square Terminals section)
rather than editing code — the pool is stored in the Durable Object, shared
across every device running the app.
