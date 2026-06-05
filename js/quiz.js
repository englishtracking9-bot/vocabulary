// quiz.js — 出題、答案比對、精熟迴圈、每日紀錄
// 出題優先序：① 今日到期複習 → ② 新字（每日新字上限，預設優先 Level 4–6）

import {
  getDueRecords, getNewRecords, getRecordsByProfile,
  getRecord, putRecord, getDailyLog, putDailyLog, dailyKey,
} from './db.js';
import { wordsByLevels } from './vocab.js';
import { newRecord, applyAnswer } from './srs.js';
import { shuffle, interleave, todayStr } from './util.js';

// 建立今日出題佇列。回傳 [{wordId, level, kind}]
// kind: 'review' | 'new-lookup' | 'new-fresh'
export async function buildQueue(profile, now = Date.now()) {
  const pid = profile.id;
  const s = profile.settings || {};
  const dailyNewLimit = s.dailyNewLimit || 20;

  // ① 今日到期複習
  const due = await getDueRecords(pid, now);
  const reviewItems = interleave(
    due.map((r) => ({ wordId: r.wordId, level: r.level, kind: 'review' })),
    (it) => String(it.level)
  );

  // 今日已新學數量 → 計算剩餘新字配額
  const today = todayStr(new Date(now));
  const log = await getDailyLog(pid, today);
  const introduced = log ? log.newWords.length : 0;
  let remaining = Math.max(0, dailyNewLimit - introduced);

  const newItems = [];
  const takenIds = new Set(reviewItems.map((it) => it.wordId));

  // ②-a 先排「查過但未測」的新字（孩子主動查的字）
  if (remaining > 0) {
    const lookNew = await getNewRecords(pid);
    for (const r of lookNew) {
      if (remaining <= 0) break;
      if (takenIds.has(r.wordId)) continue;
      newItems.push({ wordId: r.wordId, level: r.level, kind: 'new-lookup' });
      takenIds.add(r.wordId);
      remaining--;
    }
  }

  // ②-b 再從設定級別補新字（預設優先 Level 4–6）
  if (remaining > 0) {
    const allRecs = await getRecordsByProfile(pid);
    const existing = new Set(allRecs.map((r) => r.wordId));
    const levels = s.levels && s.levels.length ? s.levels : [4, 5, 6];
    const priority = (s.priorityLevels && s.priorityLevels.length ? s.priorityLevels : [4, 5, 6])
      .filter((l) => levels.includes(l));

    const candidates = wordsByLevels(levels)
      .filter((e) => !existing.has(e.id) && !takenIds.has(e.id));
    const pr = shuffle(candidates.filter((e) => priority.includes(e.level)));
    const rest = shuffle(candidates.filter((e) => !priority.includes(e.level)));
    for (const e of pr.concat(rest)) {
      if (remaining <= 0) break;
      newItems.push({ wordId: e.id, level: e.level, kind: 'new-fresh' });
      takenIds.add(e.id);
      remaining--;
    }
  }

  const newInterleaved = interleave(newItems, (it) => String(it.level));
  // 複習優先在前，新字在後（各自已交錯分散級別）
  return reviewItems.concat(newInterleaved);
}

// 精熟迴圈 Session：管理本回合佇列，答錯的字稍後重新插入直到答對
export class Session {
  constructor(items) {
    this.queue = items.slice(); // [{wordId, level, kind}]
    this.wrongOnce = new Set(); // 本回合曾答錯的字（用於品質降級）
    this.done = 0; // 已「過關」字數
    this.totalTarget = items.length; // 本回合不重複字數
  }

  get remaining() {
    return this.queue.length;
  }

  current() {
    return this.queue[0] || null;
  }

  // 答錯：把當前字往後插入（約 3 題之後再出現）
  requeueCurrent() {
    const item = this.queue.shift();
    if (!item) return;
    this.wrongOnce.add(item.wordId);
    const pos = Math.min(this.queue.length, 3);
    this.queue.splice(pos, 0, item);
  }

  // 答對：移除當前字、前進
  advance() {
    this.queue.shift();
    this.done++;
  }

  wasWrongBefore(wordId) {
    return this.wrongOnce.has(wordId);
  }
}

// 記錄一次作答，更新 SM-2 紀錄與每日紀錄。回傳更新後的 rec。
export async function recordAnswer(profile, entry, correct, usedHint, secondTry, now = Date.now()) {
  let quality;
  if (!correct) quality = 'again';
  else if (usedHint || secondTry) quality = 'hard';
  else quality = 'good';

  let rec = await getRecord(profile.id, entry.id);
  if (!rec) rec = newRecord(profile.id, entry.id, entry.level, now);
  const wasNew = rec.attempts === 0;

  applyAnswer(rec, quality, now);
  await putRecord(rec);

  await updateDailyLog(profile.id, entry.id, wasNew, correct, now);
  return rec;
}

async function updateDailyLog(pid, wordId, wasNew, correct, now) {
  const date = todayStr(new Date(now));
  let log = await getDailyLog(pid, date);
  if (!log) {
    log = {
      key: dailyKey(pid, date), profileId: pid, date,
      newWords: [], reviewCount: 0, answerCount: 0, correctCount: 0,
    };
  }
  log.answerCount += 1;
  if (correct) log.correctCount += 1;
  if (wasNew) {
    if (!log.newWords.includes(wordId)) log.newWords.push(wordId);
  } else {
    log.reviewCount += 1;
  }
  await putDailyLog(log);
}
