// lookup.js — 查單字＝自動記錄、字典 API（dictionaryapi.dev）、發音（Web Speech API）

import { findByWord, registerCustomWord, getById } from './vocab.js';
import { getRecord, putRecord, getDictCache, putDictCache, getMeta, setMeta, deleteRecord } from './db.js';
import { newRecord } from './srs.js';

// ---------- 發音 ----------
let _voices = [];
function loadVoices() {
  _voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
if (window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export function speak(text, lang = 'en-US') {
  try {
    if (!window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.9;
    // 盡量挑選英語語音
    const v = _voices.find((x) => x.lang && x.lang.toLowerCase().startsWith('en'));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    console.warn('發音失敗', e);
    return false;
  }
}

// ---------- 字典 API（補音標／例句），失敗不可崩潰 ----------
export async function fetchDict(word) {
  const key = word.toLowerCase().trim();
  // 先讀快取
  try {
    const cached = await getDictCache(key);
    if (cached && cached.data) return cached.data;
  } catch (e) { /* 忽略 */ }

  // 離線直接回 null
  if (!navigator.onLine) return null;

  try {
    // 加逾時保護，避免慢速網路讓畫面卡住
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const parsed = parseDict(json);
    if (parsed) await putDictCache(key, parsed);
    return parsed;
  } catch (e) {
    console.warn('字典 API 失敗或逾時', e);
    return null;
  }
}

function parseDict(json) {
  if (!Array.isArray(json) || !json.length) return null;
  const out = { phonetic: '', examples: [], audio: '', definition: '', pos: '', defs: [] };
  for (const entry of json) {
    if (!out.phonetic && entry.phonetic) out.phonetic = entry.phonetic;
    for (const ph of entry.phonetics || []) {
      if (!out.phonetic && ph.text) out.phonetic = ph.text;
      if (!out.audio && ph.audio) out.audio = ph.audio;
    }
    for (const m of entry.meanings || []) {
      const part = m.partOfSpeech || '';
      for (const d of m.definitions || []) {
        if (d.definition) out.defs.push({ pos: part, def: d.definition });
        if (d.example) out.examples.push(d.example);
      }
    }
  }
  if (out.defs.length) {
    out.definition = out.defs[0].def;
    out.pos = out.defs[0].pos;
  }
  out.examples = out.examples.slice(0, 3);
  out.defs = out.defs.slice(0, 3);
  return out;
}

// ---------- 查單字＝自動記錄 ----------
// 回傳 { entry, dict, recordStatus, autoAdded }
// recordStatus: 'new' | 'learning' | 'weak' | 'mastered' | null（查無本機資料）
export async function lookupWord(profile, input) {
  const entry = findByWord(input);
  // 同時取字典補充（音標/例句），失敗回 null
  const dictWord = entry ? entry.word.replace(/\(.*?\)/g, '').trim() : input;
  const dict = await fetchDict(dictWord);

  if (!entry) {
    return { entry: null, dict, recordStatus: null, autoAdded: false };
  }

  // 自動記錄：若無紀錄 → 以 status:new 加入；已存在則不覆蓋
  let rec = await getRecord(profile.id, entry.id);
  let autoAdded = false;
  if (!rec) {
    rec = newRecord(profile.id, entry.id, entry.level);
    await putRecord(rec);
    autoAdded = true;
  }
  return { entry, dict, recordStatus: rec.status, autoAdded };
}

// ---------- 自訂單字（custom / 我查的字） ----------
function customId(word) {
  return 'custom-' + word.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// 建立/更新自訂單字並自動記錄。回傳 { entry, autoAdded }
export async function createCustomWord(profile, word, opts = {}) {
  const w = word.trim();
  const id = customId(w);
  let entry = getById(id);
  if (!entry) {
    entry = {
      id, word: w, pos: (opts.dict && opts.dict.pos) || '', zh: opts.zh || '',
      level: 0, answerKeys: [w.toLowerCase()], example: (opts.dict && opts.dict.examples && opts.dict.examples[0]) || '',
      example_zh: '', root: null, groupKeys: [], custom: true, source: 'custom',
      definition: (opts.dict && opts.dict.definition) || '',
    };
    registerCustomWord(entry);
  } else if (opts.zh) {
    entry.zh = opts.zh;
  }
  await persistCustom(entry);

  let autoAdded = false;
  let rec = await getRecord(profile.id, id);
  if (!rec) {
    rec = newRecord(profile.id, id, 0);
    await putRecord(rec);
    autoAdded = true;
  }
  return { entry, autoAdded, recordStatus: rec.status };
}

async function persistCustom(entry) {
  const list = (await getMeta('customWords')) || [];
  const i = list.findIndex((c) => c.id === entry.id);
  if (i >= 0) list[i] = entry; else list.push(entry);
  await setMeta('customWords', list);
}

// 編輯自訂單字中文
export async function updateCustomZh(entry, zh) {
  entry.zh = zh;
  await persistCustom(entry);
}

// 刪除自訂單字（移除該身分紀錄 + 從自訂清單移除）
export async function deleteCustomWord(profile, entry) {
  await deleteRecord(profile.id, entry.id);
  const list = (await getMeta('customWords')) || [];
  await setMeta('customWords', list.filter((c) => c.id !== entry.id));
}

// 反向操作：把某字加入複習（已熟記者由使用者手動觸發）
export async function addToReview(profile, entry) {
  let rec = await getRecord(profile.id, entry.id);
  if (!rec) {
    rec = newRecord(profile.id, entry.id, entry.level);
    await putRecord(rec);
    return rec;
  }
  // 已熟記 → 退回需加強並設為今天到期
  rec.status = 'weak';
  rec.due = Date.now();
  rec.interval = 0;
  rec.reps = 0;
  await putRecord(rec);
  return rec;
}
