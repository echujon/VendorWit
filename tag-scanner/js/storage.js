const SETTINGS_KEY = 'tag_scanner_settings';
const CLIENT_ID_KEY = 'tag_scanner_client_id';
const LOCATION_CODE_KEY = 'tag_scanner_location_code';

// Stable per-device id used to route terminal-queue assignments back to
// whichever app instance requested a checkout.
export function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

// Which location this device is bound to - entered once in Settings after
// creating/joining an organization's location (see functions/api/orgs.js).
// Sent as X-Location-Code on every inventory/terminal-queue request so the
// server knows whose shared data to touch (functions/_shared/location.js).
export function getLocationCode() {
  return localStorage.getItem(LOCATION_CODE_KEY) || '';
}

export function setLocationCode(code) {
  localStorage.setItem(LOCATION_CODE_KEY, (code || '').trim());
}

function locationHeaders() {
  return { 'X-Location-Code': getLocationCode(), 'Content-Type': 'application/json' };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...locationHeaders(), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request to ${path} failed`);
  return data;
}

// Inventory now lives server-side in D1, shared by everyone bound to the
// same location, instead of per-browser localStorage - see
// tag-scanner/functions/api/items.js. A small in-memory cache avoids
// re-fetching on every render; callers that mutate data get the fresh list
// back directly and should re-render from that rather than re-fetching.
let recordsCache = [];

export async function getRecords() {
  recordsCache = await apiFetch('/api/items');
  return recordsCache;
}

export function getCachedRecords() {
  return recordsCache;
}

export async function saveRecord(record) {
  const saved = await apiFetch('/api/items', { method: 'POST', body: JSON.stringify(record) });
  recordsCache = [saved, ...recordsCache];
  return recordsCache;
}

export async function updateRecord(id, updates) {
  const updated = await apiFetch(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
  recordsCache = recordsCache.map(r => (r.id === id ? updated : r));
  return recordsCache;
}

export async function deleteRecord(id) {
  await apiFetch(`/api/items/${id}`, { method: 'DELETE' });
  recordsCache = recordsCache.filter(r => r.id !== id);
  return recordsCache;
}

export async function findByUniqueId(ocrText) {
  const text = (ocrText || '').toString().trim();
  if (!text) return null;

  const normalized = text.toLowerCase();
  const records = await getRecords();
  return records.find(r => {
    const unique = (r.uniqueId || '').toString().trim();
    if (!unique) return false;
    return normalized.includes(unique.toLowerCase()) || normalized === unique.toLowerCase();
  }) || null;
}

export const VISUAL_MATCH_THRESHOLD = 0.85;

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// source is 'gemini' or 'clip' — embeddings from different models live in
// different vector spaces, so matching only ever compares same-source vectors.
export async function findByVisualMatch(queryEmbedding, source) {
  const field = source === 'gemini' ? 'embeddingGemini' : 'embeddingClip';
  const records = await getRecords();
  let best = null;
  for (const record of records) {
    const candidate = record[field];
    if (!candidate || !candidate.length) continue;
    const score = cosineSimilarity(queryEmbedding, candidate);
    if (!best || score > best.score) best = { record, score };
  }
  if (best && best.score >= VISUAL_MATCH_THRESHOLD) return best;
  return null;
}

export function exportCSV(records) {
  const rows = [['Unique ID', 'Name', 'Item', 'Brand', 'Size', 'Color', 'Price', 'Quantity', 'Location', 'Other Fields', 'Stripe ID', 'Date']];
  records.forEach(r => {
    const otherFields = Object.entries(r.otherFields || {}).map(([k, v]) => `${k}: ${v}`).join('; ');
    rows.push([
      `"${(r.uniqueId || '').replace(/"/g, '""')}"`,
      `"${(r.name || '').replace(/"/g, '""')}"`,
      `"${(r.item || '').replace(/"/g, '""')}"`,
      `"${(r.brand || '').replace(/"/g, '""')}"`,
      `"${(r.size || '').replace(/"/g, '""')}"`,
      `"${(r.color || '').replace(/"/g, '""')}"`,
      r.price || '',
      r.quantity || '',
      `"${(r.location || '').replace(/"/g, '""')}"`,
      `"${otherFields.replace(/"/g, '""')}"`,
      r.stripeId || '',
      r.createdAt || ''
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tags-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
