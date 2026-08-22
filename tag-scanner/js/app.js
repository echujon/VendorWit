import { getRecords, saveRecord, updateRecord, deleteRecord, exportCSV, getSettings, findByUniqueId, findByVisualMatch } from './storage.js';
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';

// --- State ---
let stream = null;
let capturedBlob = null;
let cameraActive = false;
let matchedRecord = null;
let cart = []; // { id, name, price, quantity } — quantity here is units being sold, not inventory

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
const btnScanModeOcr = document.getElementById('btn-scan-mode-ocr');
const btnScanModeImage = document.getElementById('btn-scan-mode-image');
let scanMode = 'ocr';

function setScanMode(mode) {
  scanMode = mode;
  btnScanModeOcr.classList.toggle('active', mode === 'ocr');
  btnScanModeImage.classList.toggle('active', mode === 'image');
}
btnScanModeOcr.addEventListener('click', () => setScanMode('ocr'));
btnScanModeImage.addEventListener('click', () => setScanMode('image'));
const scanPlaceholder = document.querySelector('.scan-placeholder');

// --- Buttons ---
const btnCamera = document.getElementById('btn-camera');
const btnCapture = document.getElementById('btn-capture');
const btnUpload = document.getElementById('btn-upload');
const btnNewItem = document.getElementById('btn-new-item');
const btnDiscardScan = document.getElementById('btn-discard-scan');
const btnEditMatch = document.getElementById('btn-edit-match');
const btnSellOne = document.getElementById('btn-sell-one');
const btnSquareMatch = document.getElementById('btn-square-match');
const btnVenmoMatch = document.getElementById('btn-venmo-match');
const venmoQr = document.getElementById('venmo-qr');
const btnAddToCart = document.getElementById('btn-add-to-cart');
const reviewSaleBar = document.getElementById('review-sale-bar');
const reviewSaleSummary = document.getElementById('review-sale-summary');
const reviewModal = document.getElementById('review-modal');
const btnReviewModalClose = document.getElementById('btn-review-modal-close');
const reviewCartList = document.getElementById('review-cart-list');
const reviewTotalDisplay = document.getElementById('review-total-display');
const btnReviewTerminal = document.getElementById('btn-review-terminal');
const terminalStatus = document.getElementById('terminal-status');
const btnReviewVenmo = document.getElementById('btn-review-venmo');
const btnReviewSquare = document.getElementById('btn-review-square');
const btnReviewComplete = document.getElementById('btn-review-complete');
const btnReviewClear = document.getElementById('btn-review-clear');
const venmoModal = document.getElementById('venmo-modal');
const venmoModalTotal = document.getElementById('venmo-modal-total');
const venmoModalQr = document.getElementById('venmo-modal-qr');
const btnVenmoModalClose = document.getElementById('btn-venmo-modal-close');
const btnVenmoModalEdit = document.getElementById('btn-venmo-modal-edit');
const btnVenmoModalSuccess = document.getElementById('btn-venmo-modal-success');
const btnNotAMatch = document.getElementById('btn-not-a-match');
const btnUseSelection = document.getElementById('btn-use-selection');
const btnSave = document.getElementById('btn-save');
const btnStripe = document.getElementById('btn-stripe');
const btnSquare = document.getElementById('btn-square');
const btnDiscard = document.getElementById('btn-discard');
const btnExport = document.getElementById('btn-export');
const btnSeedTest = document.getElementById('btn-seed-test');
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

const OCR_MAX_DIM = 1600;

// Uploaded/dropped photos come straight from a phone gallery at full camera
// resolution (often 10+MB), which makes base64 encoding, upload, and OCR
// itself much slower than it needs to be — downscale to what OCR actually
// needs, same as the live camera capture already does implicitly via its
// capture resolution constraint.
function downscaleForOcr(blob, maxDim = OCR_MAX_DIM, quality = 0.85) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale === 1) {
        URL.revokeObjectURL(url);
        resolve(blob);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(resized => resolve(resized || blob), 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.src = url;
  });
}

async function loadFile(file) {
  const blob = await downscaleForOcr(file);
  capturedBlob = blob;
  const url = URL.createObjectURL(blob);
  previewImg.src = url;
  previewImg.classList.remove('hidden');
  video.classList.add('hidden');
  scanOverlay.style.display = 'none';
  scanPlaceholder.style.display = 'none';
  if (cameraActive) stopCamera();
  processImage(blob);
}

// --- OCR + AI ---
let lastRawText = '';

async function processImage(blob) {
  hideAllResultCards();

  const skipOcr = scanMode === 'image';
  let rawText = '';
  if (!skipOcr) {
    showStatus('Running OCR...');
    try {
      rawText = await runOCR(blob);
    } catch (err) {
      console.warn('OCR failed:', err);
      rawText = '';
    }
  }

  lastRawText = rawText;

  const parsedScan = parseScannedText(rawText);
  const textMatch = parsedScan.uniqueId
    ? findByUniqueId(parsedScan.uniqueId)
    : rawText.trim()
      ? findByUniqueId(rawText)
      : null;

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
  document.getElementById('match-card-title').textContent = matchType === 'saved' ? 'Item Details' : 'Matched Item';
  document.getElementById('match-uniqueId').textContent = record.uniqueId || '—';
  document.getElementById('match-name').textContent = record.name || '—';
  document.getElementById('match-price').textContent = record.price ? `$${record.price}` : '—';
  document.getElementById('match-quantity').textContent = record.quantity || '—';
  document.getElementById('match-location').textContent = record.location || '—';

  const badge = document.getElementById('match-badge');
  badge.textContent = matchType === 'visual'
    ? `Matched by appearance (${Math.round(score * 100)}%)`
    : matchType === 'saved'
      ? 'Saved item'
      : 'Matched by tag';

  // "Not a match" only makes sense when this came from a live scan.
  btnNotAMatch.style.display = matchType === 'saved' ? 'none' : '';

  const photo = document.getElementById('match-photo');
  if (record.photoDataUrl) {
    photo.src = record.photoDataUrl;
    photo.classList.remove('hidden');
  } else {
    photo.classList.add('hidden');
  }

  venmoQr.classList.add('hidden');
  venmoQr.removeAttribute('src');

  matchCard.classList.add('visible');
  matchCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function parseScannedText(rawText = '') {
  const lines = (rawText || '').replace(/\r\n?/g, '\n').split('\n');
  let price = '';
  let uniqueId = '';
  const descriptionParts = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const priceMatch = trimmed.match(/\$\s*\d+(?:\.\d{1,2})?/);
    if (priceMatch && !price) {
      price = priceMatch[0].replace(/\$/g, '').trim();
    }

    const idMatch = trimmed.match(/(?:id|sku|item)[\s:-]*([A-Za-z0-9]{3,})/i) || trimmed.match(/\b(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{4,}\b/);
    if (idMatch && !uniqueId) {
      uniqueId = (idMatch[1] || idMatch[0]).replace(/[^A-Za-z0-9]/g, '').trim();
    }

    let descriptionLine = trimmed;
    if (priceMatch) {
      descriptionLine = descriptionLine.replace(priceMatch[0], '').trim();
    }
    const matchedId = idMatch ? (idMatch[1] || idMatch[0]) : null;
    if (matchedId) {
      descriptionLine = descriptionLine.replace(new RegExp(`(?:id|sku|item)[\\s:-]*${matchedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '').trim();
      descriptionLine = descriptionLine.replace(new RegExp(`\\b${matchedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '').trim();
    }

    descriptionLine = descriptionLine
      .replace(/\b(?:id|sku|item)\b\s*[:\-]?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (descriptionLine && !/^\$?\d+(?:\.\d{1,2})?$/.test(descriptionLine)) {
      descriptionParts.push(descriptionLine);
    }
  }

  const name = descriptionParts.join(' ').trim();
  return {
    uniqueId,
    name,
    price,
    quantity: '',
    location: ''
  };
}

function askIfRecordIsCorrect(data = {}) {
  const summary = [
    data.uniqueId ? `ID: ${data.uniqueId}` : null,
    data.name ? `Name: ${data.name}` : null,
    data.price ? `Price: $${data.price}` : null
  ].filter(Boolean).join('\n');

  if (!summary) return true;
  return window.confirm(`Does this record look correct?\n\n${summary}`);
}

function showNewItemForm(rawText, prefill = {}) {
  const parsed = Object.keys(prefill).length ? prefill : parseScannedText(rawText);

  resultCardTitle.textContent = prefill.id ? 'Edit Item' : 'New Item';
  ocrRawSelectable.textContent = rawText || '';
  fieldUniqueId.value = parsed.uniqueId || prefill.uniqueId || '';
  fieldName.value = parsed.name || prefill.name || '';
  fieldPrice.value = parsed.price || prefill.price || '';
  fieldQuantity.value = parsed.quantity || prefill.quantity || '';
  fieldLocation.value = parsed.location || prefill.location || '';
  resultCard.dataset.editId = prefill.id || '';
  hideAllResultCards();
  resultCard.classList.add('visible');
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (!prefill.id && rawText && (parsed.uniqueId || parsed.name || parsed.price)) {
    const isCorrect = askIfRecordIsCorrect(parsed);
    if (!isCorrect) {
      toast('Review the scanned data and update the fields as needed.', 'info');
    }
  }
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

    const base64 = await blobToBase64(blob);

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

// FileReader's native base64 encoding is far faster than a manual
// char-by-char loop, which noticeably lags on multi-megabyte photos.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
              { text: 'Describe ONLY theitem that is the main subject of this photo — its visual appearance for the purpose of matching it against photos of other similar items: shape, color palette, pattern, texture, and any distinctive marks. Do not mention the background, surface, hand, or anything else the item is resting on or being held by — describe the item as if it were isolated on its own. Be specific and consistent.' }
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

function buildSquarePOSUrl(record) {
  const { squareAppId } = getSettings();
  if (!squareAppId) throw new Error('No Square Application ID configured (Settings)');

  const amount = Math.round(parseFloat(record.price) * 100);
  if (isNaN(amount) || amount <= 0) throw new Error('Invalid price');

  const platform = detectMobilePlatform();
  const callbackUrl = window.location.href;

  if (platform === 'ios') {
    const payload = {
      amount_money: { amount: String(amount), currency_code: 'USD' },
      callback_url: callbackUrl,
      client_id: squareAppId,
      version: '1.3',
      notes: record.name || '',
      options: { supported_tender_types: ['CREDIT_CARD', 'CASH', 'OTHER'] }
    };
    return 'square-commerce-v1://payment/create?data=' + encodeURIComponent(JSON.stringify(payload));
  } else if (platform === 'android') {
    const extras = [
      `S.browser_fallback_url=${encodeURIComponent(callbackUrl)}`,
      `S.com.squareup.pos.WEB_CALLBACK_URI=${encodeURIComponent(callbackUrl)}`,
      `S.com.squareup.pos.CLIENT_ID=${encodeURIComponent(squareAppId)}`,
      'S.com.squareup.pos.API_VERSION=v2.0',
      `i.com.squareup.pos.TOTAL_AMOUNT=${amount}`,
      'S.com.squareup.pos.CURRENCY_CODE=USD',
      'S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD,com.squareup.pos.TENDER_CASH',
      record.name ? `S.com.squareup.pos.NOTE=${encodeURIComponent(record.name)}` : null
    ].filter(Boolean).join(';');
    return `intent:#Intent;action=com.squareup.pos.action.CHARGE;package=com.squareup;${extras};end`;
  } else {
    throw new Error('Square POS launch only works on an iPhone or Android phone with the Square Point of Sale app installed');
  }
}

function launchSquarePOS(record) {
  window.location.href = buildSquarePOSUrl(record);
}

function buildVenmoLink(record) {
  const { venmoUsername } = getSettings();
  if (!venmoUsername) throw new Error('No Venmo username configured (Settings)');

  const amount = parseFloat(record.price);
  if (isNaN(amount) || amount <= 0) throw new Error('Invalid price');

  const params = new URLSearchParams({ txn: 'pay', amount: amount.toFixed(2) });
  if (record.name) params.set('note', record.name);
  return `https://venmo.com/${encodeURIComponent(venmoUsername)}?${params.toString()}`;
}

// --- No-match card actions ---
btnNewItem.addEventListener('click', () => {
  showNewItemForm(lastRawText);
});

const btnManualEntry = document.getElementById('btn-manual-entry');
btnManualEntry.addEventListener('click', () => {
  showNewItemForm('');
});

btnDiscardScan.addEventListener('click', resetScanArea);

// --- Match card actions ---
btnEditMatch.addEventListener('click', () => {
  showNewItemForm(lastRawText, matchedRecord);
});

function sellOne() {
  if (!matchedRecord) return;
  const newQty = Math.max(0, (parseInt(matchedRecord.quantity, 10) || 0) - 1);
  updateRecord(matchedRecord.id, { quantity: String(newQty) });
  matchedRecord = { ...matchedRecord, quantity: String(newQty) };
  document.getElementById('match-quantity').textContent = String(newQty);
  renderRecords();
  toast(`Sold — ${newQty} left`, 'success');

  const { squareAppId } = getSettings();
  if (squareAppId) {
    try {
      launchSquarePOS(matchedRecord);
    } catch (err) {
      toast('Square POS error: ' + err.message, 'error');
    }
  }
}

btnSellOne.addEventListener('click', sellOne);
document.getElementById('match-quantity').addEventListener('click', sellOne);

btnSquareMatch.addEventListener('click', () => {
  if (!matchedRecord) return;
  try {
    launchSquarePOS(matchedRecord);
  } catch (err) {
    toast('Square POS error: ' + err.message, 'error');
  }
});

btnVenmoMatch.addEventListener('click', async () => {
  if (!matchedRecord) return;
  try {
    const link = buildVenmoLink(matchedRecord);
    const dataUrl = await QRCode.toDataURL(link);
    venmoQr.src = dataUrl;
    venmoQr.classList.remove('hidden');
    venmoQr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    toast('Venmo error: ' + err.message, 'error');
  }
});

btnNotAMatch.addEventListener('click', () => {
  matchedRecord = null;
  showNewItemForm(lastRawText);
});

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
  if (!editId) {
    const isCorrect = askIfRecordIsCorrect(data);
    if (!isCorrect) {
      toast('Update the record before saving.', 'info');
      return;
    }
  }

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

function viewRecord(id) {
  const record = getRecords().find(r => r.id === id);
  if (!record) return;
  hideAllResultCards();
  lastRawText = '';
  showMatchCard(record, 'saved');
}

recordsList.addEventListener('click', async e => {
  const btn = e.target.closest('.record-btn');
  const item = e.target.closest('.record-item');
  if (!item) return;
  const id = Number(item.dataset.id);

  if (btn?.classList.contains('delete')) {
    deleteRecord(id);
    renderRecords();
    return;
  }

  if (btn?.classList.contains('push-stripe')) {
    const record = getRecords().find(r => r.id === id);
    if (!record) return;
    btn.disabled = true;
    btn.textContent = '...';
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
      btn.disabled = false;
      btn.textContent = '→ Stripe';
    }
    return;
  }

  if (!btn) {
    viewRecord(id);
  }
});

// --- Cart (multi-item sale, no inventory change until Complete Sale) ---
function cartAvailableFor(id) {
  const record = getRecords().find(r => r.id === id);
  if (!record || record.quantity === undefined || record.quantity === '') return null;
  return parseInt(record.quantity, 10);
}

function addToCart(record) {
  if (!record.price) { toast('Item has no price', 'error'); return; }
  const existing = cart.find(i => i.id === record.id);
  const available = cartAvailableFor(record.id);
  const currentInCart = existing ? existing.quantity : 0;
  if (available !== null && currentInCart + 1 > available) {
    toast('No more in stock', 'error');
    return;
  }
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ id: record.id, name: record.name, price: record.price, quantity: 1 });
  }
  renderCart();
  toast('Added to cart', 'success');
}

function cartToRecord() {
  const total = cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
  const note = cart.map(item => `${item.quantity}x ${item.name}`).join(', ');
  return { price: total.toFixed(2), name: note };
}

function renderCart() {
  const totalItemCount = cart.reduce((n, i) => n + i.quantity, 0);

  if (!cart.length) {
    reviewSaleBar.classList.add('hidden');
    reviewCartList.innerHTML = '';
    reviewTotalDisplay.textContent = '';
    return;
  }

  const totalPrice = cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);

  reviewSaleBar.classList.remove('hidden');
  reviewSaleSummary.textContent = `${totalItemCount} item${totalItemCount === 1 ? '' : 's'} · $${totalPrice.toFixed(2)}`;

  reviewCartList.innerHTML = cart.map(item => `
    <div class="record-item" data-id="${item.id}">
      <div class="record-info">
        <div class="record-name">${esc(item.name || '(no name)')}</div>
        <div class="record-meta">$${esc(item.price)} each</div>
      </div>
      <div class="record-price">$${(parseFloat(item.price) * item.quantity).toFixed(2)}</div>
      <div class="record-actions">
        <button class="record-btn cart-qty-minus" data-id="${item.id}">−</button>
        <span style="min-width:1.4rem;text-align:center;display:inline-block;">${item.quantity}</span>
        <button class="record-btn cart-qty-plus" data-id="${item.id}">+</button>
        <button class="record-btn delete cart-remove" data-id="${item.id}" title="Remove">✕</button>
      </div>
    </div>
  `).join('');

  reviewTotalDisplay.textContent = `Total: $${totalPrice.toFixed(2)}`;
}

reviewCartList.addEventListener('click', e => {
  const btn = e.target.closest('.record-btn');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const item = cart.find(i => i.id === id);
  if (!item) return;

  if (btn.classList.contains('cart-qty-plus')) {
    const available = cartAvailableFor(id);
    if (available !== null && item.quantity + 1 > available) { toast('No more in stock', 'error'); return; }
    item.quantity += 1;
  } else if (btn.classList.contains('cart-qty-minus')) {
    item.quantity -= 1;
    if (item.quantity <= 0) cart = cart.filter(i => i.id !== id);
  } else if (btn.classList.contains('cart-remove')) {
    cart = cart.filter(i => i.id !== id);
  }
  renderCart();
});

btnAddToCart.addEventListener('click', () => {
  if (!matchedRecord) return;
  addToCart(matchedRecord);
});

function completeSale() {
  cart.forEach(item => {
    const record = getRecords().find(r => r.id === item.id);
    if (!record) return;
    const currentQty = parseInt(record.quantity, 10) || 0;
    updateRecord(item.id, { quantity: String(Math.max(0, currentQty - item.quantity)) });
  });
  cart = [];
  renderCart();
  renderRecords();
  toast('Sale complete!', 'success');
}

let terminalPollTimer = null;

function stopTerminalPolling() {
  if (terminalPollTimer) {
    clearTimeout(terminalPollTimer);
    terminalPollTimer = null;
  }
}

function setTerminalStatus(msg) {
  terminalStatus.textContent = msg;
  terminalStatus.classList.remove('hidden');
}

function clearTerminalStatus() {
  terminalStatus.classList.add('hidden');
  terminalStatus.textContent = '';
}

function closeReviewModal() {
  reviewModal.classList.add('hidden');
  stopTerminalPolling();
  clearTerminalStatus();
  btnReviewTerminal.disabled = false;
}
function openReviewModal() { reviewModal.classList.remove('hidden'); }

function closeVenmoModal() {
  venmoModal.classList.add('hidden');
  venmoModalQr.removeAttribute('src');
}

reviewSaleBar.addEventListener('click', openReviewModal);
btnReviewModalClose.addEventListener('click', closeReviewModal);

// Polls every 2s for up to 45 attempts (~90s ceiling) until the checkout is
// COMPLETED (finish the sale), CANCELED (report it), or we give up gracefully.
async function pollTerminalCheckout(checkoutId, attemptsLeft) {
  if (attemptsLeft <= 0) {
    setTerminalStatus('Still waiting — check the Terminal or try again.');
    btnReviewTerminal.disabled = false;
    return;
  }
  try {
    const res = await fetch(`/api/terminal-checkout/${checkoutId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Status check failed');

    if (data.status === 'COMPLETED') {
      clearTerminalStatus();
      btnReviewTerminal.disabled = false;
      closeReviewModal();
      completeSale();
      return;
    }
    if (data.status === 'CANCELED') {
      clearTerminalStatus();
      btnReviewTerminal.disabled = false;
      toast('Terminal checkout canceled', 'error');
      return;
    }

    setTerminalStatus(`Waiting for card... (${data.status})`);
    terminalPollTimer = setTimeout(() => pollTerminalCheckout(checkoutId, attemptsLeft - 1), 2000);
  } catch (err) {
    clearTerminalStatus();
    btnReviewTerminal.disabled = false;
    toast('Terminal status error: ' + err.message, 'error');
  }
}

btnReviewTerminal.addEventListener('click', async () => {
  if (!cart.length) return;
  const { squareDeviceId } = getSettings();
  if (!squareDeviceId) {
    toast('No Square Device ID configured (Settings)', 'error');
    return;
  }
  btnReviewTerminal.disabled = true;
  setTerminalStatus('Sending to Terminal...');
  try {
    const res = await fetch('/api/terminal-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(item => ({ name: item.name, price: item.price, quantity: item.quantity })),
        deviceId: squareDeviceId
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Terminal checkout failed');
    setTerminalStatus(`Waiting for card... (${data.status})`);
    pollTerminalCheckout(data.checkoutId, 45);
  } catch (err) {
    clearTerminalStatus();
    btnReviewTerminal.disabled = false;
    toast('Terminal error: ' + err.message, 'error');
  }
});

btnReviewVenmo.addEventListener('click', async () => {
  if (!cart.length) return;
  try {
    const link = buildVenmoLink(cartToRecord());
    const dataUrl = await QRCode.toDataURL(link);
    closeReviewModal();
    venmoModalTotal.textContent = reviewSaleSummary.textContent;
    venmoModalQr.src = dataUrl;
    venmoModal.classList.remove('hidden');
  } catch (err) {
    toast('Venmo error: ' + err.message, 'error');
  }
});

btnReviewSquare.addEventListener('click', () => {
  if (!cart.length) return;
  try {
    closeReviewModal();
    launchSquarePOS(cartToRecord());
  } catch (err) {
    toast('Square POS error: ' + err.message, 'error');
  }
});

btnReviewComplete.addEventListener('click', () => {
  if (!cart.length) return;
  closeReviewModal();
  completeSale();
});

btnReviewClear.addEventListener('click', () => {
  cart = [];
  renderCart();
  closeReviewModal();
});

btnVenmoModalClose.addEventListener('click', () => {
  closeVenmoModal();
  cart = [];
  renderCart();
  toast('Order canceled', 'error');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

btnVenmoModalEdit.addEventListener('click', () => {
  closeVenmoModal();
  openReviewModal();
});

btnVenmoModalSuccess.addEventListener('click', () => {
  closeVenmoModal();
  completeSale();
});

// --- Event listeners ---
btnCamera.addEventListener('click', () => {
  if (cameraActive) stopCamera();
  else startCamera();
});

btnCapture.addEventListener('click', captureFrame);
btnUpload.addEventListener('click', () => fileInput.click());
btnExport.addEventListener('click', () => { exportCSV(); toast('CSV downloaded', 'success'); });

// --- Test data seeding (local dev only) ---
const isLocalEnv = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (isLocalEnv) {
  btnSeedTest.style.display = '';
}

btnSeedTest.addEventListener('click', () => {
  const sampleRecords = [
    { uniqueId: '', name: 'Kitty Button', price: '8.00', quantity: '5', location: 'Bin A' },
    { uniqueId: '', name: 'Star Button', price: '6.50', quantity: '3', location: 'Bin A' },
    { uniqueId: '', name: 'Floral Button', price: '10.00', quantity: '2', location: 'Bin B' }
  ];
  sampleRecords.forEach(saveRecord);
  renderRecords();
  toast('Seeded 3 test records', 'success');
});

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
