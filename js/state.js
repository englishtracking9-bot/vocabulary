// state.js — 全域狀態與共用 UI 小工具（自 app.js 原樣搬出，G1 拆分）

import { getRecordsByProfile } from './db.js';
import { STATUS_DESC, STATUS_LABEL, isMasteredFamily } from './srs.js';


// 顯示用版本（與 service-worker.js 的 APP_VERSION 同步更新；讓使用者能確認手機拿到的是哪一版）
const APP_UI_VERSION = '2026-07-23-yp1454';

// ---------- 預設身分 ----------
const DEFAULT_PROFILES = [
  { id: 'senior1', name: 'Justin', settings: { dailyNewLimit: 20, levels: [4, 5, 6], priorityLevels: [4, 5, 6], reminderTime: '19:30', reminderOn: false } },
  { id: 'junior3', name: 'Sonya', settings: { dailyNewLimit: 15, levels: [3, 4, 5], priorityLevels: [4, 5], reminderTime: '19:30', reminderOn: false } },
];
// 舊版預設名 → 新預設名（一次性遷移用；使用者自訂過的名稱不會被動到）
const LEGACY_PROFILE_NAMES = { senior1: '升高一', junior3: '升國三-Sonya' };

// ---------- 全域狀態 ----------
const State = {
  profile: null,
  session: null,
  current: null,      // 當前題目 item {wordId, level, kind}
  entry: null,        // 當前單字 entry
  usedHint: false,
  answered: false,
  quizMode: null,     // 'active' 表示正在進行複習回合（用於 #quiz 路由判斷顯示題目或測驗中心）
  masteredIds: new Set(), // 目前身分「已熟記」的字（供同字根家族標記錨點字）
};

// 重新整理「已熟記」集合（F-2：同字根家族錨點字）
async function refreshMastered() {
  try {
    const recs = await getRecordsByProfile(State.profile.id);
    State.masteredIds = new Set(
      recs.filter((r) => isMasteredFamily(r.status)).map((r) => r.wordId)
    );
  } catch (e) { State.masteredIds = new Set(); }
}

const $main = () => document.getElementById('main');

// 四階段精熟標準說明（顯示給孩子看，沿用成長徽章 🌱🌿🌳🌲）
function stageLegendHTML() {
  return `<div class="stage-legend">
    <span title="${STATUS_DESC.new}">${STATUS_LABEL.new}</span>
    <span title="${STATUS_DESC.weak}">${STATUS_LABEL.weak}</span>
    <span title="${STATUS_DESC.mastered}">${STATUS_LABEL.mastered}</span>
    <span title="${STATUS_DESC.proficient}">${STATUS_LABEL.proficient}</span>
  </div>`;
}
export { APP_UI_VERSION, DEFAULT_PROFILES, LEGACY_PROFILE_NAMES, State, refreshMastered, $main, stageLegendHTML };
