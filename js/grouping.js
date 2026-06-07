// grouping.js — 每日「分組出題」引擎
// 依分組優先序，把性質相同的字湊成「一組」當日一起學。
// 優先序：root/prefix/suffix(1) → prefix規律(2,以prefix體現) → compound(3)
//          → confuse(4) → theme(5) → antonym(6)

import { allWords, getById, findByWord } from './vocab.js';

let _index = null;
let _roots = null;

export async function loadGroupsIndex() {
  if (_index) return _index;
  try {
    const res = await fetch('./data/groups_index.json', { cache: 'force-cache' });
    _index = res.ok ? await res.json() : {};
  } catch (e) {
    _index = {};
  }
  return _index;
}

// 載入字根字首字尾原始資料（roots.json）
export async function loadRoots() {
  if (_roots) return _roots;
  try {
    const res = await fetch('./data/roots.json', { cache: 'force-cache' });
    _roots = res.ok ? await res.json() : [];
  } catch (e) {
    _roots = [];
  }
  return _roots;
}

export function allRoots() {
  return _roots || [];
}

// 取某字首/字根/字尾的衍生單字（優先用 groups_index，否則用 examples ∩ vocab）
export function membersOfAffix(affix, type) {
  const key = `${type}:${affix}`;
  if (_index && _index[key]) return _index[key].members.slice();
  // fallback：用 roots.json 的 examples 與本機字表交集
  const r = (_roots || []).find((x) => x.affix === affix && x.type === type);
  if (!r) return [];
  const ids = [];
  for (const w of r.examples || []) {
    const e = findByWord(w);
    if (e && !ids.includes(e.id)) ids.push(e.id);
  }
  return ids;
}

const PRIORITY = { root: 1, prefix: 1, suffix: 1, compound: 3, confuse: 4, theme: 5, antonym: 6 };

// 形成當日單字組。
// records: 該使用者既有紀錄陣列（用來排除已熟記、優先未熟的字）
// 回傳 { wordIds, memo, memos, label, groupKey }
export function formDailyGroup(profile, records, n, options = {}) {
  const N = n || (profile.settings && profile.settings.dailyNewLimit) || 15;
  const exclude = new Set(options.excludeKeys || []);
  const excludeWords = new Set(options.excludeWordIds || []);
  const levels = (profile.settings && profile.settings.levels && profile.settings.levels.length)
    ? profile.settings.levels : [4, 5, 6];

  const recMap = new Map(records.map((r) => [r.wordId, r]));
  const mastered = new Set(records.filter((r) => r.status === 'mastered').map((r) => r.wordId));

  // 候選：有例句、未熟記
  const hasEx = (e) => e.example && e.example.trim();
  const notMastered = (e) => !mastered.has(e.id);

  const avail = (e) => !excludeWords.has(e.id); // 排除其他日期已排的字（去重）
  const inRange = allWords().filter((e) => levels.includes(e.level) && hasEx(e) && notMastered(e) && avail(e));
  // 若級別範圍內有例句的字不足（例如目前只有 L1 有例句），退而用「全部有例句」的字
  let pool = inRange;
  if (pool.length < N) {
    const anyLevel = allWords().filter((e) => hasEx(e) && notMastered(e) && avail(e));
    // 合併、去重，範圍內優先在前
    const seen = new Set(pool.map((e) => e.id));
    pool = pool.concat(anyLevel.filter((e) => !seen.has(e.id)));
  }
  const poolIds = new Set(pool.map((e) => e.id));
  if (!poolIds.size) return { wordIds: [], memo: '', memos: [], label: '今日沒有可學的新字', groupKey: null };

  // 依優先序與可用成員數排序分組
  const scored = [];
  for (const [key, g] of Object.entries(_index || {})) {
    if (exclude.has(key)) continue; // 換一組時排除目前分組
    const avail = g.members.filter((id) => poolIds.has(id));
    if (avail.length >= 2) {
      scored.push({ key, g, avail, pr: PRIORITY[g.type] || 9, jitter: Math.random() });
    }
  }
  // 優先序小者在前；同優先序，可用成員多者在前（加微量隨機讓「換一組」有變化）
  scored.sort((a, b) => (a.pr - b.pr) || (b.avail.length - a.avail.length) || (a.jitter - b.jitter));

  const chosen = [];
  const chosenSet = new Set();
  const memos = [];
  const usedKeys = [];

  for (const s of scored) {
    if (chosen.length >= N) break;
    const take = s.avail.filter((id) => !chosenSet.has(id)).slice(0, N - chosen.length);
    if (take.length >= 2 || (chosen.length > 0 && take.length >= 1)) {
      take.forEach((id) => { chosen.push(id); chosenSet.add(id); });
      memos.push(s.g.memo);
      usedKeys.push(s.key);
    }
  }

  // 仍不足 N → 用其餘候選字補滿（無共同記憶點）
  if (chosen.length < N) {
    for (const e of pool) {
      if (chosen.length >= N) break;
      if (!chosenSet.has(e.id)) { chosen.push(e.id); chosenSet.add(e.id); }
    }
  }

  const primary = scored.length ? scored.find((s) => usedKeys.includes(s.key)) : null;
  const label = primary ? primary.g.label : '今日單字組';
  return {
    wordIds: chosen.slice(0, N),
    memo: memos[0] || '今天這組字一起練習、互相提示記憶。',
    memos,
    label,
    groupKey: usedKeys[0] || null,
  };
}

// 取得某字所屬的同組家族（供「同字根家族」連結）
export function familyOf(wordId) {
  const e = getById(wordId);
  if (!e || !e.groupKeys || !_index) return [];
  const fam = new Set();
  for (const k of e.groupKeys) {
    const g = _index[k];
    if (g) g.members.forEach((id) => { if (id !== wordId) fam.add(id); });
  }
  return [...fam];
}

// 只取「同字根/字首/字尾」家族（給單字卡顯示）。回傳 [{id, label}]
export function rootFamilyOf(wordId) {
  const e = getById(wordId);
  if (!e || !e.groupKeys || !_index) return [];
  const seen = new Set();
  const out = [];
  for (const k of e.groupKeys) {
    if (!/^(root|prefix|suffix):/.test(k)) continue;
    const g = _index[k];
    if (!g) continue;
    for (const id of g.members) {
      if (id !== wordId && !seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out;
}
