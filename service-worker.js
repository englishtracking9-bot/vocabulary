// service-worker.js — 離線優先 + 可靠的版本更新機制
// 注意：使用相對路徑，確保在 GitHub Pages 子路徑 /vocabulary/ 下也可運作。
//
// ★ 改版方式：每次 push 新版前，把下面的 APP_VERSION 改成新值即可。
//   （cache 名稱會跟著變 → 舊快取自動清除 → 使用者連網開啟會拿到新版程式與新版 vocab.json）

const APP_VERSION = '2026-06-07-examples-L2';
const CACHE = 'vocab-' + APP_VERSION;

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
  './js/grouping.js',
  './js/sentence.js',
  './js/tags.js',
  './data/vocab.json',
  './data/roots.json',
  './data/groups.json',
  './data/groups_index.json',
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

// 允許頁面要求 SW 立即接管
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

function isContent(url) {
  // 程式與資料：要「連網優先」確保拿到新版
  return /\.(?:js|json|html)$/.test(url.pathname) || url.pathname.endsWith('/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 跨網域（如字典 API）：直接走網路，不快取
  if (url.origin !== self.location.origin) return;

  // 導覽請求：連網優先，失敗回 index.html（離線單頁）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
        return res;
      }).catch(() => caches.match('./index.html') || caches.match('./'))
    );
    return;
  }

  // 程式碼與資料(js/json/html)：連網優先 → 更新快取；離線時回快取
  if (isContent(url)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 其他靜態資源（css/圖片）：cache-first，背景補抓
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
