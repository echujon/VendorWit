// Routed manually (see _worker.js): DELETE /api/consign/items/:id
// Public, cookie-based. A consignor can remove their own submission, but
// only while it's still 'pending' - once staff have approved or rejected
// it, it's a record of that decision, not something to quietly delete.

import { resolveConsignorSession } from '../../../_shared/consignorSession.js';

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
  if (!slug) return json({ error: 'slug is required' }, 400);

  const session = await resolveConsignorSession(request, env, slug);
  if (!session.authenticated) return json({ error: 'Not authenticated' }, 401);

  const row = await env.DB.prepare(
    'SELECT status FROM consignor_items WHERE id = ? AND consignor_id = ?'
  ).bind(params.id, session.consignor.id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  if (row.status !== 'pending') return json({ error: 'Already reviewed - contact staff to change it' }, 409);

  await env.DB.prepare('DELETE FROM consignor_items WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
