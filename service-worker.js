// service-worker.js — 離線優先快取（App Shell + vocab.json）
// 注意：使用相對路徑，確保在 GitHub Pages 子路徑 /vocabulary/ 下也可運作。

const CACHE = 'vocab-cache-v1';

// 預先快取的核心檔案（相對於 SW 所在目錄）
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/srs.js',
  './js/quiz.js',
  './js/lookup.js',
  './js/report.js',
  './js/stats.js',
  './js/vocab.js',
  './js/util.js',
  './data/vocab.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
      .catch((err) => console.warn('預快取部分失敗（可忽略）', err))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 跨網域（如字典 API）：直接走網路，不快取，失敗交給呼叫端 try/catch
  if (url.origin !== self.location.origin) return;

  // 導覽請求：先網路、失敗回 index.html（單頁離線）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 同網域資源：cache-first，背景補抓更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
