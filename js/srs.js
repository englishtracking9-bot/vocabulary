// srs.js — 間隔重複（SM-2）與熟記狀態機
// K-1：修正「當天學、隔天不出現複習」的 bug（到期時間對齊到整天）＋ 四階段精熟標準。

export const DAY_MS = 24 * 60 * 60 * 1000;

// 作答品質
export const QUALITY = {
  good: 5, // 一次就答對、未用提示
  hard: 3, // 答對但用了提示或第二次才對
  again: 0, // 答錯
};

// 取某時間戳當天的本地 00:00（用來把到期時間對齊到「整天」）。
// 修正關鍵 bug：原本 due = now + interval*DAY，造成「下午學的字、隔天下午才到期」，
// 孩子隔天上午打開測驗就看不到。對齊到當天 00:00 後，「隔 1 天」＝隔天整天都會出現。
export function dayStart(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

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
// 間隔成長：第1次對→1天；第2次對→6天；之後→前一間隔×ef（典型 1→6→15→37→92）。
export function applyAnswer(rec, quality, now = Date.now()) {
  const q = QUALITY[quality];
  rec.attempts += 1;

  if (quality === 'again') {
    // 答錯：reps 歸零、隔 1 天重新學、標記需加強
    rec.reps = 0;
    rec.interval = 0;
    rec.streak = 0;
    rec.lastResult = 'wrong';
    rec.status = 'weak';
    // 隔 1 天重新學（對齊到隔天 00:00）。當日精熟回合內的「稍後再出現」由 Session 在記憶體中處理，不靠 due。
    rec.due = dayStart(now) + 1 * DAY_MS;
    // ef 仍依公式下調
    rec.ef = Math.max(1.3, rec.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  } else {
    // 答對（good 或 hard）
    rec.correct += 1;
    rec.streak += 1;
    rec.reps += 1;
    rec.lastResult = 'correct';

    if (rec.reps === 1) rec.interval = 1;
    else if (rec.reps === 2) rec.interval = 6;
    else rec.interval = Math.round(rec.interval * rec.ef);

    rec.ef = Math.max(1.3, rec.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    // 對齊到「到期日 00:00」：今天學的字 interval=1 → 隔天整天都會被排入複習。
    rec.due = dayStart(now) + rec.interval * DAY_MS;

    rec.status = computeStatus(rec);
  }

  rec.updatedAt = now;
  return rec;
}

// K-1b 四階段精熟標準：
//   🌱 new（未測驗）：attempts===0
//   🌿 learning（學習中／需加強）：考過但 reps<3 或 interval<7；或答錯歸零(weak)
//   🌳 mastered（已熟記）：連續答對 ≥3 次 且 interval ≥7（因 interval 跨天成長，等同「跨多天的對」）
//   🌲 proficient（穩固）：interval ≥21 仍答對（長期記憶）
export function computeStatus(rec) {
  if (rec.attempts === 0) return 'new';
  if (rec.lastResult === 'wrong') return 'weak';
  if (rec.reps >= 3 && rec.interval >= 21) return 'proficient';
  if (rec.reps >= 3 && rec.interval >= 7) return 'mastered';
  return 'learning';
}

// 顯示分類（四階段）：new / weak / mastered / proficient（learning 併入 weak「學習中」）
export function displayCategory(status) {
  if (status === 'new') return 'new';
  if (status === 'mastered') return 'mastered';
  if (status === 'proficient') return 'proficient';
  return 'weak'; // learning 與 weak 都顯示為「學習中／需加強」
}

// 是否屬「已熟記家族」（已熟記＋穩固）——用於熟記比例、字根家族錨點字等。
export function isMasteredFamily(status) {
  const c = displayCategory(status);
  return c === 'mastered' || c === 'proficient';
}

export const STATUS_LABEL = {
  new: '🌱 未測驗',
  weak: '🌿 學習中',
  mastered: '🌳 已熟記',
  proficient: '🌲 穩固',
};

// 各階段一句話說明（顯示給孩子看）
export const STATUS_DESC = {
  new: '還沒考過',
  weak: '考過但還要再練幾天',
  mastered: '連續多天答對，記住了',
  proficient: '隔很多天仍答對，長期記憶',
};

// 依顯示分類取得徽章文字
export function statusBadge(status) {
  return STATUS_LABEL[displayCategory(status)];
}
