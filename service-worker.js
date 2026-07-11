// service-worker.js — 離線優先 + 可靠的版本更新機制
// 注意：使用相對路徑，確保在 GitHub Pages 子路徑 /vocabulary/ 下也可運作。
//
// ★ 改版方式：每次 push 新版前，把下面的 APP_VERSION 改成新值即可。
//   （cache 名稱會跟著變 → 舊快取自動清除 → 使用者連網開啟會拿到新版程式與新版 vocab.json）

const APP_VERSION = '2026-07-11-R1-cleanup'; // ★ 同步更新 js/app.js 的 APP_UI_VERSION
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
  './js/tests.js',
  './js/badges.js',
  './js/paircode.js',
  './js/schedule.js',
  './js/vendor/qrcode.js',
  './js/vendor/jsQR.js',
  './js/notify.js',
  './data/vocab.json',
  './data/roots.json',
  './data/groups.json',
  './data/groups_index.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // 逐檔預快取：任何一個檔案失敗都不可阻擋升級（原本 addAll 一敗全敗 → skipWaiting 不執行 → 新版卡在 waiting，手機永遠拿不到新版）
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) =>
        c.add(u).catch((err) => console.warn('預快取失敗（可忽略）', u, err))
      )))
      .catch((err) => console.warn('預快取整批失敗（可忽略）', err))
      .then(() => self.skipWaiting())
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

// ---------- 每日提醒（Periodic Background Sync，盡力而為） ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('vocabApp');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbGet(db, store, key) {
  return new Promise((resolve) => {
    try {
      const r = db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
function idbPut(db, store, value) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, 'readwrite');
      t.objectStore(store).put(value);
      t.oncomplete = () => resolve(true);
      t.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}
function todayStrSW() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function maybeRemind() {
  try {
    const db = await idbOpen();
    const meta = await idbGet(db, 'meta', 'reminder');
    const r = meta && meta.value;
    if (!r || !r.on) return;
    // 已過今日提醒時間？
    const m = /^(\d{1,2}):(\d{2})$/.exec(r.time || '19:30');
    const now = new Date();
    const target = new Date(); target.setHours(m ? +m[1] : 19, m ? +m[2] : 30, 0, 0);
    if (now < target) return;
    // 今天是否已提醒過？
    const shown = await idbGet(db, 'meta', 'reminderShown');
    if (shown && shown.value === todayStrSW()) return;
    await idbPut(db, 'meta', { key: 'reminderShown', value: todayStrSW() });
    await self.registration.showNotification('📚 今天的英文單字還沒練喔！', {
      body: '點開練 5 分鐘 💪',
      tag: 'vocab-daily-reminder',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: './index.html#quiz' },
    });
  } catch (e) { /* 忽略 */ }
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'daily-reminder') e.waitUntil(maybeRemind());
});

// 點通知 → 開到測驗畫面
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './index.html#quiz';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
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
