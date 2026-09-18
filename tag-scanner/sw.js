const CACHE = 'tag-scanner-v31';
const ASSETS = [
  '/', '/index.html', '/settings/', '/css/style.css', '/js/app.js', '/js/storage.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Network-first: always try to fetch the current version first (so a
// deploy shows up on the very next load with no manual cache-version bump
// needed), and only fall back to whatever's cached when offline. Cache-first
// was causing every JS/CSS fix to silently keep serving stale code until
// this CACHE constant was bumped by hand - easy to forget, as happened
// several times in a row here.
self.addEventListener('fetch', e => {
  if (e.request.url.includes('api.stripe.com')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
