// Cloudflare Pages Function: POST /api/subscribe
// Stores waitlist signups in the SIGNUPS KV namespace, keyed by email.
//
// Required bindings (set in Cloudflare Pages project settings):
//   SIGNUPS - a KV namespace

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SIGNUPS) {
    return new Response('Server not configured', { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid request', { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const role = (body.role || '').trim().slice(0, 200);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = `signup:${email}`;
  const existing = await env.SIGNUPS.get(key);
  if (!existing) {
    await env.SIGNUPS.put(
      key,
      JSON.stringify({ email, role, createdAt: new Date().toISOString() })
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
