// stats.js — 學習統計、連續天數(streak)、匯出/匯入備份

import {
  getRecordsByProfile, getDailyLogsByProfile, getDailyLog,
  putRecords, putDailyLog, clearProfileData, getProfile, putProfile,
  getCustomBooksByProfile, putCustomBook, getTestResultsByProfile, putTestResult,
} from './db.js';
import { displayCategory } from './srs.js';
import { todayStr, daysBetween } from './util.js';
import { allWords } from './vocab.js';

// 各身分的狀態統計（涵蓋全六級，四階段）
export async function getStats(profileId, now = Date.now()) {
  const recs = await getRecordsByProfile(profileId);
  let masteredCore = 0, proficient = 0, weak = 0, newCount = 0;
  for (const r of recs) {
    const c = displayCategory(r.status);
    if (c === 'mastered') masteredCore++;
    else if (c === 'proficient') proficient++;
    else if (c === 'new') newCount++;
    else weak++;
  }
  // 「已熟記比例」依規格＝已熟記(🌳)＋穩固(🌲)
  const mastered = masteredCore + proficient;
  const tracked = recs.length;
  const totalVocab = allWords().length;

  const today = todayStr(new Date(now));
  const todayLog = await getDailyLog(profileId, today);

  const streak = await getStreak(profileId, now);
  const recent = await getRecentAccuracy(profileId, 7, now);

  return {
    tracked,             // 已納入學習（有紀錄）的字數
    totalVocab,          // 全六級總字數
    mastered,            // 已熟記＋穩固（供報告「已熟記」總數）
    masteredCore,        // 🌳 已熟記（嚴格）
    proficient,          // 🌲 穩固
    weak, newCount,
    masteredPct: tracked ? Math.round((mastered / tracked) * 100) : 0,
    newPct: tracked ? Math.round((newCount / tracked) * 100) : 0,
    todayNew: todayLog ? todayLog.newWords.length : 0,
    todayReview: todayLog ? todayLog.reviewCount : 0,
    todayAnswer: todayLog ? todayLog.answerCount : 0,
    todayCorrect: todayLog ? todayLog.correctCount : 0,
    todayAccuracy: todayLog && todayLog.answerCount
      ? Math.round((todayLog.correctCount / todayLog.answerCount) * 100) : 0,
    streak,
    recentAccuracy: recent,
  };
}

// 連續學習天數：從今天（或昨天）往回數，每天 answerCount>0 即算
export async function getStreak(profileId, now = Date.now()) {
  const logs = await getDailyLogsByProfile(profileId);
  const studied = new Set(logs.filter((l) => l.answerCount > 0).map((l) => l.date));
  const today = todayStr(new Date(now));
  let streak = 0;
  // 若今天還沒練，從昨天起算（避免今天未練就歸零）
  let start = studied.has(today) ? 0 : 1;
  for (let i = start; ; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (studied.has(todayStr(d))) streak++;
    else break;
  }
  return streak;
}

// 近 N 日作答正確率
export async function getRecentAccuracy(profileId, days = 7, now = Date.now()) {
  const logs = await getDailyLogsByProfile(profileId);
  const cutoff = todayStr(new Date(now - (days - 1) * 24 * 60 * 60 * 1000));
  let ans = 0, cor = 0;
  for (const l of logs) {
    if (daysBetween(l.date, cutoff) >= 0) {
      ans += l.answerCount || 0;
      cor += l.correctCount || 0;
    }
  }
  return ans ? Math.round((cor / ans) * 100) : 0;
}

// ---------- 匯出 / 匯入（JSON 備份） ----------
export async function exportProfile(profileId) {
  const profile = await getProfile(profileId);
  const records = await getRecordsByProfile(profileId);
  const dailyLogs = await getDailyLogsByProfile(profileId);
  const customBooks = await getCustomBooksByProfile(profileId);
  const testResults = await getTestResultsByProfile(profileId);
  return {
    app: 'vocab-memory',
    version: 2,
    exportedAt: new Date().toISOString(),
    profile,
    records,
    dailyLogs,
    customBooks,
    testResults,
  };
}

export async function importProfile(data, targetProfileId = null) {
  if (!data || data.app !== 'vocab-memory') {
    throw new Error('檔案格式不符（不是本系統的備份）');
  }
  const pid = targetProfileId || (data.profile && data.profile.id);
  if (!pid) throw new Error('找不到身分 id');

  // 覆蓋：先清空該身分既有資料
  await clearProfileData(pid);

  // 還原 profile 設定（保留現有名稱亦可，這裡採備份內容）
  if (data.profile) {
    const p = { ...data.profile, id: pid };
    await putProfile(p);
  }

  // 重新指定 key 與 profileId
  const recs = (data.records || []).map((r) => ({
    ...r, profileId: pid, key: `${pid}::${r.wordId}`,
  }));
  await putRecords(recs);

  for (const l of data.dailyLogs || []) {
    await putDailyLog({ ...l, profileId: pid, key: `${pid}::${l.date}` });
  }
  // v2 備份：自訂單字本 + 測驗成績（舊備份沒有這些欄位則略過）
  for (const bk of data.customBooks || []) {
    await putCustomBook({ ...bk, profileId: pid });
  }
  for (const tr of data.testResults || []) {
    await putTestResult({ ...tr, profileId: pid });
  }
  return recs.length;
}
