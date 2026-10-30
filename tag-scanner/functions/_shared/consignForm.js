// Decides which public consignment form a request is for (online vs
// in-person) and whether that form's window is still open. The in-person
// key arrives as the X-Consign-Access header on API calls, or straight
// from the URL path for the page shell itself (see _worker.js).

export const ACCESS_HEADER = 'X-Consign-Access';

export async function resolveConsignForm(env, slug, accessKey) {
  if (!slug) return { error: 'slug is required', status: 400 };
  const row = await env.DB.prepare(`
    SELECT id, name, consignment_event_name, consignment_terms,
           consignment_online_expires_at, consignment_inperson_expires_at,
           consignment_inperson_key
    FROM locations WHERE consignment_slug = ?
  `).bind(slug).first();
  if (!row) return { error: 'Unknown registration link', status: 404 };

  let mode = 'online';
  if (accessKey) {
    if (!row.consignment_inperson_key || accessKey !== row.consignment_inperson_key) {
      return { error: 'Unknown registration link', status: 404 };
    }
    mode = 'inperson';
  }

  const expiresAt = mode === 'inperson' ? row.consignment_inperson_expires_at : row.consignment_online_expires_at;
  if (!expiresAt || expiresAt <= Date.now()) {
    return { error: 'This page is no longer available', status: 410, closed: true };
  }

  return {
    mode,
    expiresAt,
    location: {
      id: row.id,
      name: row.consignment_event_name || row.name,
      terms: row.consignment_terms || ''
    }
  };
}

export function accessKeyFromRequest(request) {
  return (request.headers.get(ACCESS_HEADER) || '').trim();
}
