// Routed manually (see _worker.js): GET /api/consign/location?slug=
// Public (no X-Location-Code, no session) - just resolves a shareable
// consignment_slug to the event's display name, for the first screen of
// the public registration page (consign/index.html).

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
  if (!slug) return json({ error: 'slug is required' }, 400);

  const row = await env.DB.prepare(
    'SELECT name, consignment_event_name FROM locations WHERE consignment_slug = ?'
  ).bind(slug).first();
  if (!row) return json({ error: 'Unknown registration link' }, 404);

  return json({ locationName: row.consignment_event_name || row.name });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
