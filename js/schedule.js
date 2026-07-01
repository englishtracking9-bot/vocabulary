// schedule.js — L-3a 家長月排程：整月自動排字，跨日不重複，依字根記憶法分組，可含複習輪。
// 純推導，不寫入孩子的學習日曆；結果存在家長裝置（meta），家長可再手動微調。

import { formDailyGroup, groupsForWords } from './grouping.js';
import { getById } from './vocab.js';

// 產生日期字串陣列（含頭尾）
export function dateRange(startStr, endStr) {
  const out = [];
  const s = new Date(startStr + 'T00:00:00');
  const e = new Date(endStr + 'T00:00:00');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

// 把 wordIds 依記憶點分群（給每天顯示/列印）
function dayGroups(wordIds) {
  return groupsForWords(wordIds).map((g) => ({ label: g.label, memo: g.memo, wordIds: g.wordIds }));
}

// 建立月排程。records：孩子既有紀錄（用來跳過學過的字）。
// opts: { levels, perDay, startDate, endDate, includeReview }
export function buildMonthSchedule(records, opts) {
  const { levels, perDay, startDate, endDate, includeReview = true } = opts;
  const dates = dateRange(startDate, endDate);
  const fakeProfile = { settings: { levels, dailyNewLimit: perDay } };
  const scheduled = new Set(); // 這份排程的「已排清單」（跨整月不重複）
  const days = [];

  // 複習池：孩子已學過（answered）的字，之後用來排複習輪
  const learned = records.filter((r) => (r.attempts || 0) > 0).map((r) => r.wordId).filter((id) => getById(id));
  let reviewCursor = 0;
  let newExhausted = false;

  for (const date of dates) {
    if (!newExhausted) {
      const group = formDailyGroup(fakeProfile, records, perDay, { excludeWordIds: scheduled });
      if (group.wordIds.length) {
        group.wordIds.forEach((id) => scheduled.add(id));
        days.push({ date, kind: 'new', wordIds: group.wordIds, groups: dayGroups(group.wordIds) });
        continue;
      }
      newExhausted = true; // 該級別新字排完
    }
    // 複習輪
    if (includeReview && learned.length) {
      const batch = [];
      for (let k = 0; k < perDay && learned.length; k++) {
        batch.push(learned[reviewCursor % learned.length]);
        reviewCursor++;
      }
      days.push({ date, kind: 'review', wordIds: batch, groups: dayGroups(batch) });
    } else {
      days.push({ date, kind: 'empty', wordIds: [], groups: [] });
    }
  }

  return {
    config: { levels, perDay, startDate, endDate, includeReview },
    createdAt: Date.now(),
    days,
  };
}

// 重排某一天（換一批新字，沿用記憶法分組，避開整份已排的字）
export function regenerateDay(schedule, records, dateStr) {
  const { levels, perDay } = schedule.config;
  const fakeProfile = { settings: { levels, dailyNewLimit: perDay } };
  const scheduled = new Set();
  schedule.days.forEach((d) => { if (d.date !== dateStr) d.wordIds.forEach((id) => scheduled.add(id)); });
  const group = formDailyGroup(fakeProfile, records, perDay, { excludeWordIds: scheduled });
  const day = schedule.days.find((d) => d.date === dateStr);
  if (day) {
    day.wordIds = group.wordIds;
    day.kind = group.wordIds.length ? 'new' : 'empty';
    day.groups = dayGroups(group.wordIds);
  }
  return schedule;
}

// 重新分群某天（加/減字後呼叫）
export function regroupDay(schedule, dateStr) {
  const day = schedule.days.find((d) => d.date === dateStr);
  if (day) day.groups = dayGroups(day.wordIds);
  return schedule;
}

export const KIND_LABEL = { new: '🆕 新字', review: '🔁 複習', empty: '—' };
