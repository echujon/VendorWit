CREATE TABLE square_connections (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  merchant_id TEXT NOT NULL,
  access_token TEXT NOT NULL,   -- encrypted at rest, see functions/_shared/crypto.js
  refresh_token TEXT NOT NULL,  -- encrypted at rest
  environment TEXT NOT NULL,    -- 'production' or 'sandbox'
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Short-lived, single-use: maps the OAuth `state` param back to which
-- organization started the flow, since Square's redirect back to our
-- callback has no other way to carry that. Rows are deleted once consumed
-- by the callback (see functions/api/square/oauth/callback.js).
CREATE TABLE square_oauth_states (
  state TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
