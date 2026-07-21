// home.js — 首頁儀表板（自 app.js 原樣搬出，G1 拆分）

import { go } from './app.js';
import { detectNewBadges } from './badges.js';
import { wordDayDone } from './daily.js';
import { getDailyLog, getDailyLogsByProfile, getDayPlan, getDueRecords, getManualGroupsByProfile, getRecordsByProfile } from './db.js';
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
  const today = todayStr();

  // 頂部完成度小條（EngKing 風）：
  //  今日學習 x/y ＝ 當天所有計畫（自動組＋家長手動組）已完成／總字數
  //  今日複習 x/y ＝ 今天已複習／（已複習＋尚未到期剩餘）
  const plans = [];
  const auto = await getDayPlan(State.profile.id, today);
  if (auto && auto.group.wordIds.length) plans.push(auto);
  const manualsToday = (await getManualGroupsByProfile(State.profile.id))
    .filter((g) => g.date === today && g.group.wordIds.length);
  plans.push(...manualsToday);
  let learnTotal = 0, learnDone = 0;
  for (const p of plans) for (const id of p.group.wordIds) { learnTotal++; if (wordDayDone(p, id)) learnDone++; }
  const due = await getDueRecords(State.profile.id, Date.now());
  const log = await getDailyLog(State.profile.id, today);
  const reviewedToday = (log && log.reviewWords ? log.reviewWords.length : 0);
  const reviewTotal = due.length + reviewedToday;

  const bar = (x, y) => `<div class="tb-bar"><i style="width:${y ? Math.round(x / y * 100) : 0}%"></i></div>`;
  const blk = (cls, go, ic, tt, sub, extra = '') =>
    `<button class="block-btn ${cls}${extra}" ${go ? `data-go="${go}"` : ''}>
      <span class="blk-ic">${ic}</span>
      <span class="blk-txt"><span class="blk-tt">${tt}</span><span class="blk-sub">${sub}</span></span>
    </button>`;

  $main().innerHTML = `
    <div class="today-bar">
      <div class="tb-top"><h2>嗨，${esc(State.profile.name)} 👋</h2><span class="tb-hint">點下方看明細</span></div>
      <div class="tb-grid">
        <div class="tb-cell" data-stat="new"><b>${learnDone}/${learnTotal}</b><span>今日學習</span>${bar(learnDone, learnTotal)}</div>
        <div class="tb-cell" data-stat="review"><b>${reviewedToday}/${reviewTotal}</b><span>今日複習</span>${bar(reviewedToday, reviewTotal)}</div>
        <div class="tb-cell" data-stat="acc"><b>${stats.todayAccuracy}%</b><span>今日答對率</span></div>
        <div class="tb-cell" data-stat="streak"><b>🔥${stats.streak}</b><span>連續天數</span></div>
      </div>
    </div>

    <div class="home-sec">
      <h3>每天學習</h3>
      <div class="block-grid">
        ${blk('learn', '#calendar', '📅', '今天要學', '日曆／當日單字組', ' full')}
        ${blk('test', '#quiz', '📝', '測驗複習', '複習・週月測・掃QR')}
        ${blk('mywords', '#mywords', '📋', '我的字', '進度・群組')}
      </div>
    </div>

    <div class="home-sec">
      <h3>單字來源</h3>
      <div class="block-grid">
        ${blk('yp', '', '📖', 'YP 單字書', '即將推出', ' soon')}
        ${blk('six', '#six', '📚', '學測6000', '字根字首等工具')}
        ${blk('custom', '#custombook', '📓', '自訂單字本', '片語・講義')}
        ${blk('lookup', '#lookup', '🔎', '查單字', '查6000或上網查')}
      </div>
    </div>

    <div class="home-sec">
      <h3>記錄設定</h3>
      <div class="block-grid">
        ${blk('report', '#report', '📊', '每日報告', '複製傳家長')}
        ${blk('parent', '#parent', '👨‍👩‍👧', '家長專區', '排程・出題・列印')}
        ${blk('settings', '#settings', '⚙️', '設定', '身分・級別・外觀・備份・提醒', ' full')}
      </div>
    </div>`;

  // YP 尚未啟用（S 階段），沒有 data-go：需要一個 id 才能掛提示
  const ypBtn = [...$main().querySelectorAll('.block-btn')].find((b) => b.querySelector('.blk-tt').textContent.startsWith('YP'));
  $main().querySelectorAll('.block-btn[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  if (ypBtn) ypBtn.onclick = () => alert('📖 YP 單字書即將在下一階段推出，敬請期待！');
  $main().querySelectorAll('.tb-cell[data-stat]').forEach((c) => { c.onclick = () => openStatDetail(c.dataset.stat); });

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
