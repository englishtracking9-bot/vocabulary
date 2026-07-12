// schedule.js — L-3a 家長月排程：整月自動排字，跨日不重複，依字根記憶法分組，可含複習輪。
// 純推導，不寫入孩子的學習日曆；結果存在家長裝置（meta），家長可再手動微調。

import { formDailyGroup, groupsForWords } from './grouping.js';
import { hasStudied } from './srs.js';
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
// opts: { levels, perDay, startDate, endDate, includeReview, doneWordIds }
// doneWordIds（N 計畫）：孩子透過「完成碼」回報做過的字 —— 不再排入新字、納入複習池。
// （家長電腦通常沒有孩子的作答紀錄，完成碼是電腦知道「孩子做過什麼」的唯一準確來源）
export function buildMonthSchedule(records, opts) {
  const { levels, perDay, startDate, endDate, includeReview = true, doneWordIds = [] } = opts;
  const dates = dateRange(startDate, endDate);
  const fakeProfile = { settings: { levels, dailyNewLimit: perDay } };
  const scheduled = new Set(doneWordIds); // 已做過的字視同已排 → 新字絕不重複
  const days = [];

  // 複習池：本機紀錄有答過的字 ＋ 完成碼回報做過的字
  const learned = [...new Set(
    records.filter(hasStudied).map((r) => r.wordId).concat(doneWordIds)
  )].filter((id) => getById(id));
  let reviewCursor = 0;
  let newExhausted = false;

  for (const date of dates) {
    if (!newExhausted) {
      const group = formDailyGroup(fakeProfile, records, perDay, { excludeWordIds: scheduled, strictLevels: true });
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

// 重排某一天（換一批新字，沿用記憶法分組，避開整份已排的字＋完成碼回報做過的字）
export function regenerateDay(schedule, records, dateStr, doneWordIds = []) {
  const { levels, perDay } = schedule.config;
  const fakeProfile = { settings: { levels, dailyNewLimit: perDay } };
  const scheduled = new Set(doneWordIds);
  schedule.days.forEach((d) => { if (d.date !== dateStr) d.wordIds.forEach((id) => scheduled.add(id)); });
  const group = formDailyGroup(fakeProfile, records, perDay, { excludeWordIds: scheduled, strictLevels: true });
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
