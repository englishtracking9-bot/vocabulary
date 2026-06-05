// srs.js — 間隔重複（SM-2）與熟記狀態機
// 依規格第五節實作。

export const DAY_MS = 24 * 60 * 60 * 1000;

// 作答品質
export const QUALITY = {
  good: 5, // 一次就答對、未用提示
  hard: 3, // 答對但用了提示或第二次才對
  again: 0, // 答錯
};

// 建立一筆全新的學習紀錄（status:new，尚未測驗）
export function newRecord(profileId, wordId, level, now = Date.now()) {
  return {
    key: `${profileId}::${wordId}`,
    profileId,
    wordId,
    level,
    status: 'new',
    reps: 0,
    ef: 2.5,
    interval: 0,
    due: now, // 立即可被排入
    streak: 0,
    attempts: 0,
    correct: 0,
    lastResult: null, // 'correct' | 'wrong'
    addedAt: now,
    updatedAt: now,
  };
}

// 依 SM-2 更新紀錄。quality: 'good' | 'hard' | 'again'
// 回傳更新後的 rec（就地修改並回傳）
export function applyAnswer(rec, quality, now = Date.now()) {
  const q = QUALITY[quality];
  rec.attempts += 1;

  if (quality === 'again') {
    // 答錯：reps 歸零、今天重學、標記需加強
    rec.reps = 0;
    rec.interval = 0;
    rec.streak = 0;
    rec.lastResult = 'wrong';
    rec.status = 'weak';
    rec.due = now; // 本回合稍後重新出現
    // ef 仍依公式下調
    rec.ef = Math.max(1.3, rec.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  } else {
    // 答對（good 或 hard）
    rec.correct += 1;
    rec.streak += 1;
    rec.reps += 1;
    rec.lastResult = 'correct';

    if (rec.reps === 1) rec.interval = 1;
    else if (rec.reps === 2) rec.interval = 3;
    else rec.interval = Math.round(rec.interval * rec.ef);

    rec.ef = Math.max(1.3, rec.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    rec.due = now + rec.interval * DAY_MS;

    rec.status = computeStatus(rec);
  }

  rec.updatedAt = now;
  return rec;
}

// 依規格判定熟記狀態
// 已熟記：reps>=3 且 interval>=7 且最近一次答對
export function computeStatus(rec) {
  if (rec.attempts === 0) return 'new';
  if (rec.lastResult === 'wrong') return 'weak';
  if (rec.reps >= 3 && rec.interval >= 7 && rec.lastResult === 'correct') return 'mastered';
  return 'learning';
}

// 三大類顯示分類：new / weak / mastered（learning 併入「需加強」）
export function displayCategory(status) {
  if (status === 'new') return 'new';
  if (status === 'mastered') return 'mastered';
  return 'weak'; // learning 與 weak 都顯示為「需加強」
}

export const STATUS_LABEL = {
  new: '🆕 未測驗',
  weak: '📖 需加強',
  mastered: '✅ 已熟記',
};

// 依顯示分類取得徽章文字
export function statusBadge(status) {
  return STATUS_LABEL[displayCategory(status)];
}
