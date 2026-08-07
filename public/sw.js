// sw.js — Basic Service Worker to allow PWA Installation
const CACHE_NAME = 'parkpro-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/gate.js',
  '/manifest.json'
];

// Install the service worker and cache the core files
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Serve cached files when loading the app
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
