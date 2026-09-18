# Tag Scanner

Cloudflare Pages app (static frontend + Pages Functions).

## Terminal queue (multi-terminal support)

`functions/durable-objects/terminal-queue.js` is a Durable Object that lets
several people run the app at once against a smaller pool of physical Square
Terminals. A checkout either gets a free terminal immediately or joins a
shared queue; when a terminal frees up (detected via Square webhook and via
polling, see `functions/api/webhooks/square.js` and
`functions/api/terminal-checkout/[id].js`), the next queued request gets
pushed a WebSocket message telling it which terminal to use.

This needs the `wrangler.toml` in this folder to actually take effect —
Durable Object bindings/migrations aren't something you can set from the
Pages dashboard alone. Routing also switched from file-based Pages
Functions (`functions/api/**.js` auto-mapped to routes) to Pages "Advanced
Mode": a single [`_worker.js`](_worker.js) at the project root that routes
by hand and exports the `TerminalQueue` class, because file-based routing's
auto-generated entrypoint has no way to export a Durable Object class
alongside it. The actual handler logic is unchanged and still lives under
`functions/`; `_worker.js` just imports and calls it directly instead of
Pages auto-routing to it.

Deploy with:

```
npx wrangler pages deploy tag-scanner --project-name <your-project>
```

(or wire the same `wrangler pages deploy` command into your CI, if you
deploy via GitHub integration today). The `TERMINAL_QUEUE` binding uses a
SQLite-backed Durable Object class, which is available on the Workers Free
plan.

Register terminals from the app's Settings page (Square Terminals section)
rather than editing code — the pool is stored in the Durable Object, shared
across every device running the app.
