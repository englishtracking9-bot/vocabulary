// home.js — 首頁儀表板（自 app.js 原樣搬出，G1 拆分）

import { go } from './app.js';
import { detectNewBadges } from './badges.js';
import { getDailyLog, getDailyLogsByProfile, getRecordsByProfile } from './db.js';
import { openWordDetail } from './mywords.js';
import { celebrateBadges, setReportDate } from './reportui.js';
import { statusBadge } from './srs.js';
import { $main, State } from './state.js';
import { getStats } from './stats.js';
import { esc, prettyDate, todayStr } from './util.js';
import { getById } from './vocab.js';


// ============================================================
// 首頁（預設落點）— 頂部今日進度小條 + 三區大按鈕分層（R：界面重組）
// 大按鈕只負責「帶到該區清爽的下一層」，首頁本身不再塞細節。
// ============================================================
async function renderHome() {
  const stats = await getStats(State.profile.id);

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

    <div class="card home-hub">
      <h3>🟦 每天學習</h3>
      <button class="btn primary big-copy hub-btn" data-go="#calendar">📅 今天要學<small>日曆／當日單字組</small></button>
      <button class="btn big-copy hub-btn" data-go="#quiz">📝 測驗複習<small>平時複習・週測／月測・掃 QR</small></button>
      <button class="btn big-copy hub-btn" data-go="#mywords">📋 我的字<small>看進度、群組、挑字測驗</small></button>
    </div>

    <div class="card home-hub">
      <h3>📚 單字來源</h3>
      <button class="btn big-copy hub-btn soon" id="hub-yp">📖 YP 單字書<small>即將推出</small></button>
      <button class="btn big-copy hub-btn" data-go="#six">📚 學測6000<small>字根字首等 6000 字工具</small></button>
      <button class="btn big-copy hub-btn" data-go="#custombook">📓 自訂單字本<small>自己打的片語、講義</small></button>
      <button class="btn big-copy hub-btn" data-go="#lookup">🔎 查單字<small>查 6000 字或上網查新字</small></button>
    </div>

    <div class="card home-hub">
      <h3>🗂 記錄設定</h3>
      <button class="btn big-copy hub-btn" data-go="#report">📊 每日報告<small>複製成果傳家長（LINE）</small></button>
      <button class="btn big-copy hub-btn" data-go="#parent">👨‍👩‍👧 家長專區<small>排程、出題碼／QR、列印、完成碼</small></button>
      <button class="btn big-copy hub-btn" data-go="#settings">⚙️ 設定<small>身分、字數級別、外觀、備份、提醒</small></button>
    </div>`;

  $main().querySelectorAll('.hub-btn[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  document.getElementById('hub-yp').onclick = () => alert('📖 YP 單字書即將在下一階段推出，敬請期待！');
  document.querySelectorAll('.stat-cell.tap').forEach((c) => { c.onclick = () => openStatDetail(c.dataset.stat); });

  // K-3：偵測並慶祝新解鎖的里程碑徽章
  try { const fresh = await detectNewBadges(State.profile.id); celebrateBadges(fresh); } catch (e) { /* 不影響首頁 */ }
}

// ============================================================
// 📚 學測6000 專區入口（R：現有 6000 字工具的集合；S 階段可再擴充瀏覽）
// YP 單字書是另一個完全獨立的專區（S 階段），不與此混用。
// ============================================================
function renderSixHub() {
  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="six-back">‹ 首頁</button><b>📚 學測6000</b></div>
      <p class="hint-area">學測必考 6000 單字的工具都在這裡。（YP 單字書是另一個獨立專區，在首頁「單字來源」裡）</p>
    </div>
    <div class="card">
      <div class="detail-list">
        <div class="row tap" id="six-roots"><div class="row-main">
          <span class="row-word">🌱 字根字首</span>
          <span class="row-zh">用字根字首規律，一次記一整組相關的字</span></div>
          <div class="row-meta"><span>›</span></div></div>
        <div class="row tap" id="six-lookup"><div class="row-main">
          <span class="row-word">🔎 在 6000 字裡查單字</span>
          <span class="row-zh">查字義、加入待學</span></div>
          <div class="row-meta"><span>›</span></div></div>
      </div>
    </div>`;
  document.getElementById('six-back').onclick = () => go('#home');
  document.getElementById('six-roots').onclick = () => go('#roots');
  document.getElementById('six-lookup').onclick = () => go('#lookup');
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
export { renderHome, renderSixHub, openStatDetail };
