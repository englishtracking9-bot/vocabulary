// reportui.js — 每日報告頁與徽章（自 app.js 原樣搬出，G1 拆分）

import { getBadges } from './badges.js';
import { getDailyLog, getRecordsByProfile } from './db.js';
import { archiveSnapshot, buildDailyReport, buildNewWordsOnly, buildWeeklyReport, copyToClipboard } from './report.js';
import { statusBadge } from './srs.js';
import { $main, State } from './state.js';
import { esc, todayStr } from './util.js';
import { getById } from './vocab.js';


// ============================================================
// 每日報告
// ============================================================
let ReportDate = null; // 目前檢視的報告日期（null=今天）
// G1 拆分：跨模組不能直接對 import 的變數賦值，身分切換時經此 setter 重設
function resetReportDate() { ReportDate = null; }

async function renderReport() {
  const today = todayStr();
  await archiveSnapshot(State.profile); // 更新今天的進度快照
  if (!ReportDate) ReportDate = today;
  $main().innerHTML = `<div class="card center">產生報告中…</div>`;
  const text = await buildDailyReport(State.profile, ReportDate);
  $main().innerHTML = `
    <div class="card">
      <h2>每日報告</h2>
      <div class="report-datebar">
        <button class="btn" id="rep-prev">‹ 前一天</button>
        <input type="date" id="rep-date" value="${ReportDate}" max="${today}" />
        <button class="btn" id="rep-next" ${ReportDate >= today ? 'disabled' : ''}>後一天 ›</button>
      </div>
      <div class="btn-row"><button class="btn" id="rep-today">回到今天</button></div>
      <pre id="report-text" class="report-text">${esc(text)}</pre>
      <button class="btn primary big-copy" id="copy-main">📋 複製這天的報告</button>
      <div class="btn-row">
        <button class="btn" id="copy-new">只複製今日新字</button>
        <button class="btn" id="copy-week">複製本週彙整</button>
      </div>
      <p id="copy-status" class="hint-area"></p>
    </div>
    <div id="report-badges"></div>
    <div id="report-detail"></div>`;
  renderBadgesCard();
  renderReportDetail(ReportDate);
  const status = document.getElementById('copy-status');
  const doCopy = async (getter) => {
    const t = await getter();
    document.getElementById('report-text').textContent = t;
    const ok = await copyToClipboard(t);
    status.textContent = ok ? '✅ 已複製，貼到 LINE 傳給家長吧！' : '⚠️ 複製失敗，請長按上方文字手動複製';
  };
  document.getElementById('copy-main').onclick = () => doCopy(() => buildDailyReport(State.profile, ReportDate));
  document.getElementById('copy-new').onclick = () => doCopy(() => buildNewWordsOnly(State.profile));
  document.getElementById('copy-week').onclick = () => doCopy(() => buildWeeklyReport(State.profile));

  // 日期切換
  document.getElementById('rep-date').onchange = (e) => { ReportDate = e.target.value; renderReport(); };
  document.getElementById('rep-today').onclick = () => { ReportDate = today; renderReport(); };
  document.getElementById('rep-prev').onclick = () => { ReportDate = shiftDate(ReportDate, -1); renderReport(); };
  document.getElementById('rep-next').onclick = () => {
    const n = shiftDate(ReportDate, 1);
    if (n <= today) { ReportDate = n; renderReport(); }
  };
}

// K-3 成就徽章卡（顯示已達成／未達成）
async function renderBadgesCard() {
  const box = document.getElementById('report-badges');
  if (!box) return;
  const badges = await getBadges(State.profile.id);
  const earned = badges.filter((b) => b.earned);
  const locked = badges.filter((b) => !b.earned);
  const cell = (b) => `<div class="badge-cell ${b.earned ? 'on' : 'off'}" title="${esc(b.desc)}">
      <span class="badge-ic">${b.earned ? b.icon : '🔒'}</span>
      <span class="badge-nm">${esc(b.name)}</span>
      <span class="badge-ds">${esc(b.desc)}</span>
    </div>`;
  box.innerHTML = `<div class="card">
      <div class="mw-head"><h2>🏅 成就徽章</h2><span class="row-meta">${earned.length} / ${badges.length}</span></div>
      <div class="badge-grid">${earned.map(cell).join('')}${locked.map(cell).join('')}</div>
    </div>`;
}

// 慶祝新達成的徽章（首頁載入時偵測）
function celebrateBadges(fresh) {
  if (!fresh || !fresh.length) return;
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal-box center badge-pop">
      <h3>🎉 解鎖新徽章！</h3>
      <div class="badge-grid">${fresh.map((b) => `<div class="badge-cell on">
        <span class="badge-ic">${b.icon}</span><span class="badge-nm">${esc(b.name)}</span>
        <span class="badge-ds">${esc(b.desc)}</span></div>`).join('')}</div>
      <button class="btn primary" id="bp-close">太棒了！</button>
    </div>`;
  m.classList.add('show');
  document.getElementById('bp-close').onclick = () => m.classList.remove('show');
}

// 報告明細：點數字展開清單（新學 / 複習 / 答錯）
async function renderReportDetail(dateStr) {
  const box = document.getElementById('report-detail');
  if (!box) return;
  const log = await getDailyLog(State.profile.id, dateStr);
  if (!log) { box.innerHTML = ''; return; }
  const recs = await getRecordsByProfile(State.profile.id);
  const recMap = new Map(recs.map((r) => [r.wordId, r]));

  const wordLine = (id) => {
    const e = getById(id); if (!e) return '';
    const r = recMap.get(id);
    return `<div class="row"><div class="row-main">
      <span class="row-word">${esc(e.word)}</span>
      <span class="row-zh">${esc(e.zh)}</span></div>
      <div class="row-meta"><span>${r ? statusBadge(r.status) : ''}</span></div></div>`;
  };
  const wrongLine = (w) => {
    const e = getById(w.wordId);
    return `<div class="row"><div class="row-main">
      <span class="row-word">${e ? esc(e.word) : esc(w.wordId)}</span>
      <span class="row-zh">${w.kind === 'sentence' ? '造句' : '拼字'}</span></div>
      <div class="row-meta"><span>你寫：${esc(w.input) || '(空白)'}</span><span>正解：${esc(w.answer)}</span></div></div>`;
  };

  const newList = (log.newWords || []).map(wordLine).join('') || '<p class="hint-area">無</p>';
  const revList = (log.reviewWords || []).map(wordLine).join('') || '<p class="hint-area">無</p>';
  const wrongList = (log.wrong || []).map(wrongLine).join('') || '<p class="hint-area">這天沒有答錯 🎉</p>';
  const acc = log.answerCount ? Math.round(log.correctCount / log.answerCount * 100) : 0;

  box.innerHTML = `
    <div class="card">
      <h3>明細（點開看清單）</h3>
      <details><summary>🆕 新學 ${(log.newWords || []).length} 字</summary><div class="detail-list">${newList}</div></details>
      <details><summary>🔁 複習 ${(log.reviewWords || []).length} 字</summary><div class="detail-list">${revList}</div></details>
      <details><summary>📊 答對率 ${acc}%（❌ 答錯 ${(log.wrong || []).length} 題）</summary><div class="detail-list">${wrongList}</div></details>
    </div>`;
}

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return todayStr(d);
}
export { ReportDate, resetReportDate, renderReport, renderBadgesCard, celebrateBadges, renderReportDetail, shiftDate };
