// Web Bluetooth driver for the Phomemo M-series label printers (M110, M120,
// M220, M200 all share one 384-dot-wide protocol - see protocol constants
// below). There is no official spec; these command bytes, the BLE
// service/characteristic UUIDs, and the inter-write delays are taken from
// mkuhlmann/pyphomemo (github.com/mkuhlmann/pyphomemo), itself reverse-
// engineered from the Phomemo Android/iOS app's BLE traffic and from
// taylorjdlee/phomemo-tools. The delays matter - sending the raster in one
// unbroken chunked stream (no pauses) is reported to make the printer flash
// and discard the job.
//
// Only Chrome (desktop or Android) implements Web Bluetooth - Safari/iOS
// never will (an Apple platform decision, not a bug) - so this module is a
// no-op dead end there; callers should check `isSupported()` first and fall
// back to the existing save/share flow.

export const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
export const WRITE_CHAR_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';
export const NOTIFY_CHAR_UUID = '0000ff03-0000-1000-8000-00805f9b34fb';

export const PRINTER_WIDTH_PX = 384; // print head width, in dots
export const BYTES_PER_LINE = PRINTER_WIDTH_PX / 8; // 48
export const PX_PER_MM = 8; // 203 dpi

export const MEDIA_LABEL_WITH_GAPS = 0x0a; // die-cut labels - printer senses each gap
export const MEDIA_CONTINUOUS = 0x0b; // continuous receipt-style tape

const CHUNK_SIZE = 128; // GATT write size the reference implementation uses
const CHUNK_DELAY_MS = 20;
const DELAY_INIT_MS = 30;
const DELAY_BEFORE_FOOTER_MS = 300;
const DELAY_AFTER_FOOTER_MS = 500;

let device = null;
let characteristic = null;

export function isSupported() {
  return 'bluetooth' in navigator;
}

export function isConnected() {
  return !!(device && device.gatt && device.gatt.connected && characteristic);
}

export function connectedPrinterName() {
  return device ? device.name : null;
}

// Opens the browser's Bluetooth device picker (must be called from a user
// gesture, e.g. a button click handler - the API throws otherwise) and
// connects to whichever printer the person selects.
export async function connectPrinter() {
  if (!isSupported()) {
    throw new Error('Bluetooth printing needs Chrome on Android or a computer - this browser doesn’t support it.');
  }
  // Would ideally filter by a namePrefix (e.g. "M120") to keep the device
  // picker to just this printer, but several M-series units advertise a
  // bare serial number instead (e.g. "Q199E45K1234567" - noted in
  // pyphomemo's model detection) rather than a name starting with "M120"
  // etc., which would make them invisible to a namePrefix filter.
  // acceptAllDevices guarantees it shows up, at the cost of a noisier
  // picker list - pick whichever device matches the printer (by name if
  // it has one, else by elimination / signal strength while standing next
  // to it).
  const picked = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [SERVICE_UUID],
  });
  picked.addEventListener('gattserverdisconnected', () => {
    characteristic = null;
  });
  device = picked;
  await connectGatt();
  return device.name;
}

async function connectGatt() {
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  characteristic = await service.getCharacteristic(WRITE_CHAR_UUID);
}

// Re-opens the GATT connection to the already-paired printer without
// re-prompting the device picker - used when a print is requested after the
// printer dropped the connection (it does this on its own after a job, and
// whenever it's briefly out of range) but the person already chose it once
// this session.
async function ensureConnected() {
  if (!device) {
    throw new Error('No printer connected yet - tap Connect Printer first.');
  }
  if (!device.gatt.connected || !characteristic) {
    await connectGatt();
  }
}

export function disconnectPrinter() {
  if (device && device.gatt.connected) device.gatt.disconnect();
  device = null;
  characteristic = null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeChar(bytes) {
  // write-without-response is what the reference BLE flow uses and is
  // markedly faster; fall back to the confirmed write if the printer's
  // characteristic doesn't advertise it.
  if (characteristic.properties.writeWithoutResponse) {
    await characteristic.writeValueWithoutResponse(bytes);
  } else {
    await characteristic.writeValueWithResponse(bytes);
  }
}

async function writeChunked(bytes) {
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    await writeChar(bytes.subarray(i, i + CHUNK_SIZE));
    await sleep(CHUNK_DELAY_MS);
  }
}

function cmdSpeed(speed) {
  return new Uint8Array([0x1b, 0x4e, 0x0d, speed]);
}
function cmdDensity(density) {
  return new Uint8Array([0x1b, 0x4e, 0x04, density]);
}
function cmdMedia(media) {
  return new Uint8Array([0x1f, 0x11, media]);
}
function rasterHeader(widthBytes, height) {
  return new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
}
function footer() {
  return new Uint8Array([0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]);
}

// Converts a <canvas> (already drawn in plain black-on-white - no
// anti-aliased grays expected, since a QR code can't tolerate dithering)
// into the printer's packed 1-bit-per-pixel raster: MSB-first, bit set (1)
// = black ink, one row of `widthBytes` bytes per pixel row, padded to the
// byte boundary (so canvas.width must be a multiple of 8).
export function canvasToRaster(canvas, { threshold = 160 } = {}) {
  const width = canvas.width;
  const height = canvas.height;
  if (width % 8 !== 0) {
    throw new Error(`Label canvas width (${width}) must be a multiple of 8`);
  }
  const widthBytes = width / 8;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  const raster = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * widthBytes;
    for (let xByte = 0; xByte < widthBytes; xByte++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3] / 255;
        // Flatten any transparency onto white before thresholding.
        const lum = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) * alpha + 255 * (1 - alpha);
        if (lum < threshold) byte |= (0x80 >> bit); // dark pixel -> set bit -> black ink
      }
      raster[rowOffset + xByte] = byte;
    }
  }
  return { raster, widthBytes, height };
}

// Runs the full print sequence for one label: speed/density/media setup,
// a single raster block sized to the canvas, then the footer. Reconnects
// to the already-paired printer first if it dropped the BLE connection
// since the last print (normal after each job).
export async function printCanvas(canvas, { speed = 0x05, density = 0x0f, media = MEDIA_LABEL_WITH_GAPS, threshold } = {}) {
  await ensureConnected();
  const { raster, widthBytes, height } = canvasToRaster(canvas, { threshold });

  await writeChar(cmdSpeed(speed));
  await sleep(DELAY_INIT_MS);
  await writeChar(cmdDensity(density));
  await sleep(DELAY_INIT_MS);
  await writeChar(cmdMedia(media));
  await sleep(DELAY_INIT_MS);

  await writeChar(rasterHeader(widthBytes, height));
  await writeChunked(raster);

  await sleep(DELAY_BEFORE_FOOTER_MS);
  await writeChar(footer());
  await sleep(DELAY_AFTER_FOOTER_MS);
}
