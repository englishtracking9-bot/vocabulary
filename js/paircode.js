// paircode.js — 出題碼＋完成碼：家長電腦 ↔ 孩子手機的離線傳碼（免雲端）
// 作法：用 vocab.json 的順序給每個字一個 index（0..6007），每個 index 用 2 byte 打包，
// 再轉 base64url。20 個字約 40 bytes → base64 約 54 字元，QR 容易掃。不含任何個資/成績。
// 出題碼（家長→孩子）：
//   V1：純 id 清單（題型預設拼字＋造句）
//   V2：第 1 byte 題型旗標（bit0 拼字、bit1 造句），其後為 id
//   V3：題型旗標(1) + 批次編號 batchId(2) + id*2 —— batchId 供完成碼回報對帳
// 完成碼（孩子→家長，N 計畫）：
//   C1：學生代號(1，0=自訂身分時後接 len+utf8 id) + [batchId(2)+字數(2)+id*2]×批次
//   只帶「做了哪些字」，不帶成績，碼才短（30 字約 90 字元，可貼 LINE 或以 QR 呈現）
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

// 把 wordId 清單＋題型（＋批次編號）編成出題碼字串。types: { spelling, sentence }
// 有 batchId → V3；沒有 → V2（維持既有呼叫端行為）
export function encodeWordIds(ids, types = { spelling: true, sentence: true }, batchId = null) {
  if (!_idToIdx) buildMaps();
  const nums = encodableIds(ids).map((id) => _idToIdx.get(id));
  const flags = (types.spelling !== false ? 1 : 0) | (types.sentence !== false ? 2 : 0);
  const head = batchId != null ? 3 : 1;
  const bytes = new Uint8Array(head + nums.length * 2);
  bytes[0] = flags;
  if (batchId != null) { bytes[1] = (batchId >> 8) & 0xff; bytes[2] = batchId & 0xff; }
  nums.forEach((n, i) => { bytes[head + i * 2] = (n >> 8) & 0xff; bytes[head + 1 + i * 2] = n & 0xff; });
  return (batchId != null ? 'V3' : 'V2') + bytesToB64url(bytes);
}

// 解出題碼字串 → { ids, types, batchId }。相容 V1（純 id）/ V2（＋題型）/ V3（＋批次編號）。
export function decodeCode(code) {
  if (!_idToIdx) buildMaps();
  const raw = String(code || '').trim();
  const m = raw.match(/V([123])([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error('出題碼格式不符（應以 V1、V2 或 V3 開頭）');
  const ver = m[1];
  const bytes = b64urlToBytes(m[2]);
  let types = { spelling: true, sentence: true };
  let batchId = null;
  let start = 0;
  if (ver === '2' || ver === '3') {
    const flags = bytes[0];
    types = { spelling: !!(flags & 1), sentence: !!(flags & 2) };
    if (!types.spelling && !types.sentence) types = { spelling: true, sentence: true };
    start = 1;
  }
  if (ver === '3') {
    batchId = (bytes[1] << 8) | bytes[2];
    start = 3;
  }
  const ids = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const n = (bytes[i] << 8) | bytes[i + 1];
    const id = _idxToId[n];
    if (id) ids.push(id);
  }
  return { ids, types, batchId };
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
