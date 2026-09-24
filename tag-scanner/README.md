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
