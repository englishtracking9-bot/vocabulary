// tests.js — K-2 周測 / 月測 / 自訂測驗：抽題、成績存檔、與上次比較
// 觀念：平時 SM-2 每日複習是主力；周測/月測是「檢驗＋查漏」，結果回寫 SM-2（在 app.js 出題流程處理）。

import {
  getRecordsByProfile, getDailyLogsByProfile,
  putTestResult, getTestResultsByType, getTestResultsByProfile,
} from './db.js';
import { getById } from './vocab.js';
import { shuffle, todayStr, daysBetween } from './util.js';
import { wordsInTag } from './tags.js';

// 最近 N 天「學過或複習過」的字（從每日紀錄彙整）。回傳 wordId 陣列（去重、確認字典中存在）。
export async function recentWordIds(profileId, days, now = Date.now()) {
  const logs = await getDailyLogsByProfile(profileId);
  const cutoff = todayStr(new Date(now - (days - 1) * 24 * 60 * 60 * 1000));
  const set = new Set();
  for (const l of logs) {
    if (daysBetween(l.date, cutoff) < 0) continue; // 早於視窗
    (l.newWords || []).forEach((id) => set.add(id));
    (l.reviewWords || []).forEach((id) => set.add(id));
    (l.wrong || []).forEach((w) => set.add(w.wordId));
  }
  return [...set].filter((id) => getById(id));
}

// 某級別、已納入學習（有紀錄）的字
export async function levelWordIds(profileId, level) {
  const recs = await getRecordsByProfile(profileId);
  return recs.filter((r) => String(r.level) === String(level) && getById(r.wordId)).map((r) => r.wordId);
}

// 群組（標籤）內的字
export async function groupWordIds(profileId, tagId) {
  return (await wordsInTag(profileId, tagId)).filter((id) => getById(id));
}

// 全部「我的單字」（有紀錄）
export async function allMyWordIds(profileId) {
  const recs = await getRecordsByProfile(profileId);
  return recs.filter((r) => getById(r.wordId)).map((r) => r.wordId);
}

// 隨機抽 count 個
export function sample(ids, count) {
  return shuffle(ids.slice()).slice(0, Math.max(0, count));
}

// 存一筆測驗成績
export async function saveTestResult({ profileId, type, name, total, correct, wrong, now = Date.now() }) {
  const result = {
    id: `${profileId}::${now}::${Math.random().toString(36).slice(2, 7)}`,
    profileId, type, name,
    date: todayStr(new Date(now)),
    total, correct,
    scorePct: total ? Math.round((correct / total) * 100) : 0,
    wrong: wrong || [],
    createdAt: now,
  };
  await putTestResult(result);
  return result;
}

// 取同類測驗的「上一次」成績（排除剛存的這筆 id）。可選 name：同名才算同一份（單字本用）。
export async function previousResult(profileId, type, excludeId, name = null) {
  const all = await getTestResultsByType(profileId, type);
  return all
    .filter((r) => r.id !== excludeId && (name == null || r.name === name))
    .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

// 全部成績（新到舊）
export async function allResults(profileId) {
  const all = await getTestResultsByProfile(profileId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const TYPE_LABEL = { weekly: '📅 週測', monthly: '🗓 月測', custom: '🎯 自訂測驗', book: '📓 單字本測驗' };
