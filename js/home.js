// home.js — 首頁儀表板（自 app.js 原樣搬出，G1 拆分）

import { go } from './app.js';
import { detectNewBadges } from './badges.js';
import { openDay, wordDayDone } from './daily.js';
import { getDailyLog, getDailyLogsByProfile, getDayPlan, getDueRecords, getRecordsByProfile } from './db.js';
import { openWordDetail } from './mywords.js';
import { celebrateBadges, setReportDate } from './reportui.js';
import { statusBadge } from './srs.js';
import { $main, State } from './state.js';
import { getStats } from './stats.js';
import { esc, prettyDate, todayStr } from './util.js';
import { getById } from './vocab.js';


// ============================================================
// 首頁（預設落點）— 今日進度 + 快捷，不強迫測驗
// ============================================================
async function renderHome() {
  const stats = await getStats(State.profile.id);
  const today = todayStr();
  const due = await getDueRecords(State.profile.id, Date.now());
  const dueCount = due.length;

  // 今天的單字組進度（若已生成）
  const autoPlan = await getDayPlan(State.profile.id, today);
  const parentMode = State.profile.settings.dailySource === 'parent';
  let groupLabel = '今天的單字組';
  if (parentMode) {
    groupLabel = '📷 掃描家長出的題';
  } else if (autoPlan && autoPlan.group.wordIds.length) {
    const total = autoPlan.group.wordIds.length;
    const done = autoPlan.group.wordIds.filter((id) => wordDayDone(autoPlan, id)).length;
    groupLabel = (total > 0 && done >= total) ? '今天的單字組（已完成 ✓）'
      : `今天的單字組（${done}/${total}）`;
  }

  $main().innerHTML = `
    <div class="card">
      <h2>嗨，${esc(State.profile.name)} 👋</h2>
      <div class="stat-grid">
        <div class="stat-cell tap" data-stat="new"><b>${stats.todayNew}</b><span>今日新學</span></div>
        <div class="stat-cell tap" data-stat="review"><b>${stats.todayReview}</b><span>今日複習</span></div>
        <div class="stat-cell tap" data-stat="acc"><b>${stats.todayAccuracy}%</b><span>今日答對率</span></div>
        <div class="stat-cell tap" data-stat="streak"><b>🔥 ${stats.streak}</b><span>連續天數</span></div>
      </div>
      <p class="hint-area">點上面任一格看明細</p>
    </div>
    <div class="card home-actions">
      <p class="hint-area">接下來做什麼？一步到位 😊</p>
      <button class="btn primary big-copy" id="h-group">▶️ ${esc(groupLabel)}</button>
      <button class="btn big-copy" id="h-review">🔁 複習今天到期的字（${dueCount}）</button>
      <button class="btn big-copy" id="h-tests">🎯 週測／月測（測驗中心）</button>
      <div class="btn-row">
        <button class="btn" id="h-lookup">🔎 查單字</button>
        <button class="btn" id="h-mywords">📋 我的單字</button>
      </div>
    </div>`;
  document.getElementById('h-group').onclick = () => parentMode ? go('#scan') : openDay(today);
  document.getElementById('h-review').onclick = () => { State.pendingReview = true; go('#quiz'); };
  document.getElementById('h-tests').onclick = () => go('#quiz');
  document.getElementById('h-lookup').onclick = () => go('#lookup');
  document.getElementById('h-mywords').onclick = () => go('#mywords');
  document.querySelectorAll('.stat-cell.tap').forEach((c) => { c.onclick = () => openStatDetail(c.dataset.stat); });

  // K-3：偵測並慶祝新解鎖的里程碑徽章
  try { const fresh = await detectNewBadges(State.profile.id); celebrateBadges(fresh); } catch (e) { /* 不影響首頁 */ }
}

// G-4：首頁四格點開看明細（今天、目前身分）
async function openStatDetail(kind) {
  const today = todayStr();
  const log = await getDailyLog(State.profile.id, today);
  const recs = await getRecordsByProfile(State.profile.id);
  const recMap = new Map(recs.map((r) => [r.wordId, r]));

  const wordLine = (id) => {
    const e = getById(id); if (!e) return '';
    const r = recMap.get(id);
    return `<div class="row tap" data-id="${id}"><div class="row-main">
      <span class="row-word">${esc(e.word)}</span><span class="row-zh">${esc(e.zh)}</span></div>
      <div class="row-meta"><span>${r ? statusBadge(r.status) : ''}</span></div></div>`;
  };
  const wrongLine = (w) => {
    const e = getById(w.wordId);
    return `<div class="row ${e ? 'tap' : ''}" ${e ? `data-id="${w.wordId}"` : ''}><div class="row-main">
      <span class="row-word">${e ? esc(e.word) : esc(w.wordId)}</span>
      <span class="row-zh">${w.kind === 'sentence' ? '造句' : '拼字'}</span></div>
      <div class="row-meta"><span>你寫：${esc(w.input) || '(空白)'}</span><span>正解：${esc(w.answer)}</span></div></div>`;
  };

  let title, body;
  if (kind === 'new') {
    const ids = (log && log.newWords) || [];
    title = '🆕 今日新學';
    body = ids.length ? ids.map(wordLine).join('') : '<p class="hint-area">今天還沒學新字</p>';
  } else if (kind === 'review') {
    const ids = (log && log.reviewWords) || [];
    title = '🔁 今日複習';
    body = ids.length ? ids.map(wordLine).join('') : '<p class="hint-area">今天還沒複習</p>';
  } else if (kind === 'acc') {
    const ws = (log && log.wrong) || [];
    const acc = log && log.answerCount ? Math.round(log.correctCount / log.answerCount * 100) : 0;
    title = `📊 今日答對率 ${acc}%`;
    body = (log && log.answerCount)
      ? (ws.length ? `<p class="hint-area">答錯的題目（${ws.length}）：</p>${ws.map(wrongLine).join('')}` : '<p class="hint-area">今天全部答對 🎉</p>')
      : '<p class="hint-area">今天還沒作答</p>';
  } else { // streak
    const logs = await getDailyLogsByProfile(State.profile.id);
    const days = logs.filter((l) => l.answerCount > 0).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14);
    title = '🔥 最近學習日（點一天看當天明細）';
    // K：每天可點 → 跳到那天的報告（含學了/複習哪些字、對錯、答對率）
    body = days.length ? days.map((l) => `<div class="row tap" data-date="${l.date}"><div class="row-main">
      <span class="row-word">${prettyDate(l.date)}</span></div>
      <div class="row-meta"><span>答題 ${l.answerCount}</span><span>新學 ${(l.newWords || []).length}</span><span>正確率 ${l.answerCount ? Math.round(l.correctCount / l.answerCount * 100) : 0}%</span></div></div>`).join('')
      : '<p class="hint-area">還沒有學習紀錄</p>';
  }

  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal-box">
    <h3>${title}</h3>
    <div class="detail-list">${body}</div>
    <button class="btn" id="sd-close">關閉</button>
  </div>`;
  m.classList.add('show');
  document.getElementById('sd-close').onclick = () => m.classList.remove('show');
  // 明細裡的字可點開單字卡
  m.querySelectorAll('.row.tap[data-id]').forEach((row) => { row.onclick = () => openWordDetail(row.dataset.id); });
  // 最近學習日：點一天 → 該日報告
  m.querySelectorAll('.row.tap[data-date]').forEach((row) => {
    row.onclick = () => { m.classList.remove('show'); setReportDate(row.dataset.date); go('#report'); };
  });
}
export { renderHome, openStatDetail };
