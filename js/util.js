// util.js — 共用小工具

// 本地日期字串 YYYY-MM-DD（依使用者裝置時區）
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 友善顯示日期 YYYY/MM/DD
export function prettyDate(dateStr) {
  return dateStr.replace(/-/g, '/');
}

// Fisher–Yates 洗牌（就地）
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 交錯排序：把同 level / 同 root 的字盡量分開（簡易作法：先依群組分桶再輪流取）
export function interleave(items, keyFn) {
  const buckets = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  const lists = [...buckets.values()].map((l) => shuffle(l));
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const l of lists) {
      if (l.length) {
        out.push(l.shift());
        added = true;
      }
    }
  }
  return out;
}

// 計算兩個日期字串相差天數（a - b）
export function daysBetween(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00');
  const b = new Date(bStr + 'T00:00:00');
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

// HTML 轉義
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
