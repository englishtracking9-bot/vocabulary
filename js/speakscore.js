// speakscore.js — 口說評分（純函式，不碰 DOM，可用 node 測）
// 滿分 100 ＝ 發音 45 ＋ 完整度 35 ＋ 語調與流暢 20
// 資料來源：瀏覽器語音辨識（文字＋信心值＋多個候選）、說話時間、麥克風音高曲線（可能沒有）。
// ⚠️ 這是「免費、在手機上直接算」的近似評分，不是音素級的專業發音評測。

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numToWords(n) {
  if (n < 20) return NUM[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + NUM[n % 10] : '');
  if (n === 100) return 'one hundred';
  return String(n);
}

// 句子 → 單字陣列（小寫、去標點、數字轉英文、連字號拆開）
export function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[—–\-/]/g, ' ')
    .replace(/\b(\d{1,3})\b/g, (m) => numToWords(Number(m)))
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

export function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - d[m][n] / Math.max(m, n);
}

// 目標字 vs 辨識字 的對齊（LCS，完全相同才算配對）→ 每個目標字的配對索引或 -1
function align(target, heard) {
  const m = target.length, n = heard.length;
  const L = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      L[i][j] = target[i] === heard[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const map = Array(m).fill(-1);
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (target[i] === heard[j]) { map[i] = j; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return map;
}

// 逐字判定：ok（完全對）／near（像但不完全對）／miss（沒唸到或唸錯）
export function wordMarks(targetText, heardText) {
  const target = tokenize(targetText);
  const heard = tokenize(heardText);
  const map = align(target, heard);
  const used = new Set(map.filter((x) => x >= 0));
  return target.map((w, i) => {
    if (map[i] >= 0) return { word: w, mark: 'ok', sim: 1 };
    // 在前後配對字之間找最像的未用字
    let lo = -1, hi = heard.length;
    for (let k = i - 1; k >= 0; k--) if (map[k] >= 0) { lo = map[k]; break; }
    for (let k = i + 1; k < target.length; k++) if (map[k] >= 0) { hi = map[k]; break; }
    let best = 0, bestJ = -1;
    for (let j = lo + 1; j < hi; j++) {
      if (used.has(j)) continue;
      const s = similarity(w, heard[j]);
      if (s > best) { best = s; bestJ = j; }
    }
    if (best >= 0.5) { used.add(bestJ); return { word: w, mark: 'near', sim: best, heard: heard[bestJ] }; }
    return { word: w, mark: 'miss', sim: 0 };
  });
}

// 多個辨識候選中，挑和目標最接近的一個
export function pickBestAlternative(targetText, alternatives) {
  let best = null, bestScore = -1;
  for (const alt of alternatives || []) {
    const marks = wordMarks(targetText, alt.transcript);
    const s = marks.reduce((a, m) => a + (m.mark === 'ok' ? 1 : m.mark === 'near' ? m.sim * 0.6 : 0), 0);
    if (s > bestScore) { bestScore = s; best = alt; }
  }
  return best;
}

// 音高曲線（Hz，0＝無聲）→ 語調分數 0–100，沒有資料回傳 null
export function intonationScore(pitches, targetText) {
  const voiced = (pitches || []).filter((p) => p > 60 && p < 500);
  if (voiced.length < 8) return null;
  const st = voiced.map((p) => 12 * Math.log2(p / 100)); // 半音
  const mean = st.reduce((a, b) => a + b, 0) / st.length;
  const sd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length);
  // 起伏：太平（像機器人）或太亂都扣分；1.8–6 半音最自然
  let s;
  if (sd < 0.8) s = 40;
  else if (sd < 1.8) s = 40 + (sd - 0.8) * 50;      // 40→90
  else if (sd <= 6) s = 95;
  else s = Math.max(60, 95 - (sd - 6) * 8);
  // 句尾：直述句句尾下降、問句句尾上揚 → 加分
  const tail = st.slice(-Math.max(3, Math.floor(st.length * 0.2)));
  const body = st.slice(0, Math.max(1, st.length - tail.length));
  const tailM = tail.reduce((a, b) => a + b, 0) / tail.length;
  const bodyM = body.reduce((a, b) => a + b, 0) / body.length;
  const isQuestion = /\?\s*$/.test(String(targetText || '').trim());
  const ok = isQuestion ? tailM > bodyM + 0.5 : tailM < bodyM - 0.3;
  s += ok ? 5 : -5;
  return Math.round(Math.max(0, Math.min(100, s)));
}

// 語速 → 流暢分數 0–100，沒有時間資料回傳 null
export function fluencyScore(wordCount, seconds) {
  if (!seconds || seconds < 0.3 || !wordCount) return null;
  const wpm = wordCount / (seconds / 60);
  if (wpm >= 95 && wpm <= 175) return 100;
  if (wpm < 95) return Math.round(Math.max(30, 100 - (95 - wpm) * 1.2));
  return Math.round(Math.max(50, 100 - (wpm - 175) * 0.8));
}

/**
 * 主評分
 * @param {string} targetText 目標句子
 * @param {{transcript:string, confidence:number}[]} alternatives 辨識候選
 * @param {{seconds?:number, pitches?:number[]}} extra
 */
export function scoreSpeech(targetText, alternatives, extra = {}) {
  const target = tokenize(targetText);
  const best = pickBestAlternative(targetText, alternatives) || { transcript: '', confidence: 0 };
  const marks = wordMarks(targetText, best.transcript);
  const n = target.length || 1;
  const heardCount = tokenize(best.transcript).length;

  // 完整度：唸到的字比例（像的字算半個）
  const okN = marks.filter((m) => m.mark === 'ok').length;
  const nearSum = marks.filter((m) => m.mark === 'near').reduce((a, m) => a + m.sim, 0);
  const completeness = Math.round(Math.min(1, (okN + nearSum * 0.5) / n) * 100);

  // 發音：有唸出來的字，聽起來有多準（完全對 × 辨識信心；像的字依相似度打折）
  let conf = Number(best.confidence);
  if (!(conf > 0 && conf <= 1)) conf = 0.85; // 部分瀏覽器不回傳信心值
  const confFactor = 0.6 + 0.4 * Math.min(1, conf / 0.9);
  const attempted = marks.filter((m) => m.mark !== 'miss');
  let pronunciation = 0;
  if (attempted.length) {
    const per = attempted.map((m) => (m.mark === 'ok' ? 100 : m.sim * 65));
    pronunciation = per.reduce((a, b) => a + b, 0) / per.length * confFactor;
    // 漏太多字時，發音分不應該還很高
    pronunciation *= 0.5 + 0.5 * (attempted.length / n);
  }
  pronunciation = Math.round(pronunciation);

  // 語調與流暢
  const flu = fluencyScore(heardCount, extra.seconds);
  const into = intonationScore(extra.pitches, targetText);
  let prosody;
  if (into != null && flu != null) prosody = into * 0.6 + flu * 0.4;
  else if (into != null) prosody = into;
  else if (flu != null) prosody = flu;
  else prosody = completeness >= 60 ? 75 : 40;
  if (!heardCount) prosody = 0;
  prosody = Math.round(prosody);

  const total = Math.round(pronunciation * 0.45 + completeness * 0.35 + prosody * 0.2);

  return {
    total, pronunciation, completeness, prosody,
    intonation: into, fluency: flu,
    transcript: best.transcript, confidence: best.confidence,
    marks,
    prosodySource: into != null ? 'pitch' : flu != null ? 'rate' : 'estimate',
  };
}

export function scoreComment(r) {
  if (r.total >= 90) return '太棒了！發音清楚、句子完整 🎉';
  if (r.total >= 75) return '很不錯！再注意紅色的字就更完美了';
  if (r.total >= 60) return '有進步空間：先聽示範，再慢慢唸一次';
  if (!r.transcript) return '沒有聽到聲音，靠近手機再試一次';
  return '先按「聽示範」跟著唸，一個字一個字唸清楚';
}

export function scoreTips(r) {
  const tips = [];
  if (r.completeness < 80) tips.push('有字沒唸到：句子要從頭唸到尾，不要跳字');
  if (r.pronunciation < 75) tips.push('發音：紅色／橘色的字多聽幾次示範再跟讀');
  if (r.intonation != null && r.intonation < 70) tips.push('語調太平：重要的字（例如目標單字）唸重一點，句尾自然往下');
  if (r.fluency != null && r.fluency < 70) tips.push('速度：太慢或停頓太多，試著一口氣唸完；太快的話放慢一點');
  return tips;
}
