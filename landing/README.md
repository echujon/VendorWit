# VendorWit landing page

Static waitlist landing page, deployed as its own Cloudflare Pages project.

## Deploy

1. In Cloudflare dashboard: Pages → Create project → connect this repo, set build output directory to `landing` (no build command needed).
2. Create a KV namespace (Workers & Pages → KV → Create namespace), e.g. `vendorwit-signups`.
3. In the Pages project → Settings → Functions → KV namespace bindings: bind variable name `SIGNUPS` to that namespace (for both Production and Preview).
4. Deploy. Signups land in KV under keys like `signup:someone@example.com`.

## Local dev

Requires Node + `wrangler`:

```
npx wrangler pages dev landing --kv SIGNUPS
```
