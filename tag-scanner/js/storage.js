const RECORDS_KEY = 'tag_scanner_records';
const SETTINGS_KEY = 'tag_scanner_settings';

export function getRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveRecord(record) {
  const records = getRecords();
  records.unshift({ ...record, id: Date.now(), createdAt: new Date().toISOString() });
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  return records;
}

export function updateRecord(id, updates) {
  const records = getRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx !== -1) {
    records[idx] = { ...records[idx], ...updates };
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  }
  return records;
}

export function deleteRecord(id) {
  const records = getRecords().filter(r => r.id !== id);
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  return records;
}

export function findByUniqueId(ocrText) {
  const text = (ocrText || '').toLowerCase();
  if (!text) return null;
  return getRecords().find(r => r.uniqueId && text.includes(r.uniqueId.toLowerCase())) || null;
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
export function findByVisualMatch(queryEmbedding, source) {
  const field = source === 'gemini' ? 'embeddingGemini' : 'embeddingClip';
  let best = null;
  for (const record of getRecords()) {
    const candidate = record[field];
    if (!candidate || !candidate.length) continue;
    const score = cosineSimilarity(queryEmbedding, candidate);
    if (!best || score > best.score) best = { record, score };
  }
  if (best && best.score >= VISUAL_MATCH_THRESHOLD) return best;
  return null;
}

export function exportCSV() {
  const records = getRecords();
  const rows = [['Unique ID', 'Name', 'Price', 'Quantity', 'Location', 'Stripe ID', 'Date']];
  records.forEach(r => rows.push([
    `"${(r.uniqueId || '').replace(/"/g, '""')}"`,
    `"${(r.name || '').replace(/"/g, '""')}"`,
    r.price || '',
    r.quantity || '',
    `"${(r.location || '').replace(/"/g, '""')}"`,
    r.stripeId || '',
    r.createdAt || ''
  ]));
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
