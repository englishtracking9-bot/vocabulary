// badges.js — K-3 里程碑徽章（全部由本機資料推導，各身分獨立、離線可用）
// 觀念：不額外重複存「是否達成」，每次由現況推導；只用 meta 記錄「已看過的徽章」以偵測新達成、跳慶祝。

import { getStats } from './stats.js';
import { getTestResultsByProfile, getMeta, setMeta } from './db.js';

// 徽章定義：test(ctx) 回傳 true 即「已達成」。ctx 由 buildContext 提供。
export const BADGES = [
  { id: 'streak3',   icon: '🔥', name: '三天不間斷', desc: '連續學習 3 天',  test: (c) => c.streak >= 3 },
  { id: 'streak7',   icon: '🔥', name: '一週全勤',   desc: '連續學習 7 天',  test: (c) => c.streak >= 7 },
  { id: 'streak14',  icon: '🔥', name: '兩週達人',   desc: '連續學習 14 天', test: (c) => c.streak >= 14 },
  { id: 'streak30',  icon: '🏆', name: '一個月毅力', desc: '連續學習 30 天', test: (c) => c.streak >= 30 },
  { id: 'streak100', icon: '👑', name: '百日傳奇',   desc: '連續學習 100 天', test: (c) => c.streak >= 100 },

  { id: 'm10',  icon: '🌳', name: '小有成就', desc: '已熟記 10 字',  test: (c) => c.mastered >= 10 },
  { id: 'm50',  icon: '🌳', name: '漸入佳境', desc: '已熟記 50 字',  test: (c) => c.mastered >= 50 },
  { id: 'm100', icon: '🌳', name: '熟記百字', desc: '已熟記 100 字', test: (c) => c.mastered >= 100 },
  { id: 'm300', icon: '🌲', name: '熟記三百', desc: '已熟記 300 字', test: (c) => c.mastered >= 300 },
  { id: 'm600', icon: '🌲', name: '熟記六百', desc: '已熟記 600 字', test: (c) => c.mastered >= 600 },

  { id: 'p50',  icon: '🌲', name: '長期記憶', desc: '穩固 50 字',  test: (c) => c.proficient >= 50 },
  { id: 'p100', icon: '🌲', name: '記憶大師', desc: '穩固 100 字', test: (c) => c.proficient >= 100 },

  { id: 't100',  icon: '📚', name: '小書蟲',   desc: '納入學習 100 字',  test: (c) => c.tracked >= 100 },
  { id: 't500',  icon: '📚', name: '單字收藏家', desc: '納入學習 500 字', test: (c) => c.tracked >= 500 },
  { id: 't1000', icon: '📚', name: '字海泳將', desc: '納入學習 1000 字', test: (c) => c.tracked >= 1000 },

  { id: 'test1',     icon: '🧪', name: '初試啼聲', desc: '完成第 1 次測驗',    test: (c) => c.testCount >= 1 },
  { id: 'test10',    icon: '🧪', name: '考試達人', desc: '完成 10 次測驗',     test: (c) => c.testCount >= 10 },
  { id: 'perfectWk', icon: '⭐', name: '週測滿分', desc: '週測拿到 100 分',    test: (c) => c.bestWeekly >= 100 },
  { id: 'perfectMo', icon: '🏅', name: '月測滿分', desc: '月測拿到 100 分',    test: (c) => c.bestMonthly >= 100 },
];

async function buildContext(profileId, now = Date.now()) {
  const stats = await getStats(profileId, now);
  const results = await getTestResultsByProfile(profileId);
  const bestOf = (type) => results.filter((r) => r.type === type).reduce((m, r) => Math.max(m, r.scorePct), 0);
  return {
    streak: stats.streak,
    mastered: stats.mastered,       // 已熟記＋穩固
    proficient: stats.proficient,
    tracked: stats.tracked,
    testCount: results.length,
    bestWeekly: bestOf('weekly'),
    bestMonthly: bestOf('monthly'),
  };
}

// 回傳 [{...badge, earned:boolean}]（依定義順序）
export async function getBadges(profileId, now = Date.now()) {
  const ctx = await buildContext(profileId, now);
  return BADGES.map((b) => ({ ...b, earned: !!b.test(ctx) }));
}

const SEEN_KEY = (pid) => `seenBadges::${pid}`;

// 偵測「這次新達成、且之前沒慶祝過」的徽章；回傳新徽章陣列，並更新 meta。
export async function detectNewBadges(profileId, now = Date.now()) {
  const badges = await getBadges(profileId, now);
  const earnedIds = badges.filter((b) => b.earned).map((b) => b.id);
  const seen = (await getMeta(SEEN_KEY(profileId))) || [];
  const seenSet = new Set(seen);
  const fresh = badges.filter((b) => b.earned && !seenSet.has(b.id));
  if (fresh.length) await setMeta(SEEN_KEY(profileId), earnedIds);
  else if (earnedIds.length !== seen.length) await setMeta(SEEN_KEY(profileId), earnedIds);
  return fresh;
}
