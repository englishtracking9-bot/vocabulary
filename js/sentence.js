// sentence.js — 造句測驗：例句默寫比對與差異標示
// 規則：大小寫與多餘空白不計較、標點寬鬆處理；標出缺字/拼錯/語序不同。

import { esc } from './util.js';

// 單一 token 正規化（去標點、轉小寫）
function normTok(t) {
  return t.toLowerCase().replace(/[.,!?;:'"’“”()\-–—]/g, '').trim();
}

// 切詞，回傳 { orig:[], norm:[] }（長度一致）
function tokenize(s) {
  const orig = (s || '').trim().split(/\s+/).filter(Boolean);
  const norm = orig.map(normTok);
  // 過濾掉正規化後為空者（純標點）
  const o = [], n = [];
  for (let i = 0; i < orig.length; i++) {
    if (norm[i]) { o.push(orig[i]); n.push(norm[i]); }
  }
  return { orig: o, norm: n };
}

// LCS：回傳兩邊「對應到的索引」集合
function lcsMatch(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aMatch = new Set(), bMatch = new Set();
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { aMatch.add(i); bMatch.add(j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { aMatch, bMatch };
}

// 比對使用者句子與標準例句
// 回傳 { correct, userHtml, standardHtml, missing:[], extra:[] }
export function compareSentence(userInput, standard) {
  const u = tokenize(userInput);
  const s = tokenize(standard);
  const { aMatch: uMatch, bMatch: sMatch } = lcsMatch(u.norm, s.norm);

  const correct = u.norm.join(' ') === s.norm.join(' ') && u.norm.length > 0;

  // 使用者句子：未對應到的字（多餘或拼錯）標紅
  const userHtml = u.orig.map((w, i) =>
    uMatch.has(i) ? esc(w) : `<span class="diff-bad">${esc(w)}</span>`
  ).join(' ') || '<span class="diff-bad">（未作答）</span>';

  // 標準例句：未被對應到的字（使用者缺少的）標綠底
  const standardHtml = s.orig.map((w, i) =>
    sMatch.has(i) ? esc(w) : `<span class="diff-miss">${esc(w)}</span>`
  ).join(' ');

  const missing = s.orig.filter((w, i) => !sMatch.has(i));
  const extra = u.orig.filter((w, i) => !uMatch.has(i));

  return { correct, userHtml, standardHtml, missing, extra };
}
