import { getRecords, getCachedRecords, saveRecord, updateRecord, deleteRecord, exportCSV, getSettings, getClientId, getLocationCode, findByUniqueId, findByVisualMatch, createSale, getSales } from './storage.js';
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';

// --- State ---
let stream = null;
let capturedBlob = null;
let cameraActive = false;
let matchedRecord = null;
let cart = []; // { id, name, price, quantity, subVendor } — quantity here is units being sold, not inventory

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
const fieldItem = document.getElementById('field-item');
const fieldBrand = document.getElementById('field-brand');
const fieldSize = document.getElementById('field-size');
const fieldColor = document.getElementById('field-color');
const fieldTagColor = document.getElementById('field-tag-color');
const fieldSubVendor = document.getElementById('field-sub-vendor');
const fieldPrice = document.getElementById('field-price');
const fieldQuantity = document.getElementById('field-quantity');
const fieldLocation = document.getElementById('field-location');
const ocrRaw = document.getElementById('ocr-raw');
const ocrRawLabel = document.getElementById('ocr-raw-label');
const ocrRawSelectable = document.getElementById('ocr-raw-selectable');
const otherFieldsLabel = document.getElementById('other-fields-label');
const otherFieldsDisplay = document.getElementById('other-fields-display');
const matchOtherFields = document.getElementById('match-other-fields');
const recordsList = document.getElementById('records-list');
const scanOverlay = document.querySelector('.scan-overlay');
const btnScanModeOcr = document.getElementById('btn-scan-mode-ocr');
const btnScanModeImage = document.getElementById('btn-scan-mode-image');
const btnScanModeBarcode = document.getElementById('btn-scan-mode-barcode');
let scanMode = 'ocr';

// Native BarcodeDetector only exists on Chrome/Android today - iOS Safari
// ships it disabled. Rather than gate the Barcode button on that (which
// would hide it entirely on iPhone/iPad), it's always shown; the
// detection loop below picks native when available and falls back to the
// ZXing-js library (lazy-loaded, see getZxingReader) everywhere else.
btnScanModeBarcode.classList.remove('hidden');

function setScanMode(mode) {
  const previousMode = scanMode;
  scanMode = mode;
  btnScanModeOcr.classList.toggle('active', mode === 'ocr');
  btnScanModeImage.classList.toggle('active', mode === 'image');
  btnScanModeBarcode.classList.toggle('active', mode === 'barcode');
  if (!cameraActive) return;

  // Barcode mode asks for a different camera resolution than OCR/Image
  // do (see startCamera) - that only takes effect when the stream is
  // actually (re)started, so switching to/from Barcode mode while the
  // camera is already running has to restart the stream, or it keeps
  // whatever resolution was already active. That mismatch is exactly
  // what caused a canvas size error on iPad (ZXing expecting the
  // barcode-mode resolution while the stream was still at OCR's).
  const switchingBarcodeTier = (previousMode === 'barcode') !== (mode === 'barcode');
  if (switchingBarcodeTier) {
    stopCamera();
    startCamera();
  } else if (mode === 'barcode') {
    startBarcodeLoop();
  } else {
    stopBarcodeLoop();
  }
}
btnScanModeOcr.addEventListener('click', () => setScanMode('ocr'));
btnScanModeImage.addEventListener('click', () => setScanMode('image'));
btnScanModeBarcode.addEventListener('click', () => setScanMode('barcode'));
const scanPlaceholder = document.querySelector('.scan-placeholder');

// --- Buttons ---
const btnCamera = document.getElementById('btn-camera');
const btnCameraIcon = document.getElementById('btn-camera-icon');
const btnCameraLabel = document.getElementById('btn-camera-label');
const CAMERA_ICON = '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>';
const CAPTURE_ICON = '<circle cx="12" cy="12" r="9"/>';
const btnUpload = document.getElementById('btn-upload');
const btnNewItem = document.getElementById('btn-new-item');
const btnDiscardScan = document.getElementById('btn-discard-scan');
const btnEditMatch = document.getElementById('btn-edit-match');
const btnSellOne = document.getElementById('btn-sell-one');
const btnSquareMatch = document.getElementById('btn-square-match');
const btnVenmoMatch = document.getElementById('btn-venmo-match');
const btnPrintSticker = document.getElementById('btn-print-sticker');
const venmoQr = document.getElementById('venmo-qr');
const stickerQr = document.getElementById('sticker-qr');
const stickerQrHint = document.getElementById('sticker-qr-hint');
btnPrintSticker.classList.remove('hidden');
const btnAddToCart = document.getElementById('btn-add-to-cart');
const reviewSaleBar = document.getElementById('review-sale-bar');
const reviewSaleSummary = document.getElementById('review-sale-summary');
const reviewModal = document.getElementById('review-modal');
const btnReviewModalClose = document.getElementById('btn-review-modal-close');
const reviewCartList = document.getElementById('review-cart-list');
const reviewTotalDisplay = document.getElementById('review-total-display');
const btnReviewTerminal = document.getElementById('btn-review-terminal');
const pendingSalesBar = document.getElementById('pending-sales-bar');
const btnOpenQueue = document.getElementById('btn-open-queue');
const queueBadge = document.getElementById('queue-badge');
const queueModal = document.getElementById('queue-modal');
const btnQueueModalClose = document.getElementById('btn-queue-modal-close');
const queueModalList = document.getElementById('queue-modal-list');
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
const btnSquare = document.getElementById('btn-square');
const btnDiscard = document.getElementById('btn-discard');
const btnExport = document.getElementById('btn-export');
const btnSeedTest = document.getElementById('btn-seed-test');
const fileInput = document.getElementById('file-input');

// --- Camera ---
async function startCamera() {
  try {
    // Barcode mode asks for a higher-resolution feed than OCR/Image do -
    // a barcode's narrow bars need real pixel density to resolve
    // correctly. 720p is a middle ground: more detail than OCR/Image
    // mode's 1024x960, but noticeably lighter than 1920x1080 for
    // decode() to scan every ~300ms (each attempt is a synchronous,
    // CPU-heavy pass with TRY_HARDER enabled - fewer pixels means less
    // main-thread blocking, which is what reads as UI lag/stutter during
    // scanning).
    //
    // "ideal" constraints kept landing on an odd height (961, 721 - one
    // pixel over what was asked) on the iPad this was tested on,
    // suggesting the camera was synthesizing a non-native size via
    // internal cropping/scaling rather than using a real native mode -
    // exactly the kind of operation prone to off-by-one results, and
    // that odd dimension correlates with ZXing's getImageData calls
    // failing. "exact" forces a real supported mode instead of letting
    // the browser round toward something synthesized; if the device
    // can't do exactly 1280x720, this throws OverconstrainedError and
    // falls back to the old "ideal" request rather than failing outright.
    let videoConstraints = scanMode === 'barcode'
      ? { facingMode: { ideal: 'environment' }, width: { exact: 1280 }, height: { exact: 720 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1024 }, height: { ideal: 960 } };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
    } catch (exactErr) {
      if (scanMode !== 'barcode') throw exactErr;
      console.warn('Exact 1280x720 not supported, falling back to ideal:', exactErr);
      videoConstraints = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
    }
    video.srcObject = stream;
    video.classList.remove('hidden');
    previewImg.classList.add('hidden');
    scanOverlay.style.display = 'flex';
    scanPlaceholder.style.display = 'none';
    btnCameraIcon.innerHTML = CAPTURE_ICON;
    btnCameraIcon.setAttribute('fill', 'currentColor');
    btnCameraLabel.textContent = 'Capture';
    cameraActive = true;
    if (scanMode === 'barcode') startBarcodeLoop();
  } catch (err) {
    toast('Camera access denied', 'error');
  }
}

function stopCamera() {
  stopBarcodeLoop();
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  video.classList.add('hidden');
  scanOverlay.style.display = 'none';
  scanPlaceholder.style.display = 'flex';
  btnCameraIcon.innerHTML = CAMERA_ICON;
  btnCameraIcon.setAttribute('fill', 'none');
  btnCameraLabel.textContent = 'Camera';
  cameraActive = false;
}

// Shared by the manual Capture tap (OCR/Image modes) and barcode auto-
// detect (below) - grabs the current video frame as a still, shows it as
// the frozen preview, and hands the blob to whichever processor is next.
function finishSnapshot(blob, onBlob) {
  capturedBlob = blob;
  const url = URL.createObjectURL(blob);
  previewImg.src = url;
  previewImg.classList.remove('hidden');
  video.classList.add('hidden');
  scanOverlay.style.display = 'none';
  onBlob(blob);
}

function snapshotVideoFrame(onBlob) {
  if (!video.videoWidth || !video.videoHeight) {
    console.warn('snapshotVideoFrame: video has no dimensions yet, nothing to capture');
    toast('Camera not ready yet - try again in a moment', 'error');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  // toBlob() is known to silently call back with null on some Safari/iOS
  // versions instead of throwing anything catchable - toDataURL() is the
  // older, more universally reliable API, so it's the fallback here
  // rather than just failing outright when that happens.
  canvas.toBlob(blob => {
    if (blob) {
      finishSnapshot(blob, onBlob);
      return;
    }
    console.warn('canvas.toBlob returned null - falling back to toDataURL');
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const [, base64] = dataUrl.split(',');
      const bytes = atob(base64);
      const buffer = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
      finishSnapshot(new Blob([buffer], { type: 'image/jpeg' }), onBlob);
    } catch (err) {
      console.warn('toDataURL fallback also failed:', err);
      toast('Could not capture the camera frame - try again', 'error');
    }
  }, 'image/jpeg', 0.92);
}

function captureFrame() {
  snapshotVideoFrame(blob => {
    stopCamera();
    processImage(blob);
  });
}

// --- Barcode scanning ---
// Runs continuously against the live preview instead of waiting for a
// manual Capture tap, since a barcode is meant to be read the instant
// it's in frame - matching how the rest of the queue/terminal work in
// this app favors fast, low-friction flows over extra taps.
//
// Two engines, picked automatically:
// - Native BarcodeDetector - fast, built into the browser, but only
//   Chrome/Android ships it enabled today.
// - ZXing-js (lazy-loaded from a CDN, only when actually needed) - pure
//   JS, works everywhere including Safari/iOS, so this is what covers
//   iPhone/iPad. Slower per-frame than the native API, which is fine
//   here since it's still just scanning a live preview, not blocking
//   anything.
let barcodeDetector = null;
let barcodeLoopHandle = null;
let zxingReader = null;

// The on-screen guide (.scan-frame, see style.css) only covers 80% width
// / 60% height of the preview, centered - decoding the full video frame
// means the barcode is a much smaller fraction of the analyzed image
// than what the user actually sees and aims at. Cropping to the same
// region effectively zooms in on exactly that area, raising the
// barcode's pixel density without needing real camera zoom.
const BARCODE_SCAN_REGION = { widthRatio: 0.8, heightRatio: 0.6 };

function getBarcodeScanRegionCanvas() {
  if (!video.videoWidth || !video.videoHeight) return null;
  const sw = video.videoWidth * BARCODE_SCAN_REGION.widthRatio;
  const sh = video.videoHeight * BARCODE_SCAN_REGION.heightRatio;
  const sx = (video.videoWidth - sw) / 2;
  const sy = (video.videoHeight - sh) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function onBarcodeDetected(rawValue) {
  stopBarcodeLoop();
  snapshotVideoFrame(blob => {
    stopCamera();
    // Belt-and-braces: processBarcodeValue already guards its own lookup,
    // but if anything else unexpected throws, this still guarantees the
    // UI recovers to a visible error instead of being stuck on the
    // captured frame with no result card and no feedback at all.
    processBarcodeValue(rawValue, blob).catch(err => {
      console.warn('Barcode scan failed:', err);
      toast('Barcode scan error: ' + err.message, 'error');
      hideStatus();
      resetScanArea();
    });
  });
}

function startNativeBarcodeLoop() {
  if (!barcodeDetector) barcodeDetector = new BarcodeDetector();
  barcodeLoopHandle = setInterval(async () => {
    if (!cameraActive || video.readyState < 2) return;
    const region = getBarcodeScanRegionCanvas();
    if (!region) return;
    let results;
    try {
      results = await barcodeDetector.detect(region);
    } catch (err) {
      console.warn('Barcode detect failed:', err);
      return;
    }
    if (results.length) onBarcodeDetected(results[0].rawValue);
  }, 300);
}

async function getZxingReader() {
  if (!zxingReader) {
    const { BrowserMultiFormatReader, DecodeHintType } = await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm');
    // Default decode() is tuned for speed over thoroughness - fine for a
    // clean, flat, well-lit barcode, but a phone/tablet camera frame
    // (motion blur, slight angle, uneven lighting) needs the more
    // exhaustive TRY_HARDER pass to actually find the code, confirmed
    // on-device: without this, decode() reliably threw NotFoundException
    // on every single attempt even with a real barcode held steady in frame.
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    zxingReader = new BrowserMultiFormatReader(hints);
  }
  return zxingReader;
}

async function startZxingBarcodeLoop() {
  let reader;
  try {
    reader = await getZxingReader();
  } catch (err) {
    console.warn('Failed to load barcode scanning library:', err);
    toast('Could not load barcode scanner', 'error');
    return;
  }
  if (!cameraActive) return; // camera was stopped while the library was loading

  // Drives reader.decode() directly on our own timer, rather than any of
  // ZXing's decodeFromVideo*() helpers - those wait for the video
  // element's "playing" event before they'll start, which never fires
  // again on a video that's already playing (ours always is, since
  // startCamera already has it running by the time this attaches), so
  // they deadlock forever and never attempt a single decode. decode()
  // is the low-level primitive instead: one decode attempt against
  // whatever frame is current right now, no lifecycle waiting. Finding
  // an actual barcode can take a few tries, same as any barcode
  // scanner - that's normal, not a bug.
  barcodeLoopHandle = setInterval(() => {
    if (!cameraActive || video.readyState < 2) return;
    let result;
    try {
      result = reader.decode(video);
    } catch (err) {
      return; // no barcode found in this frame - expected on almost every tick
    }
    if (result) onBarcodeDetected(result.getText());
  }, 300);
}

function startBarcodeLoop() {
  stopBarcodeLoop();
  if ('BarcodeDetector' in window) {
    startNativeBarcodeLoop();
  } else {
    startZxingBarcodeLoop();
  }
}

function stopBarcodeLoop() {
  if (barcodeLoopHandle) {
    clearInterval(barcodeLoopHandle);
    barcodeLoopHandle = null;
  }
  // ZXing caches its internal capture canvas (reader.captureCanvas) and
  // only ever creates it once - it never resizes it for a later camera
  // session with different actual video dimensions (common, since
  // getUserMedia's "ideal" constraints aren't guaranteed to produce the
  // same resolution every time). Without resetting, decode() keeps
  // drawing into a stale, wrong-sized canvas on the next scan and
  // getImageData starts failing persistently - confirmed on-device:
  // this is exactly why it worked once, then never again. reset() is
  // safe to call even if a native BarcodeDetector was used instead -
  // zxingReader is null until ZXing is actually loaded.
  zxingReader?.reset();
}

// A decoded barcode is a definitive ID, so it's checked against existing
// records first with no OCR involved. On a miss, though, a barcode alone
// only gives an ID - it can't tell us the price, brand, or anything else
// printed on the tag. So OCR still runs on that same frame to fill in
// everything else for the New Item form, with the decoded barcode value
// always overriding whatever OCR guesses for the ID - a successful
// decode is far more reliable than OCR's floating-text guess.
async function processBarcodeValue(rawValue, blob) {
  hideAllResultCards();
  showStatus('Looking up barcode...');
  let match = null;
  try {
    match = await findByUniqueId(rawValue);
  } catch (err) {
    console.warn('Barcode lookup failed:', err);
    toast('Could not check inventory: ' + err.message, 'error');
  }
  if (match) {
    hideStatus();
    lastRawText = rawValue;
    lastBarcodeValue = '';
    showMatchCard(match, 'text');
    return;
  }

  showStatus('Running OCR...');
  let rawText = '';
  try {
    rawText = await runOCR(blob);
  } catch (err) {
    console.warn('OCR failed:', err);
  }
  hideStatus();

  lastRawText = rawText;
  lastBarcodeValue = rawValue;
  showNoMatchCard(rawText ? `${rawText}\n\nBarcode: ${rawValue}` : `Barcode: ${rawValue}`, 'barcode');
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
// Set only by processBarcodeValue on a no-match, cleared by every other
// scan/reset path - lets "+ New Item" know to use the decoded barcode as
// the uniqueId instead of whatever OCR guessed from the same frame.
let lastBarcodeValue = '';

async function processImage(blob) {
  hideAllResultCards();
  lastBarcodeValue = '';

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

  const parsedScan = parseTicketTag(rawText) || parseScannedText(rawText);
  const textMatch = parsedScan.uniqueId
    ? await findByUniqueId(parsedScan.uniqueId)
    : rawText.trim()
      ? await findByUniqueId(rawText)
      : null;

  if (textMatch) {
    hideStatus();
    showMatchCard(textMatch, 'text');
    return;
  }

  // OCR mode with no text match: appearance-based matching is a slow
  // fallback (loads a ~50MB on-device CLIP model + a Gemini round-trip),
  // and was firing on every OCR rescan that OCR misread, making rescanning
  // feel slow. Skip it here — explicit Image mode below still uses it,
  // since that mode has no OCR text to match on in the first place.
  if (!skipOcr) {
    hideStatus();
    showNoMatchCard(rawText);
    return;
  }

  showStatus('Checking appearance...');
  const embeddings = await embedImage(blob);
  let visualMatch = null;
  if (embeddings.gemini) visualMatch = await findByVisualMatch(embeddings.gemini, 'gemini');
  if (!visualMatch && embeddings.clip) visualMatch = await findByVisualMatch(embeddings.clip, 'clip');

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

function showNoMatchCard(rawText, source = 'ocr') {
  ocrRawLabel.textContent = source === 'barcode' ? 'Scanned barcode + OCR text' : 'Raw OCR text';
  ocrRaw.textContent = rawText;
  noMatchCard.classList.add('visible');
  noMatchCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showMatchCard(record, matchType = 'text', score = null) {
  matchedRecord = record;
  document.getElementById('match-card-title').textContent = matchType === 'saved' ? 'Item Details' : 'Matched Item';
  document.getElementById('match-uniqueId').textContent = record.uniqueId || '—';
  document.getElementById('match-name').textContent = record.name || '—';
  document.getElementById('match-item').textContent = record.item || '—';
  document.getElementById('match-brand').textContent = record.brand || '—';
  document.getElementById('match-size').textContent = record.size || '—';
  document.getElementById('match-color').textContent = record.color || '—';
  document.getElementById('match-tagColor').textContent = record.tagColor || '—';
  document.getElementById('match-subVendor').textContent = record.subVendor || '—';
  document.getElementById('match-price').textContent = record.price ? `$${record.price}` : '—';
  document.getElementById('match-quantity').textContent = record.quantity || '—';
  document.getElementById('match-location').textContent = record.location || '—';

  const otherEntries = Object.entries(record.otherFields || {});
  if (otherEntries.length) {
    matchOtherFields.style.display = '';
    matchOtherFields.innerHTML = otherEntries
      .map(([k, v]) => `<div class="match-row"><span class="match-label">${esc(k)}</span><span>${esc(v)}</span></div>`)
      .join('');
  } else {
    matchOtherFields.style.display = 'none';
    matchOtherFields.innerHTML = '';
  }

  const badge = document.getElementById('match-badge');
  badge.textContent = matchType === 'visual'
    ? `Matched by appearance (${Math.round(score * 100)}%)`
    : matchType === 'saved'
      ? 'Saved item'
      : 'Matched by tag';

  // "Not a match" only makes sense when this came from a live scan.
  btnNotAMatch.style.display = matchType === 'saved' ? 'none' : '';

  const { requireTerminalOnly } = getSettings();
  const paymentDisplay = requireTerminalOnly ? 'none' : '';
  btnSquareMatch.style.display = paymentDisplay;
  btnVenmoMatch.style.display = paymentDisplay;

  const photo = document.getElementById('match-photo');
  if (record.photoDataUrl) {
    photo.src = record.photoDataUrl;
    photo.classList.remove('hidden');
  } else {
    photo.classList.add('hidden');
  }

  venmoQr.classList.add('hidden');
  venmoQr.removeAttribute('src');
  stickerQr.classList.add('hidden');
  stickerQr.removeAttribute('src');
  stickerQrHint.classList.add('hidden');

  matchCard.classList.add('visible');
  matchCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Consignment-style tags print one labeled field per line. Field labels are
// found generically ("<label>: <value>") rather than hardcoded per exact
// wording, so unfamiliar tag stock still works — recognized labels map onto
// known fields, and anything else is kept in otherFields instead of being
// silently dropped. A label with nothing typed after it is normal (blank
// tag fields), not a parse failure.
//
// "Ticket No" gets special-cased: it's the field used as the item's unique
// ID, and on the tags this was built against it's followed by a period, not
// a colon ("Ticket No. 12345") - the generic colon-based rule below would
// never find it.
const TICKET_NO_RE = /^ticket\s*(no|number|#)\.?\s*[:#]?\s*(.*)$/i;

// Different tag stock spells the same field differently ("Price" vs "Sale
// Price", "Brand" vs "MFG") - add synonyms here as new wordings show up
// rather than hardcoding a one-off rule per tag style. When more than one
// synonym for the same field appears on one tag (e.g. both "Price" and
// "Sale Price" printed as separate lines), whichever is read later wins -
// there's only one price slot, not a priority order between synonyms.
const KNOWN_FIELD_SYNONYMS = [
  { key: 'name', label: /^name$/i },
  { key: 'item', label: /^item$/i },
  { key: 'brand', label: /^(brand|mfg)$/i },
  { key: 'size', label: /^size$/i },
  { key: 'color', label: /^colou?r$/i },
  { key: 'price', label: /^(sale\s*)?price\s*\$?$/i }
];

// $ has to be allowed in the label itself (e.g. "Price $:"), or a blank
// field right before it would wrongly swallow it as its own value.
const LABEL_LINE_RE = /^([A-Za-z][A-Za-z0-9 /#$]{0,30}?)\s*:\s*(.*)$/;

// A known field's label can also appear alone on its own line with no
// colon at all and its value on the next line ("SALE PRICE" / "MFG" on
// their own line, the actual value typed below) - same shape as the
// Ticket No. special case above, generalized to any known field instead
// of being hand-rolled per label.
function matchBareKnownLabel(line) {
  return KNOWN_FIELD_SYNONYMS.find(f => f.label.test(line.trim()));
}

function isTagLabelLine(line) {
  return LABEL_LINE_RE.test(line) || TICKET_NO_RE.test(line) || !!matchBareKnownLabel(line);
}

// Blank tag fields are often printed as a fill-in line ("Item: _______"),
// and OCR sometimes carries the underscores into the captured value instead
// of dropping them - strip them (and the whitespace they leave behind) so
// an unfilled field reads as empty rather than literal underscores.
function stripBlankFill(value) {
  return value.replace(/_+/g, '').trim();
}

// A lone label word with no colon at all ("Item" by itself, OCR having
// dropped the ":") shouldn't be mistaken for floating ID text.
const BARE_LABEL_WORDS = /^(ticket|no|number|name|item|brand|size|colou?r|price)$/i;

function parseTicketTag(rawText = '') {
  const lines = (rawText || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const fields = { uniqueId: '', name: '', item: '', brand: '', size: '', color: '', price: '' };
  const otherFields = {};
  const consumed = new Set();

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const line = lines[i];
    const nextLine = lines[i + 1];

    const ticketMatch = !fields.uniqueId && line.match(TICKET_NO_RE);
    if (ticketMatch) {
      consumed.add(i);
      let value = ticketMatch[2].trim();
      if (!value && nextLine && !isTagLabelLine(nextLine)) { value = nextLine.trim(); consumed.add(i + 1); }
      // The ID is used to match a re-scanned tag against a saved record, so
      // keep it strictly alphanumeric - no punctuation/spaces/underscores
      // that OCR might read inconsistently between scans of the same tag.
      fields.uniqueId = value.replace(/[^A-Za-z0-9]/g, '');
      continue;
    }

    const bareKnown = !LABEL_LINE_RE.test(line) && matchBareKnownLabel(line);
    if (bareKnown) {
      consumed.add(i);
      let value = '';
      if (nextLine && !isTagLabelLine(nextLine)) { value = nextLine.trim(); consumed.add(i + 1); }
      value = stripBlankFill(value);
      fields[bareKnown.key] = bareKnown.key === 'price'
        ? (value.match(/\d+(?:\.\d{1,2})?/) || [''])[0]
        : value;
      continue;
    }

    const match = line.match(LABEL_LINE_RE);
    if (!match) continue;
    consumed.add(i);

    const label = match[1].trim();
    let value = match[2].trim();
    // Label printed with the value left blank on the same line — OCR
    // sometimes puts a handwritten value on the next line instead. Only
    // borrow it if that next line isn't itself another label.
    if (!value && nextLine && !isTagLabelLine(nextLine)) {
      value = nextLine.trim();
      consumed.add(i + 1);
    }
    value = stripBlankFill(value);

    const known = KNOWN_FIELD_SYNONYMS.find(f => f.label.test(label));
    if (known) {
      fields[known.key] = known.key === 'price'
        ? (value.match(/\d+(?:\.\d{1,2})?/) || [''])[0]
        : value;
    } else if (value) {
      otherFields[label] = value;
    }
  }

  // "Floating" text: a short alphanumeric line with no label attached to it
  // at all - not consumed as a label, a label's value, or a blank-fill
  // placeholder. Some tags print the ticket number again on its own like
  // this; others print a barcode's human-readable number underneath it,
  // which is the same shape (an unlabeled short line) as far as OCR text
  // is concerned. Only ever used to fill in a MISSING Ticket No. - if one
  // was already found via its label, the floating text is ignored either
  // way (whether it agrees or disagrees), since the labeled value is trusted.
  if (!fields.uniqueId) {
    const floatingCandidates = lines.filter((line, i) =>
      !consumed.has(i) &&
      !isTagLabelLine(line) &&
      !BARE_LABEL_WORDS.test(line) &&
      !/^_+$/.test(line) &&
      /^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,13}[A-Za-z0-9])?$/.test(line)
    );
    // Prefer an all-digit candidate (a barcode number or a bare repeated
    // ticket number) over one containing letters (e.g. a stray title/
    // heading that happens to be short enough to match) - digits-only is
    // a much stronger signal of "this is an ID" than just "short and
    // unlabeled". Falls back to the first candidate of any kind otherwise.
    const floatingLine = floatingCandidates.find(line => /^[0-9 -]+$/.test(line)) || floatingCandidates[0];
    if (floatingLine) {
      fields.uniqueId = floatingLine.replace(/[^A-Za-z0-9]/g, '');
    }
  }

  if (!fields.uniqueId) return null;

  return {
    uniqueId: fields.uniqueId,
    name: fields.name,
    item: fields.item,
    brand: fields.brand,
    size: fields.size,
    color: fields.color,
    price: fields.price,
    quantity: '',
    location: '',
    otherFields
  };
}

function parseScannedText(rawText = '') {
  const lines = (rawText || '').replace(/\r\n?/g, '\n').split('\n');
  let price = '';
  let uniqueId = '';
  const descriptionParts = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Prefer an explicit '$'-marked price; if OCR ran everything together
    // on one line with no '$' (no newline to separate name from price
    // either), fall back to a bare decimal token like "12.00" so it still
    // gets pulled out of the name instead of swallowed into it.
    const priceMatch = trimmed.match(/\$\s*\d+(?:\.\d{1,2})?/)
      || trimmed.match(/\b\d+\.\d{2}\b/);
    if (priceMatch && !price) {
      price = priceMatch[0].replace(/\$/g, '').trim();
    }

    // A '#'-prefixed token is an explicit, unambiguous unique-id marker, and
    // the id is always alone on its own line — so grab everything after '#'
    // to the end of the line, letters/digits/spaces alike (OCR sometimes
    // inserts stray gaps, e.g. "# 16 F"; the space-stripping below turns
    // that into "16F"). Checked first so it wins over the generic heuristics
    // below.
    const idMatch = trimmed.match(/#\s*([A-Za-z0-9][A-Za-z0-9 ]*)$/i)
      || trimmed.match(/(?:id|sku|item)[\s:-]*([A-Za-z0-9]{3,})/i)
      || trimmed.match(/\b(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{4,}\b/);
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
      descriptionLine = descriptionLine.replace(new RegExp(`#?\\b${matchedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '').trim();
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
    data.uniqueId ? `Ticket No: ${data.uniqueId}` : null,
    data.name ? `Name: ${data.name}` : null,
    data.item ? `Item: ${data.item}` : null,
    data.brand ? `Brand: ${data.brand}` : null,
    data.size ? `Size: ${data.size}` : null,
    data.color ? `Color: ${data.color}` : null,
    data.price ? `Price: $${data.price}` : null
  ].filter(Boolean).join('\n');

  if (!summary) return true;
  return window.confirm(`Does this record look correct?\n\n${summary}`);
}

// Labels found on the tag that don't map to a known field (e.g.
// "Consignor #: 42") - kept so they aren't silently dropped, shown
// read-only, and carried through to the saved record by collectFormData().
let lastOtherFields = {};

function renderOtherFields(otherFields, labelEl, displayEl) {
  const entries = Object.entries(otherFields || {});
  if (!entries.length) {
    labelEl.style.display = 'none';
    displayEl.style.display = 'none';
    displayEl.textContent = '';
    return;
  }
  labelEl.style.display = '';
  displayEl.style.display = '';
  displayEl.textContent = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
}

function showNewItemForm(rawText, prefill = {}) {
  const parsed = Object.keys(prefill).length ? prefill : (parseTicketTag(rawText) || parseScannedText(rawText));

  resultCardTitle.textContent = prefill.id ? 'Edit Item' : 'New Item';
  ocrRawSelectable.textContent = rawText || '';
  fieldUniqueId.value = parsed.uniqueId || prefill.uniqueId || '';
  fieldName.value = parsed.name || prefill.name || '';
  fieldItem.value = parsed.item || prefill.item || '';
  fieldBrand.value = parsed.brand || prefill.brand || '';
  fieldSize.value = parsed.size || prefill.size || '';
  fieldColor.value = parsed.color || prefill.color || '';
  fieldTagColor.value = prefill.tagColor || '';
  fieldSubVendor.value = prefill.subVendor || '';
  fieldPrice.value = parsed.price || prefill.price || '';
  fieldQuantity.value = parsed.quantity || prefill.quantity || '';
  fieldLocation.value = parsed.location || prefill.location || '';
  lastOtherFields = parsed.otherFields || prefill.otherFields || {};
  renderOtherFields(lastOtherFields, otherFieldsLabel, otherFieldsDisplay);
  resultCard.dataset.editId = prefill.id || '';

  // Fill in the tag color from the just-captured photo so staff can see
  // and correct it before Save, rather than it being silently baked in
  // afterward - only when there's a fresh photo and nothing typed/saved
  // there already (editing an existing record keeps its saved value).
  if (capturedBlob && !fieldTagColor.value) {
    detectTagColor(capturedBlob).then(detected => {
      if (detected && !fieldTagColor.value) fieldTagColor.value = detected;
    }).catch(() => {});
  }
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
  const tGemini = performance.now();
  const geminiResult = await runGeminiOCR(blob);
  if (geminiResult !== null) {
    console.log(`[perf] Gemini OCR: ${Math.round(performance.now() - tGemini)}ms`);
    return geminiResult;
  }
  console.log(`[perf] Gemini OCR unavailable/failed after ${Math.round(performance.now() - tGemini)}ms, falling back to Tesseract`);
  // Surface why Gemini didn't run instead of failing silently, so a bad or
  // missing key, quota limit or model problem is visible on the device.
  if (lastGeminiError) {
    toast(`Gemini OCR failed: ${lastGeminiError} — using Tesseract instead`, 'error', 12000);
  }
  // Fall back to Tesseract.js
  showStatus('Falling back to Tesseract OCR...');
  const tTesseract = performance.now();
  const text = await runTesseractOCR(blob);
  console.log(`[perf] Tesseract OCR: ${Math.round(performance.now() - tTesseract)}ms`);
  return text;
}

// Reason the last Gemini OCR attempt failed, shown to the user by runOCR.
let lastGeminiError = '';

async function runGeminiOCR(blob) {
  showStatus('Extracting text with Gemini...');
  lastGeminiError = '';
  try {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      console.warn('No Gemini API key configured');
      lastGeminiError = 'no Gemini API key saved on this device (add it in Settings)';
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
              text: 'Extract all visible text from this image. Return only the text, line by line. Be accurate with handwriting. Prices are often handwritten with the cents as a small superscript next to or above the dollar amount (e.g. a large "27" with a small "00" beside it) — read these as a decimal price like "$27.00", not as a single whole number like "2700".',
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
      // The error body isn't always JSON (e.g. a proxy or network page), so
      // read it as text and only then try to pull Google's message out.
      const body = await response.text();
      let message = '';
      try { message = JSON.parse(body).error?.message || ''; } catch { /* not JSON */ }
      throw new Error(`HTTP ${response.status}${message ? ` - ${message}` : (response.statusText ? ` ${response.statusText}` : '')}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      // A 200 with no text usually means the response was blocked or empty;
      // report that rather than treating it as a successful blank read.
      const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason;
      if (reason && reason !== 'STOP') {
        lastGeminiError = `no text returned (${reason})`;
        console.warn('Gemini OCR returned no text:', reason);
        return null;
      }
      return '';
    }

    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  } catch (err) {
    console.warn('Gemini OCR failed:', err);
    lastGeminiError = err?.message || String(err);
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

// --- Tag color detection ---
// Identifies which vendor a sale belongs to by the color of the physical
// tag/label (not the item's own color - that's the separate `color`
// field from OCR). Pure pixel-color math on the captured frame, no ML
// model or API call - downsamples the photo, buckets each non-grayscale
// pixel into the nearest named hue, and returns whichever bucket has the
// most votes. Near-white/black/gray pixels (printed text, paper
// highlights/shadows) are excluded since they're not the tag's color.
const TAG_COLOR_PALETTE = [
  { name: 'red', hue: 0 },
  { name: 'orange', hue: 30 },
  { name: 'yellow', hue: 55 },
  { name: 'green', hue: 120 },
  { name: 'teal', hue: 175 },
  { name: 'blue', hue: 220 },
  { name: 'purple', hue: 275 },
  { name: 'pink', hue: 320 }
];

function nearestTagColor(hue) {
  let best = TAG_COLOR_PALETTE[0];
  let bestDist = Infinity;
  for (const candidate of TAG_COLOR_PALETTE) {
    const dist = Math.min(Math.abs(hue - candidate.hue), 360 - Math.abs(hue - candidate.hue));
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  return best.name;
}

async function detectTagColor(blob) {
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      const url = URL.createObjectURL(blob);
      el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
      el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      el.src = url;
    });

    const size = 40;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const votes = new Array(TAG_COLOR_PALETTE.length).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const value = max / 255;
      const saturation = max === 0 ? 0 : (max - min) / max;
      if (saturation < 0.25 || value < 0.2 || value > 0.97) continue;

      let hue;
      if (max === min) hue = 0;
      else if (max === r) hue = 60 * (((g - b) / (max - min)) % 6);
      else if (max === g) hue = 60 * (((b - r) / (max - min)) + 2);
      else hue = 60 * (((r - g) / (max - min)) + 4);
      if (hue < 0) hue += 360;

      const idx = TAG_COLOR_PALETTE.findIndex(c => c.name === nearestTagColor(hue));
      votes[idx]++;
    }

    const total = votes.reduce((sum, v) => sum + v, 0);
    if (total < 10) return ''; // not enough colorful pixels to be confident
    const bestIdx = votes.indexOf(Math.max(...votes));
    return TAG_COLOR_PALETTE[bestIdx].name;
  } catch (err) {
    console.warn('Tag color detection failed:', err);
    return '';
  }
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
  if (lastBarcodeValue) {
    const parsed = parseTicketTag(lastRawText) || parseScannedText(lastRawText) || {};
    showNewItemForm(lastRawText, { ...parsed, uniqueId: lastBarcodeValue });
  } else {
    showNewItemForm(lastRawText);
  }
});

const btnManualEntry = document.getElementById('btn-manual-entry');
btnManualEntry.addEventListener('click', () => {
  lastBarcodeValue = '';
  showNewItemForm('');
});

btnDiscardScan.addEventListener('click', resetScanArea);

// --- Match card actions ---
btnEditMatch.addEventListener('click', () => {
  showNewItemForm(lastRawText, matchedRecord);
});

async function sellOne() {
  if (!matchedRecord) return;
  const newQty = Math.max(0, (parseInt(matchedRecord.quantity, 10) || 0) - 1);
  await updateRecord(matchedRecord.id, { quantity: String(newQty) });
  matchedRecord = { ...matchedRecord, quantity: String(newQty) };
  document.getElementById('match-quantity').textContent = String(newQty);
  await renderRecords();
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

// The sticker encodes the item's uniqueId (not a Venmo-style link) - that's
// exactly what a rescan of the printed sticker later looks up via
// findByUniqueId, same as scanning the item's original tag would. Shown
// directly on the page (not just handed to navigator.share) so long-
// pressing it to save/download works everywhere, regardless of whether
// Print Master (confirmed, on iOS, not to accept incoming shares) or any
// other app registers as a share target - Print Master can then import
// the saved image from Photos using its own editor's image-import option.
btnPrintSticker.addEventListener('click', async () => {
  if (!matchedRecord) return;
  const code = matchedRecord.uniqueId || matchedRecord.id;
  try {
    const dataUrl = await QRCode.toDataURL(code, { width: 400 });
    stickerQr.src = dataUrl;
    stickerQr.classList.remove('hidden');
    stickerQrHint.classList.remove('hidden');
    stickerQr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Best-effort convenience on top of the always-reliable display
    // above - if the browser supports sharing files and some installed
    // app wants to receive it, offer that too, but never block or error
    // out the main flow if this isn't available or gets canceled.
    if (navigator.canShare) {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `sticker-${code}.png`, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: `Sticker - ${matchedRecord.item || matchedRecord.name || code}` }).catch(() => {});
      }
    }
  } catch (err) {
    toast('Print sticker error: ' + err.message, 'error');
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
    uniqueId: fieldUniqueId.value.replace(/\s+/g, ''),
    name: fieldName.value.trim(),
    item: fieldItem.value.trim(),
    brand: fieldBrand.value.trim(),
    size: fieldSize.value.trim(),
    color: fieldColor.value.trim(),
    tagColor: fieldTagColor.value.trim(),
    subVendor: fieldSubVendor.value.trim(),
    price: fieldPrice.value.trim(),
    quantity: fieldQuantity.value.trim(),
    location: fieldLocation.value.trim(),
    otherFields: lastOtherFields
  };
}

// Attaches a reference photo to a new/edited record, captured from
// whatever photo is currently loaded (capturedBlob) - this is the
// "photograph it once when adding to inventory" step for untagged items.
// Tag color is detected and filled into the form earlier, in
// showNewItemForm, so staff can see/correct it before Save - by the time
// this runs, fieldTagColor (already collected into data.tagColor) is
// whatever was actually on screen when Save was clicked.
//
// Appearance embeddings (CLIP/Gemini) are paused for now - not needed for
// the current demo, and every OCR/barcode item already carries a
// reliable uniqueId that's matched first anyway, so the embeddings were
// pure overhead (a Gemini round-trip + loading a 50MB on-device model on
// every save) for a comparison path that was never actually reached. The
// embedding/matching code itself (embedImage, findByVisualMatch, Image
// scan mode) is untouched and still there to re-enable later.
async function attachVisualData(data) {
  if (!capturedBlob) return data;
  showStatus('Processing photo...');
  const photoDataUrl = await resizeImageToDataUrl(capturedBlob).catch(() => null);
  hideStatus();
  return {
    ...data,
    photoDataUrl: photoDataUrl || data.photoDataUrl
  };
}

btnSave.addEventListener('click', async () => {
  const data = await attachVisualData(collectFormData());
  if (!data.name && !data.price) { toast('Add a name or price first', 'error'); return; }

  const editId = resultCard.dataset.editId || null;
  if (!editId) {
    const isCorrect = askIfRecordIsCorrect(data);
    if (!isCorrect) {
      toast('Update the record before saving.', 'info');
      return;
    }
  }

  if (editId) {
    await updateRecord(editId, data);
  } else {
    await saveRecord(data);
  }
  resetScanArea();
  await renderRecords();
  toast('Saved!', 'success');
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
  lastBarcodeValue = '';
  previewImg.classList.add('hidden');
  scanPlaceholder.style.display = 'flex';
}

// --- Records ---
async function renderRecords() {
  const records = await getRecords();
  if (!records.length) {
    recordsList.innerHTML = '<div class="empty-state">No records yet — scan a tag to get started.</div>';
    return;
  }
  recordsList.innerHTML = records.map(r => `
    <div class="record-item" data-id="${r.id}">
      <div class="record-info">
        <div class="record-name">${esc(r.item || r.name || '(no name)')}</div>
        <div class="record-meta">${esc(r.uniqueId || '')}${r.uniqueId ? ' · ' : ''}${r.subVendor ? `${esc(r.subVendor)} · ` : ''}${r.tagColor ? `${esc(r.tagColor)} tag · ` : ''}${r.quantity ? `Qty ${esc(r.quantity)} · ` : ''}${esc(r.location || '')}${r.location ? ' · ' : ''}${new Date(r.createdAt).toLocaleDateString()}</div>
      </div>
      <div class="record-price">$${esc(r.price || '—')}</div>
      <div class="record-actions">
        <button class="record-btn delete" data-id="${r.id}" title="Delete">✕</button>
      </div>
    </div>
  `).join('');
}

function viewRecord(id) {
  const record = getCachedRecords().find(r => r.id === id);
  if (!record) return;
  hideAllResultCards();
  lastRawText = '';
  lastBarcodeValue = '';
  showMatchCard(record, 'saved');
}

recordsList.addEventListener('click', async e => {
  const btn = e.target.closest('.record-btn');
  const item = e.target.closest('.record-item');
  if (!item) return;
  const id = item.dataset.id;

  if (btn?.classList.contains('delete')) {
    await deleteRecord(id);
    await renderRecords();
    return;
  }

  if (!btn) {
    viewRecord(id);
  }
});

// --- Cart (multi-item sale, no inventory change until Complete Sale) ---
function cartAvailableFor(id) {
  const record = getCachedRecords().find(r => r.id === id);
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
    // Prefer the tag's "Item" field (e.g. "Poles") as the display name over
    // "Name" (e.g. "JP", often a person's initials on these tags) - falls
    // back to Name for records/tags that only ever populate that field.
    cart.push({ id: record.id, name: record.item || record.name, price: record.price, quantity: 1, subVendor: record.subVendor || '' });
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
  const id = btn.dataset.id;
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

// Shared by the "current cart" completion path and background terminal
// sales alike, so a sale finishing in the background decrements inventory
// correctly without touching whatever cart is being built right now.
async function decrementInventoryForItems(items) {
  for (const item of items) {
    const record = getCachedRecords().find(r => r.id === item.id);
    if (!record) continue;
    const currentQty = parseInt(record.quantity, 10) || 0;
    await updateRecord(item.id, { quantity: String(Math.max(0, currentQty - item.quantity)) });
  }
  await renderRecords();
}

// The one place every completed-sale path (Cash, Venmo, Square Terminal
// card) funnels through - decrements inventory the same way they always
// did, and now also writes a durable sales record (timestamp, items,
// total, payment method) for the Sales Report. If the network write
// fails, the sale still isn't lost from the customer's perspective
// (inventory already moved) - it just won't show up in the report, which
// is surfaced as a toast rather than blocking the sale.
async function recordSale(items, total, paymentMethod) {
  await decrementInventoryForItems(items);
  try {
    await createSale({ items, total: total.toFixed(2), paymentMethod });
  } catch (err) {
    console.warn('Failed to record sale for reporting:', err);
    toast('Sale completed, but failed to log it for reporting', 'error');
  }
}

async function completeSale(paymentMethod) {
  const total = cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
  await recordSale(cart, total, paymentMethod);
  cart = [];
  renderCart();
  toast('Sale complete!', 'success');
  return total;
}

// Cash sales also sync to Square as a real Payment (source_id: CASH), so
// Square's own Dashboard/reports include cash sales alongside card ones,
// not just this app's local Sales Report (see functions/api/square/
// cash-payment.js). If Square isn't connected for this organization, the
// cash sale still completes locally - Square sync is additive, never a
// requirement to take a cash sale.
async function completeCashSale() {
  const total = await completeSale('cash');

  let paymentId = null;
  try {
    const res = await fetch('/api/square/cash-payment', {
      method: 'POST',
      headers: locationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amount: total.toFixed(2) })
    });
    const data = await res.json();
    if (res.ok) paymentId = data.paymentId;
  } catch (err) {
    console.warn('Square cash-payment sync failed:', err);
  }
  if (!paymentId) return; // Square not connected, or the sync failed - sale is still complete locally.

  if (window.confirm('Print a receipt on the Terminal?')) {
    await printCashReceipt(paymentId);
  }
}

// Printing is decoupled from recording the payment above - it only needs
// a device to send the RECEIPT terminal action to. Rather than making the
// customer wait in line the way a card payment would, this only prints
// when a terminal happens to be free right now; otherwise it says so and
// gives up, since the cash sale itself is already complete either way.
async function printCashReceipt(paymentId) {
  let deviceId = null;
  try {
    const res = await fetch('/api/queue/enqueue', {
      method: 'POST',
      headers: locationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ clientId: getClientId(), cart: [] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not reach the terminal queue');

    if (data.status !== 'assigned') {
      fetch('/api/queue/cancel', {
        method: 'POST',
        headers: locationHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ clientId: getClientId() })
      }).catch(() => {});
      toast('No terminal free right now to print a receipt', 'error');
      return;
    }
    deviceId = data.deviceId;

    const printRes = await fetch('/api/square/cash-receipt', {
      method: 'POST',
      headers: locationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ paymentId, deviceId })
    });
    const printData = await printRes.json();
    if (!printRes.ok) throw new Error(printData.error || 'Failed to print receipt');
    toast('Receipt sent to the terminal', 'success');
  } catch (err) {
    toast('Receipt error: ' + err.message, 'error');
  } finally {
    notifyTerminalFreedClientSide(deviceId);
  }
}

function closeReviewModal() {
  reviewModal.classList.add('hidden');
}
function openReviewModal() {
  const { requireTerminalOnly } = getSettings();
  const display = requireTerminalOnly ? 'none' : '';
  btnReviewVenmo.style.display = display;
  btnReviewSquare.style.display = display;
  btnReviewComplete.style.display = display;
  reviewModal.classList.remove('hidden');
}

function closeVenmoModal() {
  venmoModal.classList.add('hidden');
  venmoModalQr.removeAttribute('src');
}

reviewSaleBar.addEventListener('click', openReviewModal);
btnReviewModalClose.addEventListener('click', closeReviewModal);

// --- Terminal queue ---
// Multiple app instances can share fewer physical Square Terminals: a
// checkout either gets a free terminal immediately, or waits in a shared
// queue (held by the TerminalQueue Durable Object) until one frees up. The
// WebSocket delivers that "assigned" push in real time; see
// terminal-queue-worker/worker.js for the server side.
//
// Each "Charge via Terminal" tap hands the sale off to a background
// tracker (pendingSales) instead of blocking the Review Sale screen - the
// cart is snapshotted at that moment and the screen clears immediately, so
// you can keep scanning items for a different sale while this one waits.
let queueSocket = null;
const pendingSales = new Map();   // saleId -> { items, total, status, queueId, deviceId, checkoutId, attemptsLeft, pollTimer }
const queueIdToSaleId = new Map(); // queueId -> saleId, for routing the WS "assigned" push

// Every active sale at this location, not just this device's own (that's
// `pendingSales` above) - kept in sync via the same WebSocket's "state"
// broadcasts, for the shared Queue view (#queue-modal).
let locationActiveSales = [];

// Every queue/terminal-checkout request needs to say which location it's
// for - X-Location-Code as a header (or ?locationCode= for the WebSocket,
// which can't set custom headers), resolved server-side in
// functions/_shared/location.js. "location" isn't used as the variable
// name here to avoid colliding with the browser's global window.location.
function locationHeaders(extra = {}) {
  return { 'X-Location-Code': getLocationCode(), ...extra };
}

function queueSaleStatusText(sale) {
  switch (sale.status) {
    case 'queued': return 'Waiting in line for a terminal...';
    case 'assigned':
    case 'sending': return 'Sending to Terminal...';
    case 'waiting-for-card': return 'Waiting for card...';
    default: return sale.status || '';
  }
}

function renderQueueBadge() {
  const count = locationActiveSales.length;
  queueBadge.textContent = String(count);
  queueBadge.classList.toggle('hidden', count === 0);
}

function renderQueueModalList() {
  if (!locationActiveSales.length) {
    queueModalList.innerHTML = '<div class="empty-state">No pending sales right now.</div>';
    return;
  }
  const myClientId = getClientId();
  queueModalList.innerHTML = locationActiveSales.map(sale => {
    const items = Array.isArray(sale.cart) ? sale.cart : [];
    const itemsSummary = items.map(item => `${item.quantity}x ${item.name || '(no name)'}`).join(', ');
    return `
    <div class="pending-sale-row${sale.clientId === myClientId ? '' : ' other-device'}">
      <div class="pending-sale-info">
        <span class="pending-sale-total">$${(sale.total || 0).toFixed(2)}</span>
        · <span class="pending-sale-status">${esc(queueSaleStatusText(sale))}</span>
        ${itemsSummary ? `<div class="pending-sale-items">${esc(itemsSummary)}</div>` : ''}
        ${sale.clientId === myClientId ? '' : '<div class="pending-sale-owner">Another device</div>'}
      </div>
    </div>
  `;
  }).join('');
}

async function openQueueModal() {
  queueModal.classList.remove('hidden');
  try {
    const res = await fetch('/api/queue/active-sales', { headers: locationHeaders() });
    const data = await res.json();
    if (res.ok) locationActiveSales = data;
  } catch {
    // Fine - whatever the last WebSocket broadcast had is still shown.
  }
  renderQueueModalList();
  renderQueueBadge();
}

function closeQueueModal() {
  queueModal.classList.add('hidden');
}

btnOpenQueue.addEventListener('click', openQueueModal);
btnQueueModalClose.addEventListener('click', closeQueueModal);

// --- Sales Report ---
const btnSalesReport = document.getElementById('btn-sales-report');
const salesReportModal = document.getElementById('sales-report-modal');
const btnSalesReportModalClose = document.getElementById('btn-sales-report-modal-close');
const salesReportSummary = document.getElementById('sales-report-summary');
const salesReportList = document.getElementById('sales-report-list');
const btnSalesReportExport = document.getElementById('btn-sales-report-export');
const salesReportFilterVendor = document.getElementById('sales-report-filter-vendor');
const salesReportFilterMethod = document.getElementById('sales-report-filter-method');
const salesReportSort = document.getElementById('sales-report-sort');
const btnSalesReportViewSale = document.getElementById('btn-sales-report-view-sale');
const btnSalesReportViewItem = document.getElementById('btn-sales-report-view-item');

// allSales: every sale fetched from the server for this location, unfiltered.
// visibleSales: allSales after the vendor/method filters + sort are
// applied - this is what's actually on screen in "By Sale" view, and what
// CSV export sends in that view, so exporting always matches what you're
// looking at rather than silently exporting everything regardless of the
// filters shown.
let allSales = [];
let visibleSales = [];
let allItems = []; // current inventory, fetched fresh each time the report opens - used by "By Item" view to know what never sold.
let salesReportView = 'sale'; // 'sale' or 'item'
let soldRowsForExport = [];
let unsoldRowsForExport = [];

const PAYMENT_METHOD_LABELS = { cash: 'Cash', venmo: 'Venmo', card: 'Card (Terminal)' };
const NO_SUB_VENDOR = '(no sub-vendor)';

function paymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method;
}

function populateSalesReportVendorFilter(sales) {
  const vendors = new Set();
  for (const sale of sales) {
    for (const item of sale.items) {
      if (item.subVendor) vendors.add(item.subVendor);
    }
  }
  const current = salesReportFilterVendor.value;
  salesReportFilterVendor.innerHTML = '<option value="">All sub-vendors</option>' +
    Array.from(vendors).sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (vendors.has(current)) salesReportFilterVendor.value = current;
}

function applySalesReportFiltersAndSort() {
  const vendor = salesReportFilterVendor.value;
  const method = salesReportFilterMethod.value;
  const sort = salesReportSort.value;

  visibleSales = allSales.filter(sale =>
    (!method || sale.paymentMethod === method) &&
    (!vendor || sale.items.some(item => item.subVendor === vendor))
  );

  visibleSales.sort((a, b) => {
    if (sort === 'date-asc') return new Date(a.createdAt) - new Date(b.createdAt);
    if (sort === 'total-desc') return parseFloat(b.total) - parseFloat(a.total);
    if (sort === 'total-asc') return parseFloat(a.total) - parseFloat(b.total);
    return new Date(b.createdAt) - new Date(a.createdAt); // date-desc, default
  });

  if (salesReportView === 'item') {
    renderItemPerformance(visibleSales, allItems, vendor);
  } else {
    renderSalesReport(visibleSales);
  }
}

// Aggregates every sale's items into total quantity sold + revenue per
// item, then cross-references current inventory to find items that have
// quantity in stock but never appear in any (filtered) sale - i.e. things
// that haven't sold. Matched by item id, which cart items already carry
// forward from the inventory record they came from (see addToCart) and
// which survives into the sale snapshot regardless of later inventory edits.
function renderItemPerformance(sales, items, vendorFilter) {
  const soldById = new Map();
  for (const sale of sales) {
    for (const item of sale.items) {
      const quantity = parseInt(item.quantity, 10) || 0;
      const revenue = (parseFloat(item.price) || 0) * quantity;
      const existing = soldById.get(item.id);
      if (existing) {
        existing.quantity += quantity;
        existing.revenue += revenue;
      } else {
        soldById.set(item.id, { name: item.name || '(no name)', subVendor: item.subVendor || '', quantity, revenue });
      }
    }
  }

  const soldRows = Array.from(soldById.values()).sort((a, b) => b.revenue - a.revenue);
  // Every item currently in stock that's never appeared in a sale -
  // regardless of whether it has a sub-vendor. Items with a sub-vendor
  // still get called out as "return to vendor" in the row itself (that's
  // the consignment-reconciliation case this was originally built for),
  // but items with no sub-vendor (the main vendor's own stock) are no
  // longer excluded - this is meant to be a full "what's sold vs. what's
  // still sitting in inventory" report, not just the consignment subset.
  const unsoldRows = items
    .filter(r => !soldById.has(r.id) && (parseInt(r.quantity, 10) || 0) > 0 && (!vendorFilter || r.subVendor === vendorFilter))
    .map(r => ({ name: r.item || r.name || '(no name)', subVendor: r.subVendor || '', quantity: parseInt(r.quantity, 10) || 0, price: r.price || '' }));

  soldRowsForExport = soldRows;
  unsoldRowsForExport = unsoldRows;

  const totalSoldQty = soldRows.reduce((sum, r) => sum + r.quantity, 0);
  const totalRevenue = soldRows.reduce((sum, r) => sum + r.revenue, 0);
  salesReportSummary.innerHTML = `
    <div class="sales-report-grand-total">${soldRows.length} item${soldRows.length === 1 ? '' : 's'} sold (${totalSoldQty} unit${totalSoldQty === 1 ? '' : 's'}) · $${totalRevenue.toFixed(2)} · ${unsoldRows.length} unsold</div>
  `;

  const soldHtml = soldRows.length
    ? soldRows.map(r => `
      <div class="pending-sale-row">
        <div class="pending-sale-info">
          <span class="pending-sale-total">$${r.revenue.toFixed(2)}</span>
          · <span class="pending-sale-status">${r.quantity} sold</span>
          <div class="pending-sale-items">${esc(r.name)}${r.subVendor ? ` (${esc(r.subVendor)})` : ''}</div>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">No items sold yet.</div>';

  const unsoldHtml = unsoldRows.length
    ? unsoldRows.map(r => `
      <div class="pending-sale-row">
        <div class="pending-sale-info">
          <span class="pending-sale-total">${r.quantity} in stock</span>
          · <span class="pending-sale-status">${r.subVendor ? 'Unsold - return to vendor' : 'Unsold'}</span>
          <div class="pending-sale-items">${esc(r.name)}${r.subVendor ? ` (${esc(r.subVendor)})` : ''}${r.price ? ` · $${esc(r.price)} each` : ''}</div>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">No unsold items - everything currently in stock has sold at least once.</div>';

  salesReportList.innerHTML = `
    <h3 class="sales-report-subheading">Sold</h3>
    ${soldHtml}
    <h3 class="sales-report-subheading">Unsold</h3>
    ${unsoldHtml}
  `;
}

function setSalesReportView(view) {
  salesReportView = view;
  btnSalesReportViewSale.classList.toggle('active', view === 'sale');
  btnSalesReportViewItem.classList.toggle('active', view === 'item');
  salesReportSort.style.display = view === 'item' ? 'none' : '';
  applySalesReportFiltersAndSort();
}

function renderSalesReport(sales) {
  const totalsByMethod = {};
  const totalsByVendor = {};
  let grandTotal = 0;
  for (const sale of sales) {
    grandTotal += parseFloat(sale.total) || 0;
    totalsByMethod[sale.paymentMethod] = (totalsByMethod[sale.paymentMethod] || 0) + (parseFloat(sale.total) || 0);
    for (const item of sale.items) {
      const amount = (parseFloat(item.price) || 0) * (parseInt(item.quantity, 10) || 0);
      const vendorKey = item.subVendor || NO_SUB_VENDOR;
      totalsByVendor[vendorKey] = (totalsByVendor[vendorKey] || 0) + amount;
    }
  }

  const methodBreakdown = Object.entries(totalsByMethod)
    .map(([method, amount]) => `${paymentMethodLabel(method)}: $${amount.toFixed(2)}`)
    .join(' · ');
  const vendorBreakdown = Object.entries(totalsByVendor)
    .sort((a, b) => b[1] - a[1])
    .map(([vendor, amount]) => `${vendor}: $${amount.toFixed(2)}`)
    .join(' · ');
  salesReportSummary.innerHTML = `
    <div class="sales-report-grand-total">${sales.length} sale${sales.length === 1 ? '' : 's'} · $${grandTotal.toFixed(2)}</div>
    ${methodBreakdown ? `<div class="sales-report-breakdown">${esc(methodBreakdown)}</div>` : ''}
    ${vendorBreakdown ? `<div class="sales-report-breakdown">By sub-vendor: ${esc(vendorBreakdown)}</div>` : ''}
  `;

  if (!sales.length) {
    salesReportList.innerHTML = '<div class="empty-state">No sales match these filters.</div>';
    return;
  }

  salesReportList.innerHTML = sales.map(sale => {
    const itemsSummary = sale.items
      .map(item => `${item.quantity}x ${item.name || '(no name)'}${item.subVendor ? ` (${item.subVendor})` : ''}`)
      .join(', ');
    return `
    <div class="pending-sale-row">
      <div class="pending-sale-info">
        <span class="pending-sale-total">$${parseFloat(sale.total).toFixed(2)}</span>
        · <span class="pending-sale-status">${esc(paymentMethodLabel(sale.paymentMethod))}</span>
        · <span class="pending-sale-status">${new Date(sale.createdAt).toLocaleString()}</span>
        ${itemsSummary ? `<div class="pending-sale-items">${esc(itemsSummary)}</div>` : ''}
      </div>
    </div>
  `;
  }).join('');
}

async function openSalesReportModal() {
  salesReportModal.classList.remove('hidden');
  salesReportSummary.textContent = '';
  salesReportList.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    [allSales, allItems] = await Promise.all([getSales(), getRecords()]);
  } catch (err) {
    salesReportList.innerHTML = '<div class="empty-state">Failed to load sales.</div>';
    return;
  }
  populateSalesReportVendorFilter(allSales);
  applySalesReportFiltersAndSort();
}

function closeSalesReportModal() {
  salesReportModal.classList.add('hidden');
}

function exportSalesCSV(sales) {
  const rows = [['Timestamp', 'Items', 'Sub-vendors', 'Total', 'Payment Method']];
  sales.forEach(sale => {
    const itemsSummary = sale.items.map(item => `${item.quantity}x ${item.name || '(no name)'}`).join('; ');
    const subVendors = Array.from(new Set(sale.items.map(item => item.subVendor).filter(Boolean))).join('; ');
    rows.push([
      sale.createdAt || '',
      `"${itemsSummary.replace(/"/g, '""')}"`,
      `"${subVendors.replace(/"/g, '""')}"`,
      sale.total || '',
      paymentMethodLabel(sale.paymentMethod)
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportItemPerformanceCSV(soldRows, unsoldRows) {
  const rows = [['Status', 'Item', 'Sub-vendor', 'Quantity', 'Revenue/Price']];
  soldRows.forEach(r => {
    rows.push(['Sold', `"${r.name.replace(/"/g, '""')}"`, `"${(r.subVendor || '').replace(/"/g, '""')}"`, r.quantity, r.revenue.toFixed(2)]);
  });
  unsoldRows.forEach(r => {
    const status = r.subVendor ? 'Unsold - return to vendor' : 'Unsold';
    rows.push([status, `"${r.name.replace(/"/g, '""')}"`, `"${(r.subVendor || '').replace(/"/g, '""')}"`, r.quantity, r.price || '']);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `item-performance-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

btnSalesReportViewSale.addEventListener('click', () => setSalesReportView('sale'));
btnSalesReportViewItem.addEventListener('click', () => setSalesReportView('item'));

btnSalesReport.addEventListener('click', openSalesReportModal);
btnSalesReportModalClose.addEventListener('click', closeSalesReportModal);
salesReportFilterVendor.addEventListener('change', applySalesReportFiltersAndSort);
salesReportFilterMethod.addEventListener('change', applySalesReportFiltersAndSort);
salesReportSort.addEventListener('change', applySalesReportFiltersAndSort);
btnSalesReportExport.addEventListener('click', () => {
  if (salesReportView === 'item') {
    if (!soldRowsForExport.length && !unsoldRowsForExport.length) { toast('Nothing to export', 'error'); return; }
    exportItemPerformanceCSV(soldRowsForExport, unsoldRowsForExport);
  } else {
    if (!visibleSales.length) { toast('No sales to export', 'error'); return; }
    exportSalesCSV(visibleSales);
  }
  toast('CSV downloaded', 'success');
});

// Client-driven fallback for freeing a terminal: the server-side paths
// (webhook, status-poll) assume Square echoes device_options.device_id back
// in the checkout response/webhook payload - if that's ever wrong for some
// checkout shape, they fail silently (fire-and-forget). The client already
// knows which device it used, so tell the queue directly too, belt-and-braces.
function notifyTerminalFreedClientSide(deviceId) {
  if (!deviceId) return;
  fetch('/api/queue/terminal-freed', {
    method: 'POST',
    headers: locationHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ deviceId })
  }).catch(() => {});
}

function saleStatusText(sale) {
  switch (sale.status) {
    case 'queued': return `Waiting in line for a terminal... (was position ${sale.position})`;
    case 'sending': return 'Sending to Terminal...';
    case 'waiting-for-card': return `Waiting for card... (${sale.cardStatus || 'PENDING'})`;
    case 'stuck': return 'Still waiting — check the Terminal or try again.';
    default: return '';
  }
}

function renderPendingSales() {
  if (!pendingSales.size) {
    pendingSalesBar.classList.add('hidden');
    pendingSalesBar.innerHTML = '';
    return;
  }
  pendingSalesBar.classList.remove('hidden');
  pendingSalesBar.innerHTML = Array.from(pendingSales.entries()).map(([saleId, sale]) => `
    <div class="pending-sale-row" data-sale-id="${saleId}">
      <div class="pending-sale-info">
        <span class="pending-sale-total">$${sale.total.toFixed(2)}</span>
        · <span class="pending-sale-status">${esc(saleStatusText(sale))}</span>
      </div>
      <button class="pending-sale-edit" data-sale-id="${saleId}">Edit</button>
      <button class="pending-sale-cancel" data-sale-id="${saleId}">Cancel</button>
    </div>
  `).join('');
}

function removePendingSale(saleId) {
  const sale = pendingSales.get(saleId);
  if (sale?.pollTimer) clearTimeout(sale.pollTimer);
  if (sale?.queueId) queueIdToSaleId.delete(sale.queueId);
  pendingSales.delete(saleId);
  renderPendingSales();
  // Best-effort - the shared Queue view's entry for this sale should
  // disappear for everyone, not just locally.
  fetch(`/api/queue/active-sales/${saleId}`, { method: 'DELETE', headers: locationHeaders() }).catch(() => {});
}

// Square's Terminal API has no "update amount" endpoint - canceling and
// resending is the only way to change a sale once it's been sent, full
// stop. This just gets a terminal/queue slot the sale is holding back,
// shared by both plain Cancel and Edit (which immediately starts a new
// one with the same items, so it doesn't feel like starting over).
async function cancelSaleOnSquare(sale) {
  if (sale.status === 'queued') {
    await fetch('/api/queue/cancel', {
      method: 'POST',
      headers: locationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ clientId: getClientId(), queueId: sale.queueId })
    });
  } else if (sale.checkoutId) {
    await fetch(`/api/terminal-checkout/${sale.checkoutId}/cancel`, { method: 'POST', headers: locationHeaders() });
    notifyTerminalFreedClientSide(sale.deviceId);
  }
}

pendingSalesBar.addEventListener('click', async (e) => {
  const cancelBtn = e.target.closest('.pending-sale-cancel');
  const editBtn = e.target.closest('.pending-sale-edit');
  const btn = cancelBtn || editBtn;
  if (!btn) return;
  const saleId = btn.dataset.saleId;
  const sale = pendingSales.get(saleId);
  if (!sale) return;
  btn.disabled = true;
  try {
    await cancelSaleOnSquare(sale);
    if (editBtn) {
      // Put the sale's items straight back into the cart and open Review
      // Sale already filled in, instead of making you re-scan everything -
      // tweak price/quantity, then "Charge via Terminal" sends it as a
      // fresh checkout (the only option Square's API allows).
      cart = sale.items.map(item => ({ ...item }));
      renderCart();
      openReviewModal();
      toast('Adjust the sale, then charge again', 'success');
    } else {
      toast(sale.status === 'queued' ? 'Left the terminal queue' : 'Terminal checkout canceled', 'success');
    }
  } catch (err) {
    toast('Cancel failed: ' + err.message, 'error');
  } finally {
    removePendingSale(saleId);
  }
});

function checkMissedAssignments() {
  for (const queueId of Array.from(queueIdToSaleId.keys())) {
    fetch(`/api/queue/assignment-status?queueId=${encodeURIComponent(queueId)}`, { headers: locationHeaders() })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data || !data.assigned) return;
        const saleId = queueIdToSaleId.get(queueId);
        if (!saleId) return;
        queueIdToSaleId.delete(queueId);
        sendCheckoutForSale(saleId, data.deviceId);
      })
      .catch(() => {});
  }
}

function connectQueueSocket() {
  if (queueSocket && (queueSocket.readyState === WebSocket.OPEN || queueSocket.readyState === WebSocket.CONNECTING)) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  queueSocket = new WebSocket(`${protocol}//${location.host}/api/queue/connect?clientId=${getClientId()}&locationCode=${encodeURIComponent(getLocationCode())}`);
  queueSocket.addEventListener('open', () => {
    checkMissedAssignments();
  });
  queueSocket.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'assigned') {
      const saleId = queueIdToSaleId.get(msg.queueId);
      if (!saleId) return;
      queueIdToSaleId.delete(msg.queueId);
      sendCheckoutForSale(saleId, msg.deviceId);
    }
    if (msg.type === 'state' && Array.isArray(msg.activeSales)) {
      locationActiveSales = msg.activeSales;
      renderQueueBadge();
      if (!queueModal.classList.contains('hidden')) renderQueueModalList();
    }
  });
  queueSocket.addEventListener('close', () => {
    setTimeout(connectQueueSocket, 2000);
  });
}
connectQueueSocket();

async function sendCheckoutForSale(saleId, deviceId) {
  const sale = pendingSales.get(saleId);
  if (!sale) return;
  sale.status = 'sending';
  sale.queueId = null;
  renderPendingSales();
  try {
    const res = await fetch('/api/terminal-checkout', {
      method: 'POST',
      headers: locationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ items: sale.items, deviceId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Terminal checkout failed');
    sale.checkoutId = data.checkoutId;
    sale.deviceId = deviceId;
    sale.status = 'waiting-for-card';
    sale.cardStatus = data.status;
    renderPendingSales();
    fetch(`/api/queue/active-sales/${saleId}`, {
      method: 'PATCH',
      headers: locationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'waiting-for-card', checkoutId: data.checkoutId, deviceId })
    }).catch(() => {});
    pollPendingSale(saleId, 45);
  } catch (err) {
    toast('Terminal error: ' + err.message, 'error');
    removePendingSale(saleId);
  }
}

// Polls every 2s for up to 45 attempts (~90s ceiling) until the checkout is
// COMPLETED (finish the sale), CANCELED (report it), or we give up gracefully.
async function pollPendingSale(saleId, attemptsLeft) {
  const sale = pendingSales.get(saleId);
  if (!sale) return;

  if (attemptsLeft <= 0) {
    sale.status = 'stuck';
    renderPendingSales();
    return;
  }
  try {
    const res = await fetch(`/api/terminal-checkout/${sale.checkoutId}`, { headers: locationHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Status check failed');

    if (data.status === 'COMPLETED') {
      notifyTerminalFreedClientSide(sale.deviceId);
      await recordSale(sale.items, sale.total, 'card');
      toast('Sale complete!', 'success');
      removePendingSale(saleId);
      return;
    }
    if (data.status === 'CANCELED') {
      notifyTerminalFreedClientSide(sale.deviceId);
      toast('Terminal checkout canceled', 'error');
      removePendingSale(saleId);
      return;
    }

    sale.cardStatus = data.status;
    renderPendingSales();
    sale.pollTimer = setTimeout(() => pollPendingSale(saleId, attemptsLeft - 1), 2000);
  } catch (err) {
    toast('Terminal status error: ' + err.message, 'error');
    removePendingSale(saleId);
  }
}

btnReviewTerminal.addEventListener('click', async () => {
  if (!cart.length) return;
  const saleId = crypto.randomUUID();
  const items = cart.map(item => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity }));
  const total = items.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
  pendingSales.set(saleId, { items, total, status: 'queued', position: null, queueId: null, deviceId: null, checkoutId: null, cardStatus: null, pollTimer: null });

  // Hand off to the background tracker right away - clear the cart and
  // close the modal so scanning the next sale can start immediately,
  // rather than blocking on this one.
  cart = [];
  renderCart();
  closeReviewModal();
  renderPendingSales();
  connectQueueSocket();

  try {
    const res = await fetch('/api/queue/enqueue', {
      method: 'POST',
      headers: locationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ clientId: getClientId(), cart: items })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not reach the terminal queue');

    // Report into the shared Queue view too - everyone at this location
    // should see this sale, not just the device that started it.
    fetch('/api/queue/active-sales', {
      method: 'POST',
      headers: locationHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        saleId, clientId: getClientId(), cart: items, total,
        deviceId: data.status === 'assigned' ? data.deviceId : null,
        status: data.status === 'assigned' ? 'assigned' : 'queued'
      })
    }).catch(() => {});

    if (data.status === 'assigned') {
      sendCheckoutForSale(saleId, data.deviceId);
    } else {
      const sale = pendingSales.get(saleId);
      if (!sale) return; // canceled before the response came back
      sale.queueId = data.queueId;
      sale.position = data.position;
      queueIdToSaleId.set(data.queueId, saleId);
      renderPendingSales();
    }
  } catch (err) {
    toast('Terminal queue error: ' + err.message, 'error');
    removePendingSale(saleId);
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
  completeCashSale();
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
  completeSale('venmo');
});

// --- Event listeners ---
btnCamera.addEventListener('click', () => {
  if (cameraActive) captureFrame();
  else startCamera();
});
btnUpload.addEventListener('click', () => fileInput.click());
btnExport.addEventListener('click', async () => { exportCSV(await getRecords()); toast('CSV downloaded', 'success'); });

// --- Test data seeding (local dev only) ---
const isLocalEnv = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (isLocalEnv) {
  btnSeedTest.style.display = '';
}

btnSeedTest.addEventListener('click', async () => {
  const sampleRecords = [
    { uniqueId: '', name: 'Kitty Button', price: '8.00', quantity: '5', location: 'Bin A' },
    { uniqueId: '', name: 'Star Button', price: '6.50', quantity: '3', location: 'Bin A' },
    { uniqueId: '', name: 'Floral Button', price: '10.00', quantity: '2', location: 'Bin B' }
  ];
  for (const record of sampleRecords) await saveRecord(record);
  await renderRecords();
  toast('Seeded 3 test records', 'success');
});

// --- Helpers ---
function showStatus(msg) {
  statusMsg.textContent = msg;
  statusBar.classList.add('visible');
}
function hideStatus() { statusBar.classList.remove('visible'); }

let toastTimer;
function toast(msg, type = '', duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, duration);
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

// Shows the connected Square business name at the top instead of the
// generic app name, once there's a location bound and a Square account
// connected for its organization - falls back to "Tag Scanner" otherwise.
// Stale-while-revalidate: paint instantly from the last-known name cached
// in localStorage (non-sensitive - just a display label, never a token),
// then always re-fetch in the background and correct it if it changed, so
// there's no TTL to guess at and no stale window beyond the current view.
if (getLocationCode()) {
  const businessNameCacheKey = `businessName:${getLocationCode()}`;
  const cachedBusinessName = localStorage.getItem(businessNameCacheKey);
  if (cachedBusinessName) {
    document.getElementById('app-title').textContent = cachedBusinessName;
  }
  fetch('/api/square/connection', { headers: locationHeaders() })
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (data?.connected && data.businessName) {
        if (data.businessName !== cachedBusinessName) {
          document.getElementById('app-title').textContent = data.businessName;
        }
        localStorage.setItem(businessNameCacheKey, data.businessName);
      } else {
        localStorage.removeItem(businessNameCacheKey);
      }
    })
    .catch(() => {});
}
