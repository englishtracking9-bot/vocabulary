// paircode.js — L-3c 出題碼：把「要考哪些字的 id 清單＋題型」編成短字串（離線、免雲端）
// 作法：用 vocab.json 的順序給每個字一個 index（0..6007），每個 index 用 2 byte 打包，
// 再轉 base64url。20 個字約 40 bytes → base64 約 54 字元，QR 容易掃。不含任何個資/成績。
// V1：純 id 清單（題型預設拼字＋造句）。V2：第 1 個 byte 是題型旗標（bit0 拼字、bit1 造句），其後為 id。
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

// 把 wordId 清單＋題型編成出題碼字串（V2）。types: { spelling, sentence }
export function encodeWordIds(ids, types = { spelling: true, sentence: true }) {
  if (!_idToIdx) buildMaps();
  const nums = encodableIds(ids).map((id) => _idToIdx.get(id));
  const flags = (types.spelling !== false ? 1 : 0) | (types.sentence !== false ? 2 : 0);
  const bytes = new Uint8Array(1 + nums.length * 2);
  bytes[0] = flags;
  nums.forEach((n, i) => { bytes[1 + i * 2] = (n >> 8) & 0xff; bytes[2 + i * 2] = n & 0xff; });
  return 'V2' + bytesToB64url(bytes);
}

// 解出題碼字串 → { ids, types }。相容 V1（純 id，題型＝拼字＋造句）與 V2。
export function decodeCode(code) {
  if (!_idToIdx) buildMaps();
  const raw = String(code || '').trim();
  const m = raw.match(/V([12])([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error('出題碼格式不符（應以 V1 或 V2 開頭）');
  const ver = m[1];
  const bytes = b64urlToBytes(m[2]);
  let types = { spelling: true, sentence: true };
  let start = 0;
  if (ver === '2') {
    const flags = bytes[0];
    types = { spelling: !!(flags & 1), sentence: !!(flags & 2) };
    if (!types.spelling && !types.sentence) types = { spelling: true, sentence: true };
    start = 1;
  }
  const ids = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const n = (bytes[i] << 8) | bytes[i + 1];
    const id = _idxToId[n];
    if (id) ids.push(id);
  }
  return { ids, types };
}
