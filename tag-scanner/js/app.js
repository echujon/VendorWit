import { getRecords, saveRecord, updateRecord, deleteRecord, exportCSV, getSettings, findByUniqueId, findByVisualMatch } from './storage.js';
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';

// --- State ---
let stream = null;
let capturedBlob = null;
let cameraActive = false;
let matchedRecord = null;

// --- DOM ---
const video = document.getElementById('video');
const previewImg = document.getElementById('preview-img');
const statusBar = document.getElementById('status-bar');
const statusMsg = document.getElementById('status-msg');
const noMatchCard = document.getElementById('no-match-card');
const matchCard = document.getElementById('match-card');
const resultCard = document.getElementById('result-card');
const resultCardTitle = document.getElementById('result-card-title');
const fieldUniqueId = document.getElementById('field-unique-id');
const fieldName = document.getElementById('field-name');
const fieldPrice = document.getElementById('field-price');
const fieldQuantity = document.getElementById('field-quantity');
const fieldLocation = document.getElementById('field-location');
const ocrRaw = document.getElementById('ocr-raw');
const ocrRawSelectable = document.getElementById('ocr-raw-selectable');
const recordsList = document.getElementById('records-list');
const scanOverlay = document.querySelector('.scan-overlay');
const scanPlaceholder = document.querySelector('.scan-placeholder');

// --- Buttons ---
const btnCamera = document.getElementById('btn-camera');
const btnCapture = document.getElementById('btn-capture');
const btnUpload = document.getElementById('btn-upload');
const btnNewItem = document.getElementById('btn-new-item');
const btnDiscardScan = document.getElementById('btn-discard-scan');
const btnEditMatch = document.getElementById('btn-edit-match');
const btnSellOne = document.getElementById('btn-sell-one');
const btnNotAMatch = document.getElementById('btn-not-a-match');
const btnDiscardMatch = document.getElementById('btn-discard-match');
const btnUseSelection = document.getElementById('btn-use-selection');
const btnSave = document.getElementById('btn-save');
const btnStripe = document.getElementById('btn-stripe');
const btnSquare = document.getElementById('btn-square');
const btnDiscard = document.getElementById('btn-discard');
const btnExport = document.getElementById('btn-export');
const fileInput = document.getElementById('file-input');

// --- Camera ---
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1024 }, height: { ideal: 960 } }
    });
    video.srcObject = stream;
    video.classList.remove('hidden');
    previewImg.classList.add('hidden');
    scanOverlay.style.display = 'flex';
    scanPlaceholder.style.display = 'none';
    btnCamera.textContent = 'Stop';
    btnCapture.disabled = false;
    cameraActive = true;
  } catch (err) {
    toast('Camera access denied', 'error');
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  video.classList.add('hidden');
  scanOverlay.style.display = 'none';
  scanPlaceholder.style.display = 'flex';
  btnCamera.textContent = 'Camera';
  btnCapture.disabled = true;
  cameraActive = false;
}

function captureFrame() {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    capturedBlob = blob;
    const url = URL.createObjectURL(blob);
    previewImg.src = url;
    previewImg.classList.remove('hidden');
    video.classList.add('hidden');
    scanOverlay.style.display = 'none';
    stopCamera();
    processImage(blob);
  }, 'image/jpeg', 0.92);
}

// --- File upload ---
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  loadFile(file);
  fileInput.value = '';
});

// --- Drag and drop ---
const previewContainer = document.getElementById('preview-container');

previewContainer.addEventListener('dragover', e => {
  e.preventDefault();
  previewContainer.classList.add('drag-over');
});

previewContainer.addEventListener('dragleave', e => {
  if (!previewContainer.contains(e.relatedTarget)) {
    previewContainer.classList.remove('drag-over');
  }
});

previewContainer.addEventListener('drop', e => {
  e.preventDefault();
  previewContainer.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    loadFile(file);
  } else {
    toast('Drop an image file', 'error');
  }
});

function loadFile(file) {
  capturedBlob = file;
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewImg.classList.remove('hidden');
  video.classList.add('hidden');
  scanOverlay.style.display = 'none';
  scanPlaceholder.style.display = 'none';
  if (cameraActive) stopCamera();
  processImage(file);
}

// --- OCR + AI ---
let lastRawText = '';

async function processImage(blob) {
  hideAllResultCards();
  showStatus('Running OCR...');

  let rawText = '';
  try {
    rawText = await runOCR(blob);
  } catch (err) {
    console.warn('OCR failed:', err);
    rawText = '';
  }

  lastRawText = rawText;

  const textMatch = rawText.trim() ? findByUniqueId(rawText) : null;
  if (textMatch) {
    hideStatus();
    showMatchCard(textMatch, 'text');
    return;
  }

  // No text match (or no text at all, e.g. an untagged handmade item) —
  // try appearance-based matching before falling back to "no match".
  showStatus('Checking appearance...');
  const embeddings = await embedImage(blob);
  let visualMatch = null;
  if (embeddings.gemini) visualMatch = findByVisualMatch(embeddings.gemini, 'gemini');
  if (!visualMatch && embeddings.clip) visualMatch = findByVisualMatch(embeddings.clip, 'clip');

  hideStatus();

  if (visualMatch) {
    showMatchCard(visualMatch.record, 'visual', visualMatch.score);
  } else {
    showNoMatchCard(rawText);
  }
}

function hideAllResultCards() {
  noMatchCard.classList.remove('visible');
  matchCard.classList.remove('visible');
  resultCard.classList.remove('visible');
}

function showNoMatchCard(rawText) {
  ocrRaw.textContent = rawText;
  noMatchCard.classList.add('visible');
  noMatchCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showMatchCard(record, matchType = 'text', score = null) {
  matchedRecord = record;
  document.getElementById('match-uniqueId').textContent = record.uniqueId || '—';
  document.getElementById('match-name').textContent = record.name || '—';
  document.getElementById('match-price').textContent = record.price ? `$${record.price}` : '—';
  document.getElementById('match-quantity').textContent = record.quantity || '—';
  document.getElementById('match-location').textContent = record.location || '—';

  const badge = document.getElementById('match-badge');
  badge.textContent = matchType === 'visual'
    ? `Matched by appearance (${Math.round(score * 100)}%)`
    : 'Matched by tag';

  const photo = document.getElementById('match-photo');
  if (record.photoDataUrl) {
    photo.src = record.photoDataUrl;
    photo.classList.remove('hidden');
  } else {
    photo.classList.add('hidden');
  }

  matchCard.classList.add('visible');
  matchCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showNewItemForm(rawText, prefill = {}) {
  resultCardTitle.textContent = prefill.id ? 'Edit Item' : 'New Item';
  ocrRawSelectable.textContent = rawText || '';
  fieldUniqueId.value = prefill.uniqueId || '';
  fieldName.value = prefill.name || '';
  fieldPrice.value = prefill.price || '';
  fieldQuantity.value = prefill.quantity || '';
  fieldLocation.value = prefill.location || '';
  resultCard.dataset.editId = prefill.id || '';
  hideAllResultCards();
  resultCard.classList.add('visible');
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function runOCR(blob) {
  // Try Gemini first
  const geminiResult = await runGeminiOCR(blob);
  if (geminiResult !== null) {
    return geminiResult;
  }
  // Fall back to Tesseract.js
  showStatus('Falling back to Tesseract OCR...');
  return await runTesseractOCR(blob);
}

async function runGeminiOCR(blob) {
  showStatus('Extracting text with Gemini...');
  try {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      console.warn('No Gemini API key configured');
      return null;
    }

    // Convert blob to base64
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binaryString);

    // Call Gemini API directly
    const response = await fetch(
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + apiKey,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              // 1. Changed inline_data and mime_type to camelCase for raw JSON
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64,
              },
            },
            {
              text: 'Extract all visible text from this image. Return only the text, line by line. Be accurate with handwriting.',
            },
          ],
        },
      ],
      // 2. Moved mediaResolution inside generationConfig where the JSON parser expects it
      generationConfig: {
        mediaResolution: 'MEDIA_RESOLUTION_LOW',
      }
    }),
  }
);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      return '';
    }

    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  } catch (err) {
    console.warn('Gemini OCR failed:', err);
    return null;
  }
}

async function runTesseractOCR(blob) {
  const { createWorker } = Tesseract;
  const worker = await createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text') {
        showStatus(`OCR: ${Math.round(m.progress * 100)}%`);
      }
    }
  });
  const url = URL.createObjectURL(blob);
  const result = await worker.recognize(url);
  await worker.terminate();
  URL.revokeObjectURL(url);
  return result.data.text;
}

// --- Visual matching (appearance-based, for untagged items) ---
// Gemini and CLIP embeddings live in different vector spaces, so a record
// stores both when available and matching only ever compares same-source
// vectors (see findByVisualMatch in storage.js).
const GEMINI_EMBED_DIMENSIONS = 768;
let clipPipelinePromise = null;

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binaryString);
}

async function embedImageGemini(blob) {
  try {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return null;

    const base64 = await blobToBase64(blob);

    const describeRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64 } },
              { text: 'Describe this small handmade item\'s visual appearance in detail for the purpose of matching it against photos of other similar items: shape, color palette, pattern, texture, and any distinctive marks. Be specific and consistent.' }
            ]
          }],
          generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_LOW' }
        })
      }
    );
    if (!describeRes.ok) {
      console.warn('Gemini vision call failed:', describeRes.status, await describeRes.text());
      return null;
    }
    const describeData = await describeRes.json();
    const description = describeData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!description.trim()) return null;

    const embedRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: description }] },
          output_dimensionality: GEMINI_EMBED_DIMENSIONS
        })
      }
    );
    if (!embedRes.ok) {
      console.warn('Gemini embedContent call failed:', embedRes.status, await embedRes.text());
      return null;
    }
    const embedData = await embedRes.json();
    return embedData.embedding?.values || null;
  } catch (err) {
    console.warn('Gemini image embedding failed:', err);
    return null;
  }
}

function getClipPipeline() {
  if (!clipPipelinePromise) {
    clipPipelinePromise = pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', { dtype: 'q8' });
  }
  return clipPipelinePromise;
}

async function embedImageClip(blob) {
  try {
    showStatus('Loading offline image model...');
    const extractor = await getClipPipeline();
    const url = URL.createObjectURL(blob);
    try {
      const output = await extractor(url, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.warn('CLIP image embedding failed:', err);
    return null;
  }
}

async function embedImage(blob) {
  const [gemini, clip] = await Promise.all([
    embedImageGemini(blob),
    embedImageClip(blob)
  ]);
  return { gemini, clip };
}

function resizeImageToDataUrl(blob, maxDim = 256, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for resizing'));
    };
    img.src = url;
  });
}

// --- Stripe ---
async function pushToStripe(record) {
  const { stripeKey } = getSettings();
  if (!stripeKey) throw new Error('No Stripe secret key configured');

  const priceInCents = Math.round(parseFloat(record.price) * 100);
  if (isNaN(priceInCents) || priceInCents <= 0) throw new Error('Invalid price');

  // Create product
  const productRes = await fetch('https://api.stripe.com/v1/products', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ name: record.name })
  });
  if (!productRes.ok) {
    const err = await productRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Stripe product error ${productRes.status}`);
  }
  const product = await productRes.json();

  // Create price
  const priceRes = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      product: product.id,
      unit_amount: String(priceInCents),
      currency: 'usd'
    })
  });
  if (!priceRes.ok) {
    const err = await priceRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Stripe price error ${priceRes.status}`);
  }
  const price = await priceRes.json();
  return { productId: product.id, priceId: price.id };
}

// --- Square POS ---
// Deep-links into the Square Point of Sale app via its documented URL scheme (iOS)
// / Intent (Android). There's no reliable way for a plain website (as opposed to a
// native app with a registered URL scheme) to receive Square's charge-result
// callback, so this only launches POS pre-filled with the amount — it doesn't
// confirm the charge completed. Verify param names against Square's current docs
// (developer.squareup.com) before relying on this in production.
function detectMobilePlatform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
}

function launchSquarePOS(record) {
  const { squareAppId } = getSettings();
  if (!squareAppId) throw new Error('No Square Application ID configured (Settings)');

  const amount = Math.round(parseFloat(record.price) * 100);
  if (isNaN(amount) || amount <= 0) throw new Error('Invalid price');

  const platform = detectMobilePlatform();
  const callbackUrl = window.location.href;

  if (platform === 'ios') {
    const payload = {
      amount_money: { amount, currency_code: 'USD' },
      callback_url: callbackUrl,
      client_id: squareAppId,
      version: '1.3',
      notes: record.name || '',
      options: { supported_tender_types: ['CREDIT_CARD', 'CASH', 'OTHER'] }
    };
    window.location.href = 'square-commerce-v1://payment/create?data=' + encodeURIComponent(JSON.stringify(payload));
  } else if (platform === 'android') {
    const extras = [
      `S.browser_fallback_url=${encodeURIComponent(callbackUrl)}`,
      `S.com.squareup.pos.CLIENT_ID=${encodeURIComponent(squareAppId)}`,
      'S.com.squareup.pos.API_VERSION=v2.0',
      `i.com.squareup.pos.TOTAL_AMOUNT=${amount}`,
      'S.com.squareup.pos.CURRENCY_CODE=USD',
      'S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD,com.squareup.pos.TENDER_CASH',
      record.name ? `S.com.squareup.pos.NOTE=${encodeURIComponent(record.name)}` : null
    ].filter(Boolean).join(';');
    window.location.href = `intent://com.squareup.pos.action.CHARGE#Intent;action=com.squareup.pos.action.CHARGE;package=com.squareup;${extras};end`;
  } else {
    throw new Error('Square POS launch only works on an iPhone or Android phone with the Square Point of Sale app installed');
  }
}

// --- No-match card actions ---
btnNewItem.addEventListener('click', () => {
  showNewItemForm(lastRawText);
});

btnDiscardScan.addEventListener('click', resetScanArea);

// --- Match card actions ---
btnEditMatch.addEventListener('click', () => {
  showNewItemForm(lastRawText, matchedRecord);
});

btnSellOne.addEventListener('click', () => {
  if (!matchedRecord) return;
  const newQty = Math.max(0, (parseInt(matchedRecord.quantity, 10) || 0) - 1);
  updateRecord(matchedRecord.id, { quantity: String(newQty) });
  matchedRecord = { ...matchedRecord, quantity: String(newQty) };
  document.getElementById('match-quantity').textContent = String(newQty);
  renderRecords();
  toast(`Sold — ${newQty} left`, 'success');
});

btnNotAMatch.addEventListener('click', () => {
  matchedRecord = null;
  showNewItemForm(lastRawText);
});

btnDiscardMatch.addEventListener('click', resetScanArea);

// --- Unique identifier selection ---
btnUseSelection.addEventListener('click', () => {
  const selection = window.getSelection().toString().trim();
  if (!selection) { toast('Highlight some text first', 'error'); return; }
  fieldUniqueId.value = selection;
});

// --- Save / Discard (new item / edit form) ---
function collectFormData() {
  return {
    uniqueId: fieldUniqueId.value.trim(),
    name: fieldName.value.trim(),
    price: fieldPrice.value.trim(),
    quantity: fieldQuantity.value.trim(),
    location: fieldLocation.value.trim()
  };
}

// Attaches a reference photo + appearance embeddings to a new/edited record,
// captured from whatever photo is currently loaded (capturedBlob) — this is
// the "photograph it once when adding to inventory" step for untagged items.
async function attachVisualData(data) {
  if (!capturedBlob) return data;
  showStatus('Analyzing photo...');
  const [photoDataUrl, embeddings] = await Promise.all([
    resizeImageToDataUrl(capturedBlob).catch(() => null),
    embedImage(capturedBlob)
  ]);
  hideStatus();
  return {
    ...data,
    photoDataUrl: photoDataUrl || data.photoDataUrl,
    embeddingGemini: embeddings.gemini || data.embeddingGemini,
    embeddingClip: embeddings.clip || data.embeddingClip
  };
}

btnSave.addEventListener('click', async () => {
  const data = await attachVisualData(collectFormData());
  if (!data.name && !data.price) { toast('Add a name or price first', 'error'); return; }
  const editId = resultCard.dataset.editId ? Number(resultCard.dataset.editId) : null;
  if (editId) {
    updateRecord(editId, data);
  } else {
    saveRecord(data);
  }
  resetScanArea();
  renderRecords();
  toast('Saved!', 'success');
});

btnStripe.addEventListener('click', async () => {
  const data = await attachVisualData(collectFormData());
  if (!data.name || !data.price) { toast('Name and price required', 'error'); return; }
  btnStripe.disabled = true;
  showStatus('Pushing to Stripe...');
  try {
    const ids = await pushToStripe(data);
    const editId = resultCard.dataset.editId ? Number(resultCard.dataset.editId) : null;
    const stripeFields = { ...data, stripeId: ids.productId, priceId: ids.priceId, sentToStripe: true };
    if (editId) {
      updateRecord(editId, stripeFields);
    } else {
      saveRecord(stripeFields);
    }
    resetScanArea();
    renderRecords();
    hideStatus();
    toast('Saved + pushed to Stripe!', 'success');
  } catch (err) {
    hideStatus();
    toast('Stripe error: ' + err.message, 'error');
  } finally {
    btnStripe.disabled = false;
  }
});

btnSquare.addEventListener('click', () => {
  const data = collectFormData();
  if (!data.uniqueId) { toast('Set a unique identifier first', 'error'); return; }
  if (!data.name || !data.price) { toast('Name and price required', 'error'); return; }
  try {
    launchSquarePOS(data);
  } catch (err) {
    toast('Square POS error: ' + err.message, 'error');
  }
});

btnDiscard.addEventListener('click', resetScanArea);

function resetScanArea() {
  hideAllResultCards();
  matchedRecord = null;
  capturedBlob = null;
  previewImg.classList.add('hidden');
  scanPlaceholder.style.display = 'flex';
}

// --- Records ---
function renderRecords() {
  const records = getRecords();
  if (!records.length) {
    recordsList.innerHTML = '<div class="empty-state">No records yet — scan a tag to get started.</div>';
    return;
  }
  recordsList.innerHTML = records.map(r => `
    <div class="record-item" data-id="${r.id}">
      <div class="record-info">
        <div class="record-name">${esc(r.name || '(no name)')}</div>
        <div class="record-meta">${esc(r.uniqueId || '')}${r.uniqueId ? ' · ' : ''}${r.quantity ? `Qty ${esc(r.quantity)} · ` : ''}${esc(r.location || '')}${r.location ? ' · ' : ''}${new Date(r.createdAt).toLocaleDateString()} ${r.sentToStripe ? '· In Stripe' : ''}</div>
      </div>
      <div class="record-price">$${esc(r.price || '—')}</div>
      <div class="record-actions">
        ${!r.sentToStripe ? `<button class="record-btn push-stripe" data-id="${r.id}">→ Stripe</button>` : `<span class="record-btn stripe-sent">✓ Stripe</span>`}
        <button class="record-btn delete" data-id="${r.id}" title="Delete">✕</button>
      </div>
    </div>
  `).join('');
}

recordsList.addEventListener('click', async e => {
  const id = Number(e.target.dataset.id);
  if (!id) return;

  if (e.target.classList.contains('delete')) {
    deleteRecord(id);
    renderRecords();
    return;
  }

  if (e.target.classList.contains('push-stripe')) {
    const records = getRecords();
    const record = records.find(r => r.id === id);
    if (!record) return;
    e.target.disabled = true;
    e.target.textContent = '...';
    showStatus('Pushing to Stripe...');
    try {
      const ids = await pushToStripe(record);
      updateRecord(id, { stripeId: ids.productId, priceId: ids.priceId, sentToStripe: true });
      renderRecords();
      hideStatus();
      toast('Pushed to Stripe!', 'success');
    } catch (err) {
      hideStatus();
      toast('Stripe error: ' + err.message, 'error');
      e.target.disabled = false;
      e.target.textContent = '→ Stripe';
    }
  }
});

// --- Event listeners ---
btnCamera.addEventListener('click', () => {
  if (cameraActive) stopCamera();
  else startCamera();
});

btnCapture.addEventListener('click', captureFrame);
btnUpload.addEventListener('click', () => fileInput.click());
btnExport.addEventListener('click', () => { exportCSV(); toast('CSV downloaded', 'success'); });

// --- Helpers ---
function showStatus(msg) {
  statusMsg.textContent = msg;
  statusBar.classList.add('visible');
}
function hideStatus() { statusBar.classList.remove('visible'); }

let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// --- Init ---
// Service worker registration disabled during active development —
// its cache-first strategy was serving stale app.js/index.html across reloads.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
}
renderRecords();
scanOverlay.style.display = 'none';
scanPlaceholder.style.display = 'flex';
video.classList.add('hidden');
