// report.js — 每日學習報告（純文字、可一鍵複製貼到 LINE）

import { getStats } from './stats.js';
import { getDailyLog } from './db.js';
import { getById } from './vocab.js';
import { todayStr, prettyDate } from './util.js';

// 產生今日報告純文字
export async function buildDailyReport(profile, now = Date.now()) {
  const date = todayStr(new Date(now));
  const stats = await getStats(profile.id, now);
  const log = await getDailyLog(profile.id, date);

  const newIds = log ? log.newWords : [];
  const newWordsText = formatNewWords(newIds);

  const lines = [];
  lines.push(`📚 [${profile.name}] 英文單字學習報告`);
  lines.push(`📅 ${prettyDate(date)}`);
  lines.push(`今日新學 ${newIds.length} 字：`);
  lines.push(newWordsText || '（今日尚未新學單字）');
  lines.push(`今日複習 ${stats.todayReview} 字，答對率 ${stats.todayAccuracy}%`);
  lines.push(`目前進度（共 ${stats.tracked} 字）：`);
  lines.push(`✅ 已熟記 ${stats.mastered} 字（${stats.masteredPct}%）`);
  lines.push(`📖 需加強 ${stats.weak} 字`);
  lines.push(`🆕 未學習 ${stats.newCount} 字（${stats.newPct}%）`);
  lines.push(`🔥 連續學習 ${stats.streak} 天`);
  lines.push('（由英文單字記憶系統自動產生）');
  return lines.join('\n');
}

// 只複製今日新字清單
export async function buildNewWordsOnly(profile, now = Date.now()) {
  const date = todayStr(new Date(now));
  const log = await getDailyLog(profile.id, date);
  const newIds = log ? log.newWords : [];
  return `📚 [${profile.name}] ${prettyDate(date)} 今日新學 ${newIds.length} 字\n` +
    (formatNewWords(newIds, 999) || '（今日尚未新學單字）');
}

// 本週彙整（近 7 日新學總數與目前進度）
export async function buildWeeklyReport(profile, now = Date.now()) {
  const stats = await getStats(profile.id, now);
  let weekNew = 0;
  const ids = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const log = await getDailyLog(profile.id, todayStr(d));
    if (log) { weekNew += log.newWords.length; ids.push(...log.newWords); }
  }
  const lines = [];
  lines.push(`📚 [${profile.name}] 英文單字「本週彙整」`);
  lines.push(`📅 截至 ${prettyDate(todayStr(new Date(now)))}`);
  lines.push(`近 7 日新學 ${weekNew} 字，近 7 日答對率 ${stats.recentAccuracy}%`);
  lines.push(`目前進度（共 ${stats.tracked} 字）：`);
  lines.push(`✅ 已熟記 ${stats.mastered} 字（${stats.masteredPct}%）`);
  lines.push(`📖 需加強 ${stats.weak} 字`);
  lines.push(`🆕 未學習 ${stats.newCount} 字（${stats.newPct}%）`);
  lines.push(`🔥 連續學習 ${stats.streak} 天`);
  lines.push('（由英文單字記憶系統自動產生）');
  return lines.join('\n');
}

function formatNewWords(ids, maxShow = 8) {
  if (!ids || !ids.length) return '';
  const parts = [];
  for (const id of ids.slice(0, maxShow)) {
    const e = getById(id);
    if (e) parts.push(`${e.word} ${e.zh}`.trim());
  }
  let text = parts.join('、');
  if (ids.length > maxShow) {
    text += `…（共 ${ids.length} 字）`;
  } else {
    text += `（共 ${ids.length} 字）`;
  }
  return text;
}

// 複製到剪貼簿：優先 navigator.clipboard，失敗時 fallback 選取
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fallback 如下 */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}
