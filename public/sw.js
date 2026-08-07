// sw.js — Service Worker (Network First Strategy)
const CACHE_NAME = 'parkpro-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/gate.js',
  '/manifest.json'
];

// Install and immediately take over
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Clean up old caches when a new version activates
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});

// Network First, fallback to cache if offline
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
