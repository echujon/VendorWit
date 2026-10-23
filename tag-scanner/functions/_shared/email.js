// Thin, swappable outbound-email sender. Dispatches to whichever
// provider is configured via EMAIL_PROVIDER (a non-secret wrangler.toml
// var) - Resend and SMTP2GO both take a similar {from, to, subject,
// html}-shaped JSON POST, so supporting both is cheap and makes picking
// (or switching) a config change, not a code change. Each provider's API
// key is a dashboard-managed Secret, same convention as
// SQUARE_ACCESS_TOKEN (see functions/_shared/square.js) - neither is
// provisioned yet, so this throws a clear error until one is.
export async function sendEmail(env, { to, subject, html }) {
  const provider = env.EMAIL_PROVIDER;
  if (provider === 'resend') return sendViaResend(env, { to, subject, html });
  if (provider === 'smtp2go') return sendViaSmtp2go(env, { to, subject, html });
  throw new Error('Email not configured: set EMAIL_PROVIDER (resend|smtp2go) and its API key');
}

async function sendViaResend(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    throw new Error('Email not configured: missing RESEND_API_KEY or RESEND_FROM_EMAIL');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to, subject, html })
  });
  if (!res.ok) throw new Error('Failed to send email (Resend): ' + (await res.text()));
}

async function sendViaSmtp2go(env, { to, subject, html }) {
  if (!env.SMTP2GO_API_KEY || !env.SMTP2GO_FROM_EMAIL) {
    throw new Error('Email not configured: missing SMTP2GO_API_KEY or SMTP2GO_FROM_EMAIL');
  }
  const res = await fetch('https://api.smtp2go.com/v3/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: env.SMTP2GO_API_KEY,
      sender: env.SMTP2GO_FROM_EMAIL,
      to: [to],
      subject,
      html_body: html
    })
  });
  if (!res.ok) throw new Error('Failed to send email (SMTP2GO): ' + (await res.text()));
}
