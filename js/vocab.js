// vocab.js — 載入 data/vocab.json 並建立記憶體索引（共用模組）
// 全六級（約 6008 字）一次載入；以 id 與各 answerKey 建立查找表。

let _list = [];
let _byId = new Map();
let _byKey = new Map(); // answerKey(小寫) / word(小寫) -> entry

export async function loadVocab() {
  if (_list.length) return _list;
  // 相對路徑，確保 GitHub Pages 子路徑下可用
  const res = await fetch('./data/vocab.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error('無法載入 vocab.json：' + res.status);
  _list = await res.json();

  _byId.clear();
  _byKey.clear();
  for (const e of _list) {
    _byId.set(e.id, e);
    const keys = new Set([e.word.toLowerCase().trim(), ...(e.answerKeys || [])]);
    for (const k of keys) {
      if (!_byKey.has(k)) _byKey.set(k, e);
    }
  }
  return _list;
}

export function allWords() {
  return _list;
}

// 註冊自訂單字（查無本機資料時，使用者手動補中文後加入）
export function registerCustomWord(entry) {
  if (_byId.has(entry.id)) return _byId.get(entry.id);
  _list.push(entry);
  _byId.set(entry.id, entry);
  const keys = new Set([entry.word.toLowerCase().trim(), ...(entry.answerKeys || [])]);
  for (const k of keys) if (!_byKey.has(k)) _byKey.set(k, entry);
  return entry;
}

export function getById(id) {
  return _byId.get(id);
}

// 以使用者輸入的字串查單字（先精確、再寬鬆比對）
export function findByWord(input) {
  const k = (input || '').toLowerCase().trim();
  if (!k) return null;
  return _byKey.get(k) || null;
}

// 依級別取得單字（用於每日新字候選）
export function wordsByLevels(levels) {
  const set = new Set(levels);
  return _list.filter((e) => set.has(e.level));
}

// 答案比對：忽略大小寫與前後空白，比對 answerKeys
export function checkAnswer(entry, input) {
  const a = (input || '').toLowerCase().trim();
  if (!a) return false;
  return (entry.answerKeys || []).some((k) => k.toLowerCase().trim() === a);
}
