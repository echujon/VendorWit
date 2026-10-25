// Maps a D1 `items` row (snake_case columns, see migrations/0001_init.sql)
// to the record shape the client already works with (camelCase, matching
// what js/storage.js used to read straight out of localStorage).

export function rowToRecord(row) {
  return {
    id: row.id,
    uniqueId: row.unique_id || '',
    name: row.name || '',
    item: row.item || '',
    brand: row.brand || '',
    size: row.size || '',
    color: row.color || '',
    tagColor: row.tag_color || '',
    subVendor: row.sub_vendor || '',
    price: row.price || '',
    quantity: row.quantity || '',
    location: row.bin_location || '',
    photoDataUrl: row.photo_data_url || null,
    embeddingGemini: row.embedding_gemini ? JSON.parse(row.embedding_gemini) : null,
    embeddingClip: row.embedding_clip ? JSON.parse(row.embedding_clip) : null,
    otherFields: row.other_fields_json ? JSON.parse(row.other_fields_json) : {},
    status: row.status || 'holding',
    category: row.category || '',
    createdAt: row.created_at
  };
}
