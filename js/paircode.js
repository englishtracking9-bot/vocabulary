// paircode.js — 出題碼＋完成碼：家長電腦 ↔ 孩子手機的離線傳碼（免雲端）
// 作法：用 vocab.json 的順序給每個字一個 index（0..6007），每個 index 用 2 byte 打包，
// 再轉 base64url。20 個字約 40 bytes → base64 約 54 字元，QR 容易掃。不含任何個資/成績。
// 出題碼（家長→孩子）：
//   V1：純 id 清單（題型預設拼字＋造句）
//   V2：第 1 byte 題型旗標（bit0 拼字、bit1 造句），其後為 id
//   V3：題型旗標(1) + 批次編號 batchId(2) + id*2 —— batchId 供完成碼回報對帳
//   V4：題型旗標(1) + batchId(2) + 出題對象代號(1，0=自訂身分後接 len+utf8 id) + id*2
//       —— 孩子掃碼時核對身分，避免 Justin 做到 Sonya 的題
// 完成碼（孩子→家長，N 計畫）：
//   C1：學生代號(1，0=自訂身分時後接 len+utf8 id) + [batchId(2)+字數(2)+id*2]×批次
//   只帶「做了哪些字」，不帶成績，碼才短（30 字約 90 字元，可貼 LINE 或以 QR 呈現）
// 進度同步碼（孩子→家長，一次性全量）：
//   S1：學生代號(1，同上) + id*2 —— 「目前為止做過的所有字」，不帶熟練度/複習日。
//   超過 500 字自動分成多段，每段自帶身分、可分次貼入累加（500 字一段約 1340 字元）。
// 注意：自訂字（我查的字/level 0）只存在單一裝置、跨裝置 index 對不上 → 一律不編入，由呼叫端提示。

import { allWords, getById } from './vocab.js';

let _idToIdx = null;
let _idxToId = null;

function buildMaps() {
  const words = allWords();
  _idToIdx = new Map();
  _idxToId = new Array(words.length);
  words.forEach((w, i) => { _idToIdx.set(w.id, i); _idxToId[i] = w.id; });
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 過濾出「可跨裝置傳輸」的字（排除自訂字）
export function encodableIds(ids) {
  if (!_idToIdx) buildMaps();
  return ids.filter((id) => { const e = getById(id); return e && !e.custom && _idToIdx.get(id) != null; });
}

// 把 wordId 清單＋題型（＋批次編號＋出題對象）編成出題碼字串。types: { spelling, sentence }
// 有 forProfileId → V4；只有 batchId → V3；都沒有 → V2（維持既有呼叫端行為）
export function encodeWordIds(ids, types = { spelling: true, sentence: true }, batchId = null, forProfileId = null) {
  if (!_idToIdx) buildMaps();
  const nums = encodableIds(ids).map((id) => _idToIdx.get(id));
  const flags = (types.spelling !== false ? 1 : 0) | (types.sentence !== false ? 2 : 0);
  const parts = [flags];
  if (forProfileId != null || batchId != null) {
    const b = batchId || 0;
    parts.push((b >> 8) & 0xff, b & 0xff);
  }
  if (forProfileId != null) {
    const tag = PROFILE_TAG[forProfileId] || 0;
    parts.push(tag);
    if (tag === 0) {
      const idBytes = new TextEncoder().encode(String(forProfileId));
      parts.push(idBytes.length, ...idBytes);
    }
  }
  for (const n of nums) parts.push((n >> 8) & 0xff, n & 0xff);
  const ver = forProfileId != null ? 'V4' : batchId != null ? 'V3' : 'V2';
  return ver + bytesToB64url(new Uint8Array(parts));
}

// 解出題碼字串 → { ids, types, batchId, forProfile }。
// 相容 V1（純 id）/ V2（＋題型）/ V3（＋批次編號）/ V4（＋出題對象）。
export function decodeCode(code) {
  if (!_idToIdx) buildMaps();
  const raw = String(code || '').trim();
  const m = raw.match(/V([1234])([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error('出題碼格式不符（應以 V1～V4 開頭）');
  const ver = m[1];
  const bytes = b64urlToBytes(m[2]);
  let types = { spelling: true, sentence: true };
  let batchId = null;
  let forProfile = null;
  let p = 0;
  if (ver !== '1') {
    const flags = bytes[p++];
    types = { spelling: !!(flags & 1), sentence: !!(flags & 2) };
    if (!types.spelling && !types.sentence) types = { spelling: true, sentence: true };
  }
  if (ver === '3' || ver === '4') {
    batchId = (bytes[p] << 8) | bytes[p + 1];
    p += 2;
  }
  if (ver === '4') {
    const tag = bytes[p++];
    if (tag === 0) {
      const len = bytes[p++];
      forProfile = new TextDecoder().decode(bytes.slice(p, p + len));
      p += len;
    } else {
      forProfile = TAG_PROFILE[tag] || null;
    }
  }
  const ids = [];
  for (; p + 1 < bytes.length; p += 2) {
    const n = (bytes[p] << 8) | bytes[p + 1];
    const id = _idxToId[n];
    if (id) ids.push(id);
  }
  return { ids, types, batchId, forProfile };
}

// ---------- 完成碼（孩子手機 → 家長電腦） ----------
const PROFILE_TAG = { senior1: 1, junior3: 2 };
const TAG_PROFILE = { 1: 'senior1', 2: 'junior3' };

// batches: [{ batchId, wordIds }]。只編入可跨裝置的字（同出題碼規則）。
export function encodeCompletion(profileId, batches) {
  if (!_idToIdx) buildMaps();
  const tag = PROFILE_TAG[profileId] || 0;
  const parts = [tag];
  if (tag === 0) {
    const idBytes = new TextEncoder().encode(String(profileId));
    parts.push(idBytes.length, ...idBytes);
  }
  for (const b of batches) {
    const nums = encodableIds(b.wordIds).map((id) => _idToIdx.get(id));
    parts.push((b.batchId >> 8) & 0xff, b.batchId & 0xff, (nums.length >> 8) & 0xff, nums.length & 0xff);
    for (const n of nums) parts.push((n >> 8) & 0xff, n & 0xff);
  }
  return 'C1' + bytesToB64url(new Uint8Array(parts));
}

// ---------- 進度同步碼（一次性全量；與每日完成碼 C1 區分） ----------
// 回傳「一段或多段」S1 碼的陣列（每段自帶身分，family 家長端可分次貼、自動累加）
export function encodeSyncCodes(profileId, wordIds, chunkSize = 500) {
  if (!_idToIdx) buildMaps();
  const tag = PROFILE_TAG[profileId] || 0;
  const idHeader = [];
  if (tag === 0) {
    const idBytes = new TextEncoder().encode(String(profileId));
    idHeader.push(idBytes.length, ...idBytes);
  }
  const nums = encodableIds(wordIds).map((id) => _idToIdx.get(id));
  const codes = [];
  for (let i = 0; i < nums.length || (i === 0 && !nums.length); i += chunkSize) {
    const part = nums.slice(i, i + chunkSize);
    const parts = [tag, ...idHeader];
    for (const n of part) parts.push((n >> 8) & 0xff, n & 0xff);
    codes.push('S1' + bytesToB64url(new Uint8Array(parts)));
    if (!nums.length) break;
  }
  return codes;
}

// 單段進度同步碼 → { profileId, ids }
export function decodeSync(code) {
  if (!_idToIdx) buildMaps();
  const m = String(code || '').trim().match(/S1([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error('進度同步碼格式不符（應以 S1 開頭）');
  const bytes = b64urlToBytes(m[1]);
  let p = 0;
  const tag = bytes[p++];
  let profileId;
  if (tag === 0) {
    const len = bytes[p++];
    profileId = new TextDecoder().decode(bytes.slice(p, p + len));
    p += len;
  } else {
    profileId = TAG_PROFILE[tag];
    if (!profileId) throw new Error('進度同步碼內的學生代號無法辨識');
  }
  const ids = [];
  for (; p + 1 < bytes.length; p += 2) {
    const n = (bytes[p] << 8) | bytes[p + 1];
    const id = _idxToId[n];
    if (id) ids.push(id);
  }
  return { profileId, ids };
}

// 從任意貼上的文字（整段報告、多段同步碼…）抓出所有完成碼與同步碼
export function extractCodes(text) {
  const s = String(text || '');
  return {
    completions: s.match(/C1[A-Za-z0-9\-_]{2,}/g) || [],
    syncs: s.match(/S1[A-Za-z0-9\-_]{2,}/g) || [],
  };
}

// 完成碼 → { profileId, batches: [{ batchId, ids }] }
export function decodeCompletion(code) {
  if (!_idToIdx) buildMaps();
  const raw = String(code || '').trim();
  const m = raw.match(/C1([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error('完成碼格式不符（應包含 C1 開頭的一串碼）');
  const bytes = b64urlToBytes(m[1]);
  let p = 0;
  const tag = bytes[p++];
  let profileId;
  if (tag === 0) {
    const len = bytes[p++];
    profileId = new TextDecoder().decode(bytes.slice(p, p + len));
    p += len;
  } else {
    profileId = TAG_PROFILE[tag];
    if (!profileId) throw new Error('完成碼內的學生代號無法辨識');
  }
  const batches = [];
  while (p + 3 < bytes.length) {
    const batchId = (bytes[p] << 8) | bytes[p + 1];
    const count = (bytes[p + 2] << 8) | bytes[p + 3];
    p += 4;
    const ids = [];
    for (let k = 0; k < count && p + 1 < bytes.length; k++, p += 2) {
      const n = (bytes[p] << 8) | bytes[p + 1];
      const id = _idxToId[n];
      if (id) ids.push(id);
    }
    batches.push({ batchId, ids });
  }
  return { profileId, batches };
}
