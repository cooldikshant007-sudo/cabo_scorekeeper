const CACHE = 'poker-scorekeeper-v21';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const freshAsset = event.request.mode === 'navigate' || /\.(html|css|js)$/.test(url.pathname);
  event.respondWith(freshAsset
    ? fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request))
    : caches.match(event.request).then(saved => saved || fetch(event.request)));
});
