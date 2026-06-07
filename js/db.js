// db.js — IndexedDB 封裝（以 profileId 區隔多身分進度）
// 規格：禁用 localStorage 存學習進度，一律存 IndexedDB。

const DB_NAME = 'vocabApp';
const DB_VERSION = 2;

let _dbPromise = null;

// 開啟（或升級）資料庫
export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = req.result;

      // 身分（兩個孩子）：{id, name, settings}
      if (!db.objectStoreNames.contains('profiles')) {
        db.createObjectStore('profiles', { keyPath: 'id' });
      }

      // 學習紀錄：key = `${profileId}::${wordId}`
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'key' });
        s.createIndex('by_profile', 'profileId', { unique: false });
        s.createIndex('by_profile_status', ['profileId', 'status'], { unique: false });
        s.createIndex('by_profile_due', ['profileId', 'due'], { unique: false });
        s.createIndex('by_profile_level', ['profileId', 'level'], { unique: false });
      }

      // 字典 API 快取：key = 單字（小寫）
      if (!db.objectStoreNames.contains('dictCache')) {
        db.createObjectStore('dictCache', { keyPath: 'word' });
      }

      // 每日紀錄：key = `${profileId}::${YYYY-MM-DD}`
      if (!db.objectStoreNames.contains('dailyLog')) {
        const s = db.createObjectStore('dailyLog', { keyPath: 'key' });
        s.createIndex('by_profile', 'profileId', { unique: false });
      }

      // 雜項設定：key-value（例：activeProfile）
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }

      // 學習日曆：每日學習計畫（含自動組與手動組）key = `${profileId}::${date}`
      if (!db.objectStoreNames.contains('dayPlans')) {
        const s = db.createObjectStore('dayPlans', { keyPath: 'key' });
        s.createIndex('by_profile', 'profileId', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

// 共用：以 Promise 包一個 transaction
function tx(storeNames, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(t);
  }));
}

function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------- meta ----------
export async function getMeta(key, fallback = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction('meta').objectStore('meta').get(key);
    r.onsuccess = () => resolve(r.result ? r.result.value : fallback);
    r.onerror = () => reject(r.error);
  });
}

export function setMeta(key, value) {
  return tx('meta', 'readwrite', (t) => {
    t.objectStore('meta').put({ key, value });
  });
}

// ---------- profiles ----------
export async function getAllProfiles() {
  const db = await openDB();
  return reqPromise(db.transaction('profiles').objectStore('profiles').getAll());
}

export async function getProfile(id) {
  const db = await openDB();
  return reqPromise(db.transaction('profiles').objectStore('profiles').get(id));
}

export function putProfile(profile) {
  return tx('profiles', 'readwrite', (t) => {
    t.objectStore('profiles').put(profile);
  });
}

// ---------- records ----------
export function recordKey(profileId, wordId) {
  return `${profileId}::${wordId}`;
}

export async function getRecord(profileId, wordId) {
  const db = await openDB();
  return reqPromise(
    db.transaction('records').objectStore('records').get(recordKey(profileId, wordId))
  );
}

export function putRecord(rec) {
  return tx('records', 'readwrite', (t) => {
    t.objectStore('records').put(rec);
  });
}

export function deleteRecord(profileId, wordId) {
  return tx('records', 'readwrite', (t) => {
    t.objectStore('records').delete(recordKey(profileId, wordId));
  });
}

// 取某身分全部紀錄
export async function getRecordsByProfile(profileId) {
  const db = await openDB();
  const idx = db.transaction('records').objectStore('records').index('by_profile');
  return reqPromise(idx.getAll(IDBKeyRange.only(profileId)));
}

// 取某身分「已到期」需複習的紀錄（due <= now 且 attempts>0）
export async function getDueRecords(profileId, now = Date.now()) {
  const db = await openDB();
  const idx = db.transaction('records').objectStore('records').index('by_profile_due');
  const range = IDBKeyRange.bound([profileId, -Infinity], [profileId, now]);
  const all = await reqPromise(idx.getAll(range));
  return all.filter((r) => r.attempts > 0);
}

// 取某身分既有「new（查過但未測）」紀錄
export async function getNewRecords(profileId) {
  const db = await openDB();
  const idx = db.transaction('records').objectStore('records').index('by_profile_status');
  return reqPromise(idx.getAll(IDBKeyRange.only([profileId, 'new'])));
}

export async function countByStatus(profileId, status) {
  const db = await openDB();
  const idx = db.transaction('records').objectStore('records').index('by_profile_status');
  return reqPromise(idx.count(IDBKeyRange.only([profileId, status])));
}

// 批次寫入紀錄
export function putRecords(recs) {
  return tx('records', 'readwrite', (t) => {
    const store = t.objectStore('records');
    recs.forEach((r) => store.put(r));
  });
}

// 刪除某身分全部紀錄與每日紀錄（匯入覆蓋用）
export async function clearProfileData(profileId) {
  const recs = await getRecordsByProfile(profileId);
  const logs = await getDailyLogsByProfile(profileId);
  return tx(['records', 'dailyLog'], 'readwrite', (t) => {
    const rs = t.objectStore('records');
    recs.forEach((r) => rs.delete(r.key));
    const ls = t.objectStore('dailyLog');
    logs.forEach((l) => ls.delete(l.key));
  });
}

// 刪除某身分的 profile 本體（連同紀錄、每日紀錄、學習日曆）
export async function deleteProfileFully(profileId) {
  await clearProfileData(profileId);
  // 刪除該身分的日曆計畫
  const days = await getDaysByProfile(profileId);
  await tx(['profiles', 'dayPlans'], 'readwrite', (t) => {
    t.objectStore('profiles').delete(profileId);
    const ds = t.objectStore('dayPlans');
    days.forEach((d) => ds.delete(d.key));
  });
}

// ---------- dictCache ----------
export async function getDictCache(word) {
  const db = await openDB();
  return reqPromise(db.transaction('dictCache').objectStore('dictCache').get(word.toLowerCase()));
}

export function putDictCache(word, data) {
  return tx('dictCache', 'readwrite', (t) => {
    t.objectStore('dictCache').put({ word: word.toLowerCase(), data, fetchedAt: Date.now() });
  });
}

// ---------- dailyLog ----------
export function dailyKey(profileId, dateStr) {
  return `${profileId}::${dateStr}`;
}

export async function getDailyLog(profileId, dateStr) {
  const db = await openDB();
  return reqPromise(
    db.transaction('dailyLog').objectStore('dailyLog').get(dailyKey(profileId, dateStr))
  );
}

export function putDailyLog(log) {
  return tx('dailyLog', 'readwrite', (t) => {
    t.objectStore('dailyLog').put(log);
  });
}

export async function getDailyLogsByProfile(profileId) {
  const db = await openDB();
  const idx = db.transaction('dailyLog').objectStore('dailyLog').index('by_profile');
  return reqPromise(idx.getAll(IDBKeyRange.only(profileId)));
}

// ---------- dayPlans（學習日曆） ----------
export function dayKey(profileId, dateStr) {
  return `${profileId}::${dateStr}`;
}

export async function getDayPlan(profileId, dateStr) {
  const db = await openDB();
  return reqPromise(
    db.transaction('dayPlans').objectStore('dayPlans').get(dayKey(profileId, dateStr))
  );
}

export function putDayPlan(plan) {
  return tx('dayPlans', 'readwrite', (t) => {
    t.objectStore('dayPlans').put(plan);
  });
}

export async function getDaysByProfile(profileId) {
  const db = await openDB();
  const idx = db.transaction('dayPlans').objectStore('dayPlans').index('by_profile');
  return reqPromise(idx.getAll(IDBKeyRange.only(profileId)));
}
