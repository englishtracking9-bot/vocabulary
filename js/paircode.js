// paircode.js — L-3c 出題碼：把「要考哪些字的 id 清單」編成短字串（離線、免雲端）
// 作法：用 vocab.json 的順序給每個字一個 index（0..6007），每個 index 用 2 byte 打包，
// 再轉 base64url。20 個字約 40 bytes → base64 約 54 字元，QR 容易掃。不含任何個資/成績。

import { allWords } from './vocab.js';

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

// 把 wordId 清單編成出題碼字串（前綴 V1）
export function encodeWordIds(ids) {
  if (!_idToIdx) buildMaps();
  const nums = ids.map((id) => _idToIdx.get(id)).filter((n) => n != null);
  const bytes = new Uint8Array(nums.length * 2);
  nums.forEach((n, i) => { bytes[i * 2] = (n >> 8) & 0xff; bytes[i * 2 + 1] = n & 0xff; });
  return 'V1' + bytesToB64url(bytes);
}

// 解出題碼字串 → wordId 陣列（找不到的 index 會略過）
export function decodeCode(code) {
  if (!_idToIdx) buildMaps();
  const raw = String(code || '').trim();
  const m = raw.match(/V1([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error('出題碼格式不符（應以 V1 開頭）');
  const bytes = b64urlToBytes(m[1]);
  const ids = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const n = (bytes[i] << 8) | bytes[i + 1];
    const id = _idxToId[n];
    if (id) ids.push(id);
  }
  return ids;
}
