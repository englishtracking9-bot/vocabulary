// app.js — 入口：啟動、路由、身分切換、SW 註冊（G1 拆分後的常駐核心）
import { dailyKey, dayKey, deleteCustomBook, deleteManualGroup, deleteProfileFully, deleteRecord, getAllProfiles, getCustomBook, getCustomBooksByProfile, getDailyLog, getDayPlan, getDaysByProfile, getDueRecords, getManualGroupsByDate, getManualGroupsByProfile, getMeta, getProfile, getRecord, getRecordsByProfile, openDB, putCustomBook, putDailyLog, putDayPlan, putManualGroup, putProfile, putRecord, setMeta } from './db.js';
import { formDailyGroup, loadGroupsIndex, loadRoots } from './grouping.js';
import { renderHome } from './home.js';
import { addToReview, createCustomWord, deleteCustomWord, fetchDict, lookupWord, speak, updateCustomZh } from './lookup.js';
import { downloadICS, notifyPermission, notifySupported, registerPeriodicReminder, requestNotifyPermission, scheduleForegroundReminder, showReminderNow, syncReminderMeta } from './notify.js';
import { decodeCode, encodableIds, encodeWordIds } from './paircode.js';
import { Session, buildQueue, recordAnswer } from './quiz.js';
import { archiveSnapshot, copyToClipboard } from './report.js';
import { renderReport, resetReportDate } from './reportui.js';
import { renderRoots } from './rootsui.js';
import { KIND_LABEL, buildMonthSchedule, regenerateDay, regroupDay } from './schedule.js';
import { compareSentence } from './sentence.js';
import { DAY_MS, dayStart, displayCategory, statusBadge } from './srs.js';
import { $main, APP_UI_VERSION, DEFAULT_PROFILES, State, refreshMastered, stageLegendHTML } from './state.js';
import { exportProfile, getStats, importProfile } from './stats.js';
import { addWordsToTag, createTag, deleteTag, getTags, renameTag, setWordTags, tagCounts, tagsOfWord, wordsInTag } from './tags.js';
import { TEST_TYPE_LABEL, allMyWordIds, allResults, groupWordIds, levelWordIds, previousResult, recentWordIds, sample, saveTestResult } from './tests.js';
import { esc, prettyDate, shuffle, todayStr } from './util.js';
import { checkAnswer, getById, loadVocab, registerCustomWord, searchWords } from './vocab.js';
import { attachCardHandlers, cardHTML, senseBlockHTML } from './wordcard.js';


// ---------- 啟動 ----------
async function init() {
  try {
    await openDB();
    await loadVocab();
    await loadGroupsIndex();
    await loadRoots();
    await loadCustomWords();
    await ensureProfiles();

    const activeId = (await getMeta('activeProfile')) || DEFAULT_PROFILES[0].id;
    State.profile = (await getProfile(activeId)) || (await getProfile(DEFAULT_PROFILES[0].id));
    await refreshMastered();

    renderHeader();
    window.addEventListener('hashchange', route);
    // 導覽列：即使 hash 沒變也要重繪（例如在日曆子頁點「日曆」要回到月曆）
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.addEventListener('click', () => go(b.dataset.route));
    });
    if (!location.hash) location.hash = '#home';
    route();

    registerServiceWorker();
    // 每日提醒：同步設定到 meta 供 SW 背景讀取，並在前景排程
    syncReminderMeta(State.profile);
    scheduleForegroundReminder(State.profile);
  } catch (e) {
    console.error(e);
    $main().innerHTML = `<div class="card"><p>⚠️ 啟動失敗：${esc(e.message)}</p>
      <p>請確認 data/vocab.json 已產生（執行 scripts/build_vocab.py）。</p></div>`;
  }
}

async function ensureProfiles() {
  const existing = await getAllProfiles();
  if (!existing.length) {
    for (const p of DEFAULT_PROFILES) await putProfile(p);
  }
}

async function loadCustomWords() {
  const custom = (await getMeta('customWords')) || [];
  for (const e of custom) registerCustomWord(e);
}

// ---------- 身分切換 ----------
function renderHeader() {
  const el = document.getElementById('profile-switch');
  el.innerHTML = '';
  // 取得身分清單後渲染按鈕
  getAllProfiles().then((profiles) => {
    el.innerHTML = profiles.map((p) =>
      `<button class="pf-btn ${p.id === State.profile.id ? 'active' : ''}" data-pid="${p.id}">${esc(p.name)}</button>`
    ).join('');
    el.querySelectorAll('.pf-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        State.profile = await getProfile(b.dataset.pid);
        await setMeta('activeProfile', State.profile.id);
        State.session = null;
        resetReportDate(); // 報告日期回到今天
        await refreshMastered();
        syncReminderMeta(State.profile);
        scheduleForegroundReminder(State.profile);
        renderHeader();
        route();
      });
    });
  });
}

// ---------- 路由 ----------
const ROUTES = {
  '#home': renderHome,
  '#quiz': renderQuiz,
  '#calendar': renderCalendar,
  '#lookup': renderLookup,
  '#mywords': renderMyWords,
  '#groups': renderGroups,
  '#manual': renderManualBuilder,
  '#roots': renderRoots,
  '#report': renderReport,
  '#more': renderMore,
  '#parent': renderParentZone,
  '#custombook': renderCustomBooks,
  '#scan': renderScan,
  '#settings': renderSettings,
};

// 不在底部導覽的子頁，歸屬「更多」分頁高亮
const MORE_SUBPAGES = new Set(['#lookup', '#roots', '#groups', '#report', '#settings', '#more', '#parent', '#manual', '#custombook']);

function route() {
  const hash = location.hash || '#home';
  const fn = ROUTES[hash] || renderHome;
  const navHash = hash === '#scan' ? '#quiz' : MORE_SUBPAGES.has(hash) ? '#more' : hash;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.route === navHash);
  });
  fn();
}

// 導覽：設定 hash 並強制重繪（即使 hash 未變）
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ============================================================
// 測驗中心：上半＝平時每日到期複習（SM-2 主力）；下半＝周測/月測/自訂測驗（檢驗查漏）
// ============================================================
async function renderQuiz() {
  // 從首頁「複習今天到期的字」直接進入複習
  if (State.pendingReview) { State.pendingReview = false; return startReview(); }
  // 進行中的周測/月測/自訂測驗：繼續顯示測驗題
  if (TestRun.active) return testShow();
  // 進行中的複習回合（含「立即測這個字」）：繼續顯示題目，不回到中心頁
  if (State.quizMode === 'active' && State.session && State.session.remaining > 0) {
    return showQuestion();
  }
  State.quizMode = null;
  await renderTestHub();
}

async function renderTestHub() {
  const due = await getDueRecords(State.profile.id, Date.now());
  const results = await allResults(State.profile.id);
  const recent = results.slice(0, 5);
  const histRows = recent.length ? recent.map((r) => `
    <div class="row tap" data-rid="${r.id}"><div class="row-main">
      <span class="row-word">${TEST_TYPE_LABEL[r.type] || r.type}</span>
      <span class="row-zh">${esc(r.name)}</span></div>
      <div class="row-meta"><span>${prettyDate(r.date)}</span><span>${r.correct}/${r.total}</span><span><b>${r.scorePct} 分</b></span></div>
    </div>`).join('') : '<p class="hint-area">還沒有測驗紀錄。先做一次週測看看吧！</p>';

  $main().innerHTML = `
    <div class="card">
      <h2>📝 測驗</h2>
      <p class="hint-area">平時每天的「到期複習」是主力；週測／月測是定期檢驗、找出忘記的字。</p>
    </div>

    <div class="card section-daily">
      <h3>🔁 平時複習（每日到期）</h3>
      <p class="hint-area">SM-2 自動排程，今天該回來複習的字。</p>
      <button class="btn primary big-copy" id="start-review">▶️ 開始複習（今天到期 ${due.length} 字）</button>
    </div>

    <div class="card section-test">
      <h3>🧪 定期測驗（檢驗查漏）</h3>
      <p class="hint-area">答錯的字會自動降為「需加強」、重排密集複習。</p>
      <div class="btn-row">
        <button class="btn" id="test-weekly">📅 週測<small>（近 7 天）</small></button>
        <button class="btn" id="test-monthly">🗓 月測<small>（近 30 天）</small></button>
      </div>
      <button class="btn" id="test-custom">🎯 自訂測驗（自選範圍）</button>
    </div>

    <div class="card section-parent">
      <h3>📷 家長出的題（掃 QR）</h3>
      <p class="hint-area">掃描家長電腦／紙本上的出題碼 QR，或貼上出題碼，載入今天要考的字。</p>
      <button class="btn primary big-copy" id="test-scan">📷 掃 QR ／ 貼出題碼</button>
    </div>

    <div class="card">
      <div class="mw-head"><h3>📈 最近成績</h3>
        ${results.length > 5 ? '<button class="btn" id="test-allhist">看全部</button>' : ''}</div>
      <div class="detail-list">${histRows}</div>
    </div>
    <p class="ver-tag">版本 ${APP_UI_VERSION}</p>`;

  document.getElementById('start-review').onclick = startReview;
  document.getElementById('test-weekly').onclick = () => openTestSetup('weekly');
  document.getElementById('test-monthly').onclick = () => openTestSetup('monthly');
  document.getElementById('test-custom').onclick = () => openTestSetup('custom');
  document.getElementById('test-scan').onclick = () => go('#scan');
  const allh = document.getElementById('test-allhist');
  if (allh) allh.onclick = openTestHistory;
  $main().querySelectorAll('.row.tap[data-rid]').forEach((row) => {
    row.onclick = () => { const r = results.find((x) => x.id === row.dataset.rid); if (r) showTestResultDetail(r); };
  });
}

// 開始「平時到期複習」回合
async function startReview() {
  State.quizMode = 'active';
  const items = await buildQueue(State.profile, Date.now(), { reviewOnly: true });
  State.session = new Session(items);
  if (State.session.remaining === 0) return renderReviewEmpty();
  showQuestion();
}

// 沒有到期複習字時的友善畫面
function renderReviewEmpty() {
  $main().innerHTML = `
    <div class="card center">
      <h2>今天沒有要複習的字 🎉</h2>
      <p>SM-2 算過了，今天到期的字都複習完了。</p>
      <p class="hint-area">想多練？去學今天的新字組，或練自己的單字。</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" id="go-cal">📚 去學今天的新字組</button>
        <button class="btn" id="go-my">📋 我的單字</button>
      </div>
    </div>`;
  document.getElementById('go-cal').onclick = () => openDay(todayStr());
  document.getElementById('go-my').onclick = () => go('#mywords');
}

async function renderQuizDone() {
  const stats = await getStats(State.profile.id);
  $main().innerHTML = `
    <div class="card center">
      <h2>今日已完成 🎉</h2>
      <p class="big">${State.session ? State.session.done : 0} 字過關</p>
      <div class="stat-grid">
        <div><b>${stats.todayNew}</b><span>今日新學</span></div>
        <div><b>${stats.todayReview}</b><span>今日複習</span></div>
        <div><b>${stats.todayAccuracy}%</b><span>今日答對率</span></div>
        <div><b>🔥 ${stats.streak}</b><span>連續天數</span></div>
      </div>
      <button class="btn primary" id="again">再練一回合</button>
      <button class="btn" id="to-hub">回測驗中心</button>
      <a class="btn" href="#report">看每日報告</a>
    </div>`;
  State.quizMode = null;
  document.getElementById('again').onclick = async () => {
    State.quizMode = 'active';
    const items = await buildQueue(State.profile, Date.now(), { reviewOnly: true });
    State.session = new Session(items);
    if (State.session.remaining === 0) renderReviewEmpty();
    else showQuestion();
  };
  document.getElementById('to-hub').onclick = () => { State.session = null; renderTestHub(); };
}

// ============================================================
// K-2 周測 / 月測 / 自訂測驗（單次計分；結果回寫 SM-2；存檔可回看；與上次比較）
// ============================================================
const TestRun = {
  active: false, type: 'weekly', name: '',
  items: [], idx: 0, correct: 0, wrong: [], answered: false,
};

// 測驗設定 modal
async function openTestSetup(type) {
  const tags = await getTags(State.profile.id);
  const isCustom = type === 'custom';
  const defCount = type === 'weekly' ? 20 : type === 'monthly' ? 30 : 20;
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>${TEST_TYPE_LABEL[type]}設定</h3>
      ${isCustom ? `
        <label class="ts-row">測驗範圍
          <select id="ts-scope" class="answer-input">
            <option value="recent7">最近 7 天學過的字</option>
            <option value="recent30">最近 30 天學過的字</option>
            <option value="all">我的全部單字</option>
            ${[1, 2, 3, 4, 5, 6].map((l) => `<option value="lv${l}">Level ${l}</option>`).join('')}
            ${tags.map((t) => `<option value="tag:${t.id}">🏷 ${esc(t.name)}</option>`).join('')}
          </select>
        </label>`
      : `<p class="hint-area">範圍：${type === 'weekly' ? '最近 7 天' : '最近 30 天'}學過的字，隨機抽題。</p>`}
      <label class="ts-row">題數
        <input id="ts-count" class="answer-input ts-num" type="number" min="1" max="100" value="${defCount}" inputmode="numeric" />
      </label>
      <label class="ts-row ts-check"><input type="checkbox" id="ts-sentence" /> 加考造句（只考有例句的字）</label>
      <label class="ts-row ts-check"><input type="checkbox" id="ts-gauntlet" ${type === 'weekly' ? 'checked' : ''} /> 🎮 闖關模式（每 10 題一關，全對得 ⭐）</label>
      <div class="btn-row">
        <button class="btn primary" id="ts-start">開始測驗</button>
        <button class="btn" id="ts-cancel">取消</button>
      </div>
    </div>`;
  m.classList.add('show');
  document.getElementById('ts-cancel').onclick = () => m.classList.remove('show');
  document.getElementById('ts-start').onclick = async () => {
    const count = Math.max(1, Math.min(100, parseInt(document.getElementById('ts-count').value, 10) || defCount));
    const withSentence = document.getElementById('ts-sentence').checked;
    const gauntlet = document.getElementById('ts-gauntlet').checked;
    let ids = [], name = '';
    if (type === 'weekly') { ids = await recentWordIds(State.profile.id, 7); name = '週測（近 7 天）'; }
    else if (type === 'monthly') { ids = await recentWordIds(State.profile.id, 30); name = '月測（近 30 天）'; }
    else {
      const scope = document.getElementById('ts-scope').value;
      if (scope === 'recent7') { ids = await recentWordIds(State.profile.id, 7); name = '自訂・近 7 天'; }
      else if (scope === 'recent30') { ids = await recentWordIds(State.profile.id, 30); name = '自訂・近 30 天'; }
      else if (scope === 'all') { ids = await allMyWordIds(State.profile.id); name = '自訂・全部我的字'; }
      else if (scope.startsWith('lv')) { const l = scope.slice(2); ids = await levelWordIds(State.profile.id, l); name = `自訂・Level ${l}`; }
      else if (scope.startsWith('tag:')) { const tid = scope.slice(4); ids = await groupWordIds(State.profile.id, tid); const tg = tags.find((t) => t.id === tid); name = `自訂・${tg ? tg.name : '群組'}`; }
    }
    if (!ids.length) {
      alert(type === 'custom' ? '這個範圍目前沒有可測的字。' : '最近還沒有學過的字可測。\n先去學今天的單字組，過幾天就能做週測囉！');
      return;
    }
    m.classList.remove('show');
    startTest(type, name, sample(ids, count), withSentence, gauntlet);
  };
}

const STAGE_SIZE = 10; // 闖關每關題數

function startTest(type, name, ids, withSentence, gauntlet) {
  const items = [];
  for (const id of ids) {
    const e = getById(id); if (!e) continue;
    items.push({ wordId: id, kind: 'spelling' });
    if (withSentence) {
      const ss = sensesWithExample(e);
      if (ss.length) items.push({ wordId: id, kind: 'sentence', sense: ss[0] });
    }
  }
  if (!items.length) { alert('沒有可測的題目'); return; }
  Object.assign(TestRun, {
    active: true, type, name, items, idx: 0, correct: 0, wrong: [], answered: false,
    gauntlet: !!gauntlet && items.length > STAGE_SIZE, qResults: [],
  });
  if (location.hash !== '#quiz') location.hash = '#quiz';
  testShow();
}

// 計算闖關星數（每 STAGE_SIZE 題一關，整關全對得 ⭐）
function gauntletStars(qResults) {
  let stars = 0, stages = 0;
  for (let i = 0; i < qResults.length; i += STAGE_SIZE) {
    const grp = qResults.slice(i, i + STAGE_SIZE);
    stages++;
    if (grp.length && grp.every(Boolean)) stars++;
  }
  return { stars, stages };
}

function testShow() {
  const t = TestRun;
  if (t.idx >= t.items.length) return testDone();
  t.answered = false;
  const item = t.items[t.idx];
  const e = getById(item.wordId);
  const stageInfo = t.gauntlet ? `<span>🎮 第 ${Math.floor(t.idx / STAGE_SIZE) + 1} 關</span>` : `<span>${TEST_TYPE_LABEL[t.type]}</span>`;
  const head = `<div class="quiz-progress">
      ${stageInfo}<span>第 ${t.idx + 1} / ${t.items.length} 題</span><span>Lv${e.level}</span>
    </div>`;
  if (item.kind === 'spelling') {
    $main().innerHTML = `${head}
      <div class="card quiz-card">
        <div class="zh-prompt">${esc(e.zh) || '（無中文）'}</div>
        <div class="pos">${esc(e.pos)}</div>
        <input id="ans" class="answer-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="latin" placeholder="輸入英文拼字…" />
        <div class="btn-row"><button class="btn primary" id="submit">送出</button></div>
        <button class="btn save-exit" id="t-quit">✕ 結束測驗</button>
      </div>`;
    const input = document.getElementById('ans');
    input.focus();
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') testSubmit(); });
    document.getElementById('submit').onclick = testSubmit;
  } else {
    const sense = item.sense;
    const senseTag = `${sense.pos ? esc(sense.pos) + ' ' : ''}${esc(sense.zh || '')}`;
    $main().innerHTML = `${head}
      <div class="card quiz-card">
        <p class="hint-area">把這個義項的英文例句完整默寫出來（含 <b>${esc(e.word)}</b>）：</p>
        <div class="sense-tag">這題考：<b>${senseTag}</b></div>
        <div class="zh-prompt sent-zh">${esc(sense.example_zh || '')}</div>
        <div class="pos">關鍵字：${esc(e.word)}</div>
        <textarea id="sent" class="answer-input sent-input" rows="2" autocapitalize="sentences" autocorrect="off" spellcheck="false" placeholder="輸入完整英文句子…"></textarea>
        <div class="btn-row"><button class="btn primary" id="submit">送出</button></div>
        <button class="btn save-exit" id="t-quit">✕ 結束測驗</button>
      </div>`;
    document.getElementById('sent').focus();
    document.getElementById('submit').onclick = testSubmit;
  }
  document.getElementById('t-quit').onclick = testQuit;
}

async function testSubmit() {
  const t = TestRun;
  if (t.answered) return;
  const item = t.items[t.idx];
  const e = getById(item.wordId);
  let correct, val, answer, banner, detail = '';

  if (item.kind === 'spelling') {
    const input = document.getElementById('ans');
    val = input.value;
    if (!val.trim()) { input.focus(); return; }
    t.answered = true;
    correct = checkAnswer(e, val);
    answer = e.answerKeys[0];
    await recordAnswer(State.profile, e, correct, false, false, Date.now(),
      { input: val, answer, kind: 'spelling' });
    banner = correct ? `<div class="result ok">✅ 答對了！</div>`
      : `<div class="result no">❌ 答錯，你寫「${esc(val) || '(空白)'}」，正解：<b>${esc(answer)}</b></div>`;
  } else {
    const ta = document.getElementById('sent');
    val = ta.value;
    if (!val.trim()) { ta.focus(); return; }
    t.answered = true;
    const sense = item.sense;
    const res = compareSentence(val, sense.example);
    correct = res.correct;
    answer = sense.example;
    await recordAnswer(State.profile, e, correct, false, false, Date.now(),
      { input: val, answer, kind: 'sentence' });
    banner = correct ? `<div class="result ok">✅ 完全正確！</div>`
      : `<div class="result no">❌ 有些地方不一樣</div>`;
    detail = `<div class="card">
      <div class="sent-block"><b>你的句子</b><div class="sent-line">${res.userHtml}</div></div>
      <div class="sent-block"><b>正確例句</b><div class="sent-line">${res.standardHtml}</div></div>
    </div>`;
  }

  if (correct) t.correct++;
  else t.wrong.push({ wordId: e.id, input: val, answer, kind: item.kind });
  t.qResults.push(!!correct);
  await refreshMastered();

  const last = t.idx + 1 >= t.items.length;
  const stageEnd = t.gauntlet && !last && (t.idx + 1) % STAGE_SIZE === 0;
  const nextLabel = last ? '看成績 →' : stageEnd ? '過關結算 →' : '下一題 →';
  $main().innerHTML = `${banner}${detail || cardHTML(e, null)}
    <div class="btn-row"><button class="btn primary" id="t-next">${nextLabel}</button></div>`;
  attachCardHandlers(e);
  document.getElementById('t-next').onclick = () => {
    t.idx++;
    if (stageEnd) testStageBreak();
    else testShow();
  };
}

// 闖關：每關結束的過場畫面
function testStageBreak() {
  const t = TestRun;
  const stageNo = Math.floor(t.idx / STAGE_SIZE); // 剛完成的關（1-based 因 idx 已 ++ 到下一題起點）
  const grp = t.qResults.slice((stageNo - 1) * STAGE_SIZE, stageNo * STAGE_SIZE);
  const right = grp.filter(Boolean).length;
  const perfect = right === grp.length;
  const totalStages = Math.ceil(t.items.length / STAGE_SIZE);
  $main().innerHTML = `
    <div class="card center">
      <h2>${perfect ? '⭐ 完美過關！' : `第 ${stageNo} 關完成`}</h2>
      <p class="big">${right} / ${grp.length}</p>
      <p>${perfect ? '整關全對，獲得一顆 ⭐！' : '答對的字加分，答錯的字會排進複習。'}</p>
      <p class="hint-area">進度：第 ${stageNo} / ${totalStages} 關</p>
      <button class="btn primary" id="t-cont">▶️ 挑戰第 ${stageNo + 1} 關</button>
    </div>`;
  document.getElementById('t-cont').onclick = testShow;
}

function testQuit() {
  if (!confirm('結束這次測驗？（已作答的字仍會回寫複習進度，但不會計分存檔）')) return;
  TestRun.active = false;
  State.session = null;
  renderTestHub();
}

async function testDone() {
  const t = TestRun;
  t.active = false;
  const result = await saveTestResult({
    profileId: State.profile.id, type: t.type, name: t.name,
    total: t.items.length, correct: t.correct, wrong: t.wrong,
  });
  const prev = await previousResult(State.profile.id, t.type, result.id);

  let cmp = '<p class="hint-area">這是這類測驗的第一次紀錄，加油！🎯</p>';
  if (prev) {
    const d = result.scorePct - prev.scorePct;
    const arrow = d > 0 ? `📈 進步 ${d} 分` : d < 0 ? `📉 退步 ${-d} 分` : '➖ 與上次持平';
    cmp = `<p class="hint-area">上次同類測驗（${prettyDate(prev.date)}）：${prev.scorePct} 分　→　這次 ${result.scorePct} 分　<b>${arrow}</b></p>`;
  }
  const wrongRows = result.wrong.length
    ? result.wrong.map((w) => testWrongRow(w)).join('')
    : '<p class="hint-area">全部答對，太強了！🎉</p>';

  let gauntletLine = '';
  if (t.gauntlet) {
    const { stars, stages } = gauntletStars(t.qResults);
    gauntletLine = `<p class="gauntlet-stars">🎮 闖關：${'⭐'.repeat(stars)}${'☆'.repeat(Math.max(0, stages - stars))}　通過 ${stars} / ${stages} 關全對</p>`;
  }

  $main().innerHTML = `
    <div class="card center">
      <h2>${TEST_TYPE_LABEL[t.type]}完成 🎉</h2>
      <p class="big">${result.scorePct} 分</p>
      <p>${result.correct} / ${result.total} 題答對</p>
      ${gauntletLine}
      ${cmp}
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" id="t-retest">再測一次</button>
        <button class="btn" id="t-back">回測驗中心</button>
      </div>
    </div>
    <div class="card">
      <h3>❌ 答錯的字（${result.wrong.length}）— 已自動排入密集複習</h3>
      <div class="detail-list">${wrongRows}</div>
    </div>`;
  document.getElementById('t-retest').onclick = () => openTestSetup(t.type);
  document.getElementById('t-back').onclick = renderTestHub;
  $main().querySelectorAll('.row.tap[data-id]').forEach((row) => { row.onclick = () => openWordDetail(row.dataset.id); });
}

function testWrongRow(w) {
  const e = getById(w.wordId);
  // 單字本題目不在 6000 字裡，改用題目自帶的 word/zh 顯示（不可點開單字卡）
  const word = w.word != null ? w.word : (e ? e.word : w.wordId);
  const zh = w.zh != null ? w.zh : (e ? e.zh : '');
  const tappable = e && w.word == null;
  const kindLabel = w.kind === 'sentence' ? '造句' : w.kind === 'book' ? '單字本' : '拼字';
  return `<div class="row ${tappable ? 'tap' : ''}" ${tappable ? `data-id="${w.wordId}"` : ''}><div class="row-main">
      <span class="row-word">${esc(word)}</span>
      <span class="row-zh">${esc(zh)}</span></div>
    <div class="row-meta"><span>${kindLabel}</span>
      <span>你寫：${esc(w.input) || '(空白)'}</span><span>正解：${esc(w.answer)}</span></div></div>`;
}

// 測驗成績明細（從歷史點開）
function showTestResultDetail(r) {
  const wrongRows = r.wrong && r.wrong.length
    ? r.wrong.map((w) => testWrongRow(w)).join('')
    : '<p class="hint-area">這次全部答對 🎉</p>';
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal-box">
      <h3>${TEST_TYPE_LABEL[r.type] || r.type}・${esc(r.name)}</h3>
      <p>${prettyDate(r.date)}　<b>${r.scorePct} 分</b>（${r.correct}/${r.total}）</p>
      <div class="detail-list">${wrongRows}</div>
      <button class="btn" id="trd-close">關閉</button>
    </div>`;
  m.classList.add('show');
  document.getElementById('trd-close').onclick = () => m.classList.remove('show');
  m.querySelectorAll('.row.tap[data-id]').forEach((row) => { row.onclick = () => { m.classList.remove('show'); openWordDetail(row.dataset.id); }; });
}

// 全部測驗歷史
async function openTestHistory() {
  const results = await allResults(State.profile.id);
  const rows = results.length ? results.map((r) => `
    <div class="row tap" data-rid="${r.id}"><div class="row-main">
      <span class="row-word">${TEST_TYPE_LABEL[r.type] || r.type}</span>
      <span class="row-zh">${esc(r.name)}</span></div>
      <div class="row-meta"><span>${prettyDate(r.date)}</span><span>${r.correct}/${r.total}</span><span><b>${r.scorePct} 分</b></span></div>
    </div>`).join('') : '<p class="hint-area">還沒有測驗紀錄。</p>';
  $main().innerHTML = `
    <div class="card">
      <div class="mw-head"><h2>📈 測驗成績紀錄</h2><button class="btn" id="th-back">回測驗</button></div>
      <div class="detail-list">${rows}</div>
    </div>`;
  document.getElementById('th-back').onclick = renderTestHub;
  $main().querySelectorAll('.row.tap[data-rid]').forEach((row) => {
    row.onclick = () => { const r = results.find((x) => x.id === row.dataset.rid); if (r) showTestResultDetail(r); };
  });
}

function showQuestion() {
  State.answered = false;
  State.usedHint = false;
  const item = State.session.current();
  State.current = item;
  const entry = getById(item.wordId);
  State.entry = entry;
  const s = State.session;

  $main().innerHTML = `
    <div class="quiz-progress">
      <span>本回合 已過關 ${s.done}</span>
      <span>剩餘 ${s.remaining}</span>
      <span>${kindLabel(item.kind)}・Lv${entry.level}</span>
    </div>
    <div class="card quiz-card">
      <div class="zh-prompt">${esc(entry.zh) || '（無中文）'}</div>
      <div class="pos">${esc(entry.pos)}</div>
      <input id="ans" class="answer-input" type="text" autocomplete="off"
        autocapitalize="off" autocorrect="off" spellcheck="false"
        inputmode="latin" placeholder="輸入英文拼字…" />
      <div class="btn-row">
        <button class="btn primary" id="submit">送出</button>
        <button class="btn" id="hint">💡 提示</button>
        <button class="btn" id="say">🔊 聽發音<small>(算提示)</small></button>
      </div>
      <div id="hint-area" class="hint-area"></div>
    </div>`;

  const input = document.getElementById('ans');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
  document.getElementById('submit').onclick = doSubmit;
  document.getElementById('hint').onclick = () => {
    State.usedHint = true;
    const w = entry.answerKeys[0];
    document.getElementById('hint-area').textContent =
      `提示：首字母「${w[0]}」，共 ${w.length} 個字母`;
  };
  document.getElementById('say').onclick = () => {
    State.usedHint = true;
    speak(entry.answerKeys[0]);
  };
}

async function doSubmit() {
  if (State.answered) return;
  const input = document.getElementById('ans');
  const val = input.value;
  if (!val.trim()) { input.focus(); return; }
  State.answered = true;

  const entry = State.entry;
  const correct = checkAnswer(entry, val);
  const secondTry = State.session.wasWrongBefore(entry.id);

  await recordAnswer(State.profile, entry, correct, State.usedHint, secondTry, Date.now(),
    { input: val, answer: entry.answerKeys[0], kind: 'spelling' });

  if (correct) State.session.advance();
  else State.session.requeueCurrent();
  await refreshMastered();

  // 自訂字/已有例句者用本機資料即可，不打網路（避免片語查詢卡住）
  const dict = (entry.custom || (entry.example && entry.example.trim()))
    ? null : await fetchDict(entry.word.replace(/\(.*?\)/g, '').trim());
  showAnswerCard(entry, dict, correct, val);
}

function showAnswerCard(entry, dict, correct, userInput) {
  const banner = correct
    ? `<div class="result ok">✅ 答對了！</div>`
    : `<div class="result no">❌ 答錯了，你輸入了「${esc(userInput)}」<br>再看一次，稍後會再出現直到答對</div>`;
  $main().innerHTML = `
    ${banner}
    ${cardHTML(entry, dict)}
    <div class="btn-row">
      <button class="btn primary" id="next">下一題 →</button>
    </div>`;
  attachCardHandlers(entry);
  document.getElementById('next').onclick = () => {
    if (State.session.remaining === 0) renderQuizDone();
    else showQuestion();
  };
}

function kindLabel(kind) {
  return { 'review': '🔁 複習', 'new-lookup': '🔎 你查過的字', 'new-fresh': '🆕 新字' }[kind] || '';
}

// 點任意文字中的單字 → 導到「查單字」並自動查詢（完全複用查單字流程）
let PendingLookup = null;
function lookupTermNavigate(term) {
  if (!term) return;
  PendingLookup = term;
  const modal = document.getElementById('modal');
  if (modal) modal.classList.remove('show'); // 若從單字卡 modal 點出，先關閉
  if (location.hash === '#lookup') route(); else location.hash = '#lookup';
}

// ============================================================
// 學習日曆
// ============================================================
const Cal = { year: null, month: null }; // month: 0-11

async function renderCalendar() {
  const now = new Date();
  if (Cal.year == null) { Cal.year = now.getFullYear(); Cal.month = now.getMonth(); }

  const days = await getDaysByProfile(State.profile.id);
  const planMap = new Map(days.map((d) => [d.date, d]));
  const manuals = await getManualGroupsByProfile(State.profile.id);
  const manualDates = new Set(manuals.map((m) => m.date));

  const first = new Date(Cal.year, Cal.month, 1);
  const startDow = first.getDay(); // 0=Sun
  const daysInMonth = new Date(Cal.year, Cal.month + 1, 0).getDate();
  const todayS = todayStr(now);

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${Cal.year}-${String(Cal.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const st = dayStatus(planMap.get(ds));
    const isToday = ds === todayS;
    const isPast = ds < todayS;
    const hasPlan = planMap.has(ds);
    const hasManual = manualDates.has(ds);
    // 過去且無任何紀錄 → 不可點（不補排）
    if (isPast && !hasPlan && !hasManual) {
      cells += `<div class="cal-cell noplan"><span class="cal-d">${d}</span></div>`;
    } else {
      cells += `
      <button class="cal-cell ${st.cls} ${isToday ? 'today' : ''}" data-date="${ds}">
        <span class="cal-d">${d}</span>
        ${hasManual ? '<span class="cal-manual">✋</span>' : ''}
        ${st.badge ? `<span class="cal-badge">${st.badge}</span>` : ''}
      </button>`;
    }
  }

  $main().innerHTML = `
    <div class="card">
      <div class="cal-head">
        <button class="btn" id="cal-prev">‹</button>
        <h2>${Cal.year} 年 ${Cal.month + 1} 月</h2>
        <button class="btn" id="cal-next">›</button>
      </div>
      <div class="cal-grid cal-dow">
        ${['日','一','二','三','四','五','六'].map((w) => `<div class="cal-dow-cell">${w}</div>`).join('')}
      </div>
      <div class="cal-grid" id="cal-body">${cells}</div>
      <div class="cal-legend">
        <span><i class="dot new"></i>未開始</span>
        <span><i class="dot doing"></i>進行中</span>
        <span><i class="dot done"></i>已完成</span>
        <span>✋ 手動組</span>
      </div>
    </div>
    <div class="card center">
      <button class="btn primary" id="cal-today">📚 開始今天的單字組</button>
      <div class="btn-row"><a class="btn" href="#manual" id="cal-manual">✋ 手動出題（排字到某天）</a></div>
      <p class="hint-area">點任一天進入「當日學習」；標 ✋ 的日子有你手動排的單字組。</p>
    </div>`;

  document.getElementById('cal-prev').onclick = () => { shiftMonth(-1); renderCalendar(); };
  document.getElementById('cal-next').onclick = () => { shiftMonth(1); renderCalendar(); };
  document.getElementById('cal-today').onclick = () => openDay(todayS);
  document.querySelectorAll('#cal-body .cal-cell[data-date]').forEach((c) => {
    c.onclick = () => openDay(c.dataset.date);
  });
}

function shiftMonth(delta) {
  Cal.month += delta;
  if (Cal.month < 0) { Cal.month = 11; Cal.year--; }
  if (Cal.month > 11) { Cal.month = 0; Cal.year++; }
}

function dayStatus(plan) {
  if (!plan) return { cls: '', badge: '' };
  const total = plan.group.wordIds.length;
  if (!total) return { cls: '', badge: '' };
  const done = plan.group.wordIds.filter((id) => wordDayDone(plan, id)).length;
  if (done >= total) return { cls: 'done', badge: '✓' };
  if (plan.readDone || done > 0) return { cls: 'doing', badge: `${Math.round(done / total * 100)}%` };
  return { cls: 'new', badge: '•' };
}

function wordDayDone(plan, wid) {
  const p = plan.progress[wid] || {};
  const e = getById(wid);
  const needSentence = e && e.example && e.example.trim();
  // 拼字答對；造句（若該字有例句）已作答過即算完成該字（正確率另計）
  const spellingOk = p.spelling === 'correct';
  const sentenceDone = !needSentence || p.sentence === 'correct' || p.sentence === 'wrong' || p.sentence === 'skip';
  return spellingOk && sentenceDone;
}

// ============================================================
// 當日學習
// ============================================================
const Daily = { date: null, plan: null, spellSession: null, sentQueue: null, sentIdx: 0, answered: false, usedHint: false, browse: false };

// 持久化：手動組存 manualGroups；日曆自動組存 dayPlans；標籤群組測驗(虛擬)不存。
async function persistPlan() {
  const p = Daily.plan;
  if (!p) return;
  if (p.manual) await putManualGroup(p);
  else if (p.isGroup) { /* 標籤群組測驗：不寫入，避免污染月曆 */ }
  else await putDayPlan(p);
}

// 當日學習/群組測驗的「返回」目的地
function dailyBack() {
  const p = Daily.plan;
  if (!p) return renderCalendar();
  if (p.backTo === 'mywords') return renderMyWords();
  if (p.isGroup && !p.manual && !p.date) return renderGroups(); // 標籤群組測驗
  if (p.date) return openDay(p.date); // 日曆自動組 / 手動組 → 回該日總覽
  renderCalendar();
}

// 從「當天單字清單」(hub) 的返回：若該日有多組則回總覽，否則回月曆
async function backFromDayList() {
  const auto = await getDayPlan(State.profile.id, Daily.date);
  const manuals = await getManualGroupsByDate(State.profile.id, Daily.date);
  const count = manuals.length + (auto && auto.group.wordIds.length ? 1 : 0);
  if (count > 1) return openDay(Daily.date);
  renderCalendar();
}

// 蒐集「其他日期」已排定的字（供去重，避免相鄰日期大量重複）
async function scheduledWordIds(exceptDate) {
  const days = await getDaysByProfile(State.profile.id);
  const set = new Set();
  for (const d of days) {
    if (d.date === exceptDate) continue;
    (d.group.wordIds || []).forEach((id) => set.add(id));
  }
  return set;
}

// 產生並鎖定某日的單字組（僅用於今天/未來）
async function ensureDayPlan(dateStr) {
  let plan = await getDayPlan(State.profile.id, dateStr);
  if (!plan) {
    // L-3d：若「每日單字來源＝家長排程」，手機不自動排新字（避免與家長排定／掃入的重複）
    if (State.profile.settings.dailySource === 'parent') {
      plan = {
        key: dayKey(State.profile.id, dateStr), profileId: State.profile.id, date: dateStr,
        group: { wordIds: [], memo: '', memos: [], label: '（家長排程模式）', groupKey: null },
        readDone: false, progress: {}, createdAt: Date.now(), updatedAt: Date.now(), parentMode: true,
      };
      await putDayPlan(plan);
      return plan;
    }
    const records = await getRecordsByProfile(State.profile.id);
    const excludeWordIds = await scheduledWordIds(dateStr);
    const group = formDailyGroup(State.profile, records, State.profile.settings.dailyNewLimit, { excludeWordIds });
    plan = {
      key: dayKey(State.profile.id, dateStr), profileId: State.profile.id, date: dateStr,
      group, readDone: false, progress: {}, createdAt: Date.now(), updatedAt: Date.now(),
    };
    await putDayPlan(plan);
  }
  return plan;
}

async function openDay(dateStr) {
  if (location.hash !== '#calendar') location.hash = '#calendar';
  const isPast = dateStr < todayStr();
  let autoPlan = await getDayPlan(State.profile.id, dateStr);
  const manuals = await getManualGroupsByDate(State.profile.id, dateStr);

  // 過去且完全無紀錄 → 不補排
  if (!autoPlan && !manuals.length && isPast) {
    $main().innerHTML = `<div class="card center">
      <h2>${prettyDate(dateStr)}</h2>
      <p>這天沒有學習紀錄。</p>
      <button class="btn" id="back-cal">回日曆</button></div>`;
    document.getElementById('back-cal').onclick = () => renderCalendar();
    return;
  }
  // 今天 / 未來：若無自動組則生成並鎖定
  if (!autoPlan && !isPast) autoPlan = await ensureDayPlan(dateStr);

  const groups = [];
  if (autoPlan && autoPlan.group.wordIds.length) groups.push(autoPlan);
  manuals.forEach((m) => groups.push(m));

  if (!groups.length) { renderCalendar(); return; }
  if (groups.length === 1) return enterGroupStudy(groups[0]);
  renderDayMenu(dateStr, groups);
}

// 進入某一組（自動組或手動組）的學習
function enterGroupStudy(plan) {
  Daily.date = plan.date; Daily.plan = plan;
  Daily.spellSession = null; Daily.sentQueue = null; Daily.sentIdx = 0;
  renderDayList();
}

// 一天有多個單字組時的總覽（自動組＋手動組）
async function renderDayMenu(dateStr, groups) {
  const card = (g, idx) => {
    const total = g.group.wordIds.length;
    const done = g.group.wordIds.filter((id) => wordDayDone(g, id)).length;
    const isManual = !!g.manual;
    const title = isManual ? `✋ ${esc(g.name)}` : '📅 系統每日單字組';
    const preview = g.group.wordIds.slice(0, 5).map((id) => {
      const e = getById(id); return e ? esc(e.word) : '';
    }).filter(Boolean).join('、');
    return `<div class="card grp-card daymenu" data-idx="${idx}">
      <div class="grp-head"><b>${title}</b><span class="row-meta">${done}/${total} 完成</span></div>
      <div class="row-meta">${esc(preview)}${total > 5 ? '…' : ''}</div>
      ${isManual ? `<div class="btn-row"><button class="btn danger" data-del="${g.id}">🗑 刪除此手動組</button></div>` : ''}
    </div>`;
  };
  $main().innerHTML = `
    <div class="card memo-card">
      <div class="daily-top"><button class="btn" id="back-cal">‹ 日曆</button>
        <b>${prettyDate(dateStr)}・共 ${groups.length} 組</b></div>
      <p class="hint-area">這天有系統自動組與你手動排的單字組，點一組開始學習。</p>
    </div>
    ${groups.map(card).join('')}`;
  document.getElementById('back-cal').onclick = () => renderCalendar();
  document.querySelectorAll('.daymenu').forEach((c) => {
    c.onclick = (ev) => {
      if (ev.target.closest('[data-del]')) return;
      enterGroupStudy(groups[Number(c.dataset.idx)]);
    };
  });
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm('刪除這個手動單字組？（不會刪掉單字本身）')) return;
      await deleteManualGroup(b.dataset.del);
      openDay(dateStr);
    };
  });
}

// C-1：當天單字清單（一眼看到那天學了哪些字）
async function renderDayList() {
  Daily.browse = false; // 回到清單即離開「再讀一次」瀏覽模式
  const plan = Daily.plan;
  const isGroup = !!plan.isGroup;        // 標籤群組測驗
  const isManual = !!plan.manual;        // 手動出題組
  const isDate = !isGroup;               // 日曆相關（自動或手動）
  const records = await getRecordsByProfile(State.profile.id);
  const recMap = new Map(records.map((r) => [r.wordId, r]));
  const isPast = isDate && !isManual && Daily.date < todayStr();
  const total = plan.group.wordIds.length;
  const doneCount = plan.group.wordIds.filter((id) => wordDayDone(plan, id)).length;
  const allDone = total > 0 && doneCount >= total;

  const rows = plan.group.wordIds.map((id) => {
    const e = getById(id);
    if (!e) return '';
    const rec = recMap.get(id);
    const badge = rec ? statusBadge(rec.status) : '🆕 未測驗';
    return `<div class="row tap" data-id="${id}">
      <div class="row-main">
        <span class="row-word">${esc(e.word)}
          <button class="btn icon" data-say="${esc(e.answerKeys[0])}">🔊</button></span>
        <span class="row-zh">${esc(e.zh)}</span>
      </div>
      <div class="row-meta"><span>${esc(e.pos)}・Lv${e.level}</span><span>${badge}</span></div>
    </div>`;
  }).join('');

  // 題型文案跟著 plan.testTypes（出題碼可指定「只考拼字」）
  const tt = plan.testTypes || { spelling: true, sentence: true };
  const flowText = tt.sentence ? '拼字＋造句' : '拼字';

  let actionBtn;
  if (allDone) {
    actionBtn = `<button class="btn primary big-copy" id="day-start">🔁 重新練習這組</button>`;
  } else if (isPast) {
    actionBtn = `<button class="btn primary big-copy" id="day-start">繼續測驗（先讀→${flowText}）</button>`;
  } else {
    const label = plan.readDone ? '▶️ 繼續測驗' : `▶️ 開始（先讀 → ${flowText}）`;
    actionBtn = `<button class="btn primary big-copy" id="day-start">${label}</button>`;
  }

  const namePart = isGroup ? esc(plan.groupName)
    : isManual ? `✋ ${esc(plan.name)}` : prettyDate(Daily.date);
  const title = `${namePart}・單字清單（${total} 字）`;
  const memoText = isGroup ? `群組測驗：先讀一遍，再${flowText}`
    : isManual ? `手動單字組（${prettyDate(plan.date)}）：先讀一遍，再${flowText}`
      : '本組共同記憶點：' + esc(plan.group.memo);
  $main().innerHTML = `
    <div class="card memo-card">
      <div class="daily-top">
        <button class="btn" id="back-cal">${isGroup ? '‹ 群組' : '‹ 日曆'}</button>
        <b>${title}</b>
      </div>
      <div class="memo">💡 ${memoText}</div>
      <div class="row-meta">進度：${doneCount}/${total} 字完成${isPast ? '（純查看，可重練）' : ''}</div>
    </div>
    ${rows || '<div class="card center">這組沒有單字</div>'}
    <div class="card center">
      ${actionBtn}
      <div class="btn-row" style="justify-content:center"><button class="btn" id="day-read">📖 再讀一次（只瀏覽）</button></div>
    </div>`;

  document.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say); });
  // 清單中的字可點 → 開單字卡
  document.querySelectorAll('#main .row.tap[data-id]').forEach((row) => {
    row.onclick = (ev) => { if (ev.target.closest('[data-say]')) return; openWordDetail(row.dataset.id); };
  });
  document.getElementById('back-cal').onclick = () => (isGroup ? renderGroups() : backFromDayList());
  // 📖 再讀一次：純瀏覽（英文/中文/詞性/發音/例句/記憶聯想），不動進度、讀完回清單
  document.getElementById('day-read').onclick = () => { Daily.browse = true; renderReadList(); };
  document.getElementById('day-start').onclick = async () => {
    Daily.browse = false;
    if (allDone) {
      // 重新練習：清掉當日作答、跳過先讀，直接重測（SM-2 與統計照記）
      Daily.plan.progress = {};
      Daily.plan.readDone = true;
      Daily.plan.updatedAt = Date.now();
      await persistPlan();
    }
    dispatchDaily();
  };
}

function dispatchDaily() {
  const plan = Daily.plan;
  if (!plan.group.wordIds.length) {
    $main().innerHTML = `<div class="card center"><h2>今天沒有可學的新字 👍</h2>
      <p>可能你的範圍內的字都已熟記。到「設定」調整級別，或到「查單字」加字。</p>
      <button class="btn" id="back-cal">返回</button></div>`;
    document.getElementById('back-cal').onclick = () => dailyBack();
    return;
  }
  if (!plan.readDone) return renderReadList();

  const types = plan.testTypes || { spelling: true, sentence: true };

  if (types.spelling) {
    const needSpelling = plan.group.wordIds.filter((id) => (plan.progress[id] || {}).spelling !== 'correct');
    if (needSpelling.length) return startSpelling(needSpelling);
  }

  if (types.sentence) {
    const needSentence = plan.group.wordIds.filter((id) => {
      const e = getById(id);
      const p = plan.progress[id] || {};
      return e && e.example && e.example.trim() && !p.sentence;
    });
    if (needSentence.length) return startSentence(needSentence);
  }

  return renderDayDone();
}

// ---- 第一段：先讀（也用於「📖 再讀一次」純瀏覽，Daily.browse=true）----
function renderReadList() {
  const plan = Daily.plan;
  const browse = !!Daily.browse;
  const cards = plan.group.wordIds.map((id) => {
    const e = getById(id);
    if (!e) return '';
    return `
      ${(() => {
        const sList = (Array.isArray(e.senses) && e.senses.length)
          ? e.senses : [{ pos: e.pos, zh: e.zh, example: e.example, example_zh: e.example_zh }];
        const multi = sList.length > 1;
        return `
      <div class="read-card">
        <div class="word-head">
          <span class="word-en">${esc(e.word)}</span>
          <button class="btn icon" data-say="${esc(e.answerKeys[0])}">🔊</button>
          ${browse ? '' : `<button class="btn icon remove-word" data-rm="${e.id}" title="從今天移除">✕</button>`}
        </div>
        <div class="pos">${esc(e.pos)}・Lv${e.level}</div>
        ${Array.isArray(e.root) && e.root.length ? `<div class="root">🔧 ${e.root.map((p) => `${esc(p.part)}(${esc(p.mean)})`).join(' + ')}</div>` : ''}
        ${e.syllable ? `<div class="syllable">🔡 照音節拼：<b>${esc(e.syllable)}</b></div>` : ''}
        ${e.mnemonic ? `<div class="mnemonic">🧠 ${esc(e.mnemonic)}</div>` : ''}
        <div class="senses">${sList.slice(0, 3).map((s, i) => senseBlockHTML(s, i, multi)).join('')}</div>
      </div>`;
      })()}`;
  }).join('');

  const isGroup = !!plan.isGroup;
  const isManual = !!plan.manual;
  const isDailyAuto = !isGroup && !isManual; // 只有日曆自動組才有「換一組」
  const namePart = isGroup ? esc(plan.groupName)
    : isManual ? `✋ ${esc(plan.name)}` : prettyDate(Daily.date);
  const readTitle = browse
    ? `${namePart}・📖 再讀一次（${plan.group.wordIds.length} 字）`
    : `${namePart}・先讀（${plan.group.wordIds.length} 字）`;
  const memoText = browse ? '重新瀏覽：英文／中文／詞性／發音／例句／記憶聯想'
    : (isDailyAuto ? '本組共同記憶點：' + esc(plan.group.memo) : '讀完一遍，接著拼字＋造句');
  $main().innerHTML = `
    <div class="card memo-card">
      <div class="daily-top">
        <button class="btn" id="back-cal">${browse ? '‹ 單字清單' : (isGroup ? '‹ 群組' : '‹ 日曆')}</button>
        <b>${readTitle}</b>
      </div>
      <div class="memo">💡 ${memoText}</div>
      ${(isDailyAuto && !browse) ? `<div class="btn-row">
        <button class="btn" id="regroup">🔄 換一組</button>
      </div>` : ''}
    </div>
    ${cards}
    <div class="card center">
      ${browse
        ? `<button class="btn primary big-copy" id="read-done">✅ 讀完，回單字清單</button>`
        : `<button class="btn primary big-copy" id="read-done">✅ 讀完了，開始測驗 →</button>`}
    </div>`;

  document.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say); });
  document.querySelectorAll('[data-look]').forEach((w) => { w.onclick = () => lookupTermNavigate(w.dataset.look); });
  document.getElementById('back-cal').onclick = () => (browse ? renderDayList() : dailyBack());

  // 移除某字
  document.querySelectorAll('.remove-word').forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      const id = b.dataset.rm;
      Daily.plan.group.wordIds = Daily.plan.group.wordIds.filter((w) => w !== id);
      delete Daily.plan.progress[id];
      Daily.plan.updatedAt = Date.now();
      await persistPlan();
      renderReadList();
    };
  });

  // 換一組（僅日曆當日學習；群組測驗無此功能）
  const regroupBtn = document.getElementById('regroup');
  if (regroupBtn) regroupBtn.onclick = async () => {
    const records = await getRecordsByProfile(State.profile.id);
    const exclude = Daily.plan.group.groupKey ? [Daily.plan.group.groupKey] : [];
    const excludeWordIds = await scheduledWordIds(Daily.date);
    const group = formDailyGroup(State.profile, records, State.profile.settings.dailyNewLimit,
      { excludeKeys: exclude, excludeWordIds });
    if (!group.wordIds.length) { alert('沒有其他可用的分組了'); return; }
    Daily.plan.group = group;
    Daily.plan.progress = {};
    Daily.plan.readDone = false;
    Daily.plan.updatedAt = Date.now();
    await persistPlan();
    renderReadList();
  };
  document.getElementById('read-done').onclick = async () => {
    if (browse) { Daily.browse = false; return renderDayList(); } // 純瀏覽：回清單，不動進度
    Daily.plan.readDone = true;
    Daily.plan.updatedAt = Date.now();
    await persistPlan();
    dispatchDaily();
  };
}

// ---- 第二段①：拼字測驗 ----
function startSpelling(wordIds) {
  Daily.spellSession = new Session(wordIds.map((id) => {
    const e = getById(id); return { wordId: id, level: e ? e.level : 0, kind: 'review' };
  }));
  dailySpellingShow();
}

function dailySpellingShow() {
  const item = Daily.spellSession.current();
  if (!item) return dispatchDaily();
  Daily.answered = false; Daily.usedHint = false;
  const e = getById(item.wordId);
  const s = Daily.spellSession;
  $main().innerHTML = `
    <div class="quiz-progress">
      <span>✏️ 拼字測驗</span><span>剩餘 ${s.remaining}</span><span>Lv${e.level}</span>
    </div>
    <div class="card quiz-card">
      <div class="zh-prompt">${esc(e.zh) || '（無中文）'}</div>
      <div class="pos">${esc(e.pos)}</div>
      <input id="ans" class="answer-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="輸入英文拼字…" />
      <div class="btn-row">
        <button class="btn primary" id="submit">送出</button>
        <button class="btn" id="hint">💡 提示</button>
        <button class="btn" id="say">🔊 聽發音<small>(算提示)</small></button>
      </div>
      <div id="hint-area" class="hint-area"></div>
      <button class="btn save-exit" id="save-exit">💾 儲存並離開</button>
    </div>`;
  const input = document.getElementById('ans');
  input.focus();
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') dailySpellingSubmit(); });
  document.getElementById('submit').onclick = dailySpellingSubmit;
  document.getElementById('save-exit').onclick = () => saveAndExitDaily();
  document.getElementById('hint').onclick = () => {
    Daily.usedHint = true;
    const w = e.answerKeys[0];
    document.getElementById('hint-area').textContent = `提示：首字母「${w[0]}」，共 ${w.length} 個字母`;
  };
  document.getElementById('say').onclick = () => { Daily.usedHint = true; speak(e.answerKeys[0]); };
}

async function dailySpellingSubmit() {
  if (Daily.answered) return;
  const input = document.getElementById('ans');
  if (!input.value.trim()) { input.focus(); return; }
  Daily.answered = true;
  const item = Daily.spellSession.current();
  const e = getById(item.wordId);
  const correct = checkAnswer(e, input.value);
  const secondTry = Daily.spellSession.wasWrongBefore(e.id);
  await recordAnswer(State.profile, e, correct, Daily.usedHint, secondTry, Date.now(),
    { input: input.value, answer: e.answerKeys[0], kind: 'spelling' });

  // 記錄當日拼字結果
  Daily.plan.progress[e.id] = Daily.plan.progress[e.id] || {};
  if (correct) {
    Daily.plan.progress[e.id].spelling = 'correct';
    Daily.spellSession.advance();
  } else if (Daily.plan.progress[e.id].spelling !== 'correct') {
    Daily.plan.progress[e.id].spelling = 'wrong';
    Daily.spellSession.requeueCurrent();
  }
  Daily.plan.updatedAt = Date.now();
  await persistPlan();
  await refreshMastered();

  // 當日流程已有存好的例句，直接用本機資料呈現（不打網路，純離線、快）
  const banner = correct ? `<div class="result ok">✅ 答對了！</div>`
    : `<div class="result no">❌ 答錯了，你輸入了「${esc(input.value)}」，稍後會再出現直到答對</div>`;
  $main().innerHTML = `${banner}${cardHTML(e, null)}
    <div class="btn-row"><button class="btn primary" id="next">下一題 →</button></div>`;
  attachCardHandlers(e);
  document.getElementById('next').onclick = () => {
    if (Daily.spellSession.remaining === 0) dispatchDaily();
    else dailySpellingShow();
  };
}

// ---- 第二段②：造句測驗（例句默寫比對）----
// 取出某字「有例句」的義項；沒有 senses 就退回頂層例句
function sensesWithExample(entry) {
  const ss = Array.isArray(entry.senses)
    ? entry.senses.filter((s) => s && s.example && s.example.trim())
    : [];
  if (ss.length) return ss;
  if (entry.example && entry.example.trim()) {
    return [{ pos: entry.pos, zh: entry.zh, example: entry.example, example_zh: entry.example_zh }];
  }
  return [];
}

// J-3：造句測驗針對「某一個義項」出題；多義字依複習次數輪流用不同義項
async function startSentence(wordIds) {
  const recs = await getRecordsByProfile(State.profile.id);
  const repsMap = new Map(recs.map((r) => [r.wordId, r.reps || 0]));
  Daily.sentQueue = wordIds.map((id) => {
    const e = getById(id);
    const ss = e ? sensesWithExample(e) : [];
    if (!ss.length) return null;
    const sense = ss[(repsMap.get(id) || 0) % ss.length]; // 輪流不同義項
    return { id, sense };
  }).filter(Boolean);
  Daily.sentIdx = 0;
  dailySentenceShow();
}

function dailySentenceShow() {
  if (Daily.sentIdx >= Daily.sentQueue.length) return dispatchDaily();
  Daily.answered = false;
  const item = Daily.sentQueue[Daily.sentIdx];
  const e = getById(item.id);
  const sense = item.sense;
  const senseTag = `${sense.pos ? esc(sense.pos) + ' ' : ''}${esc(sense.zh || '')}`;
  $main().innerHTML = `
    <div class="quiz-progress">
      <span>📝 造句測驗（默寫）</span><span>${Daily.sentIdx + 1} / ${Daily.sentQueue.length}</span>
    </div>
    <div class="card quiz-card">
      <p class="hint-area">看著中文翻譯，把這個單字「這個義項」的英文例句完整默寫出來（含 <b>${esc(e.word)}</b>）：</p>
      <div class="sense-tag">這題考：<b>${senseTag}</b></div>
      <div class="zh-prompt sent-zh">${esc(sense.example_zh || '')}</div>
      <div class="pos">關鍵字：${esc(e.word)}（${senseTag}）
        <button class="btn icon" data-say="${esc(sense.example)}">🔊 聽例句</button>
      </div>
      <textarea id="sent" class="answer-input sent-input" rows="2" autocapitalize="sentences" autocorrect="off" spellcheck="false" placeholder="輸入完整英文句子…"></textarea>
      <div class="btn-row"><button class="btn primary" id="submit">送出</button></div>
      <button class="btn save-exit" id="save-exit">💾 儲存並離開</button>
    </div>`;
  const ta = document.getElementById('sent');
  ta.focus();
  document.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say); });
  document.getElementById('submit').onclick = dailySentenceSubmit;
  document.getElementById('save-exit').onclick = () => saveAndExitDaily();
}

async function dailySentenceSubmit() {
  if (Daily.answered) return;
  const ta = document.getElementById('sent');
  const val = ta.value;
  if (!val.trim()) { ta.focus(); return; }
  Daily.answered = true;
  const item = Daily.sentQueue[Daily.sentIdx];
  const e = getById(item.id);
  const sense = item.sense;
  const res = compareSentence(val, sense.example);

  // 回寫 SM-2（造句也是一次提取練習）
  await recordAnswer(State.profile, e, res.correct, false, false, Date.now(),
    { input: val, answer: sense.example, kind: 'sentence' });
  Daily.plan.progress[e.id] = Daily.plan.progress[e.id] || {};
  Daily.plan.progress[e.id].sentence = res.correct ? 'correct' : 'wrong';
  Daily.plan.updatedAt = Date.now();
  await persistPlan();

  const banner = res.correct ? `<div class="result ok">✅ 完全正確！</div>`
    : `<div class="result no">❌ 有些地方不一樣，看看下面的對照</div>`;
  const missing = res.missing.length ? `<p class="hint-area">缺少的字：${res.missing.map(esc).join('、')}</p>` : '';
  $main().innerHTML = `
    ${banner}
    <div class="card">
      <div class="sent-block"><b>你的句子</b><div class="sent-line">${res.userHtml}</div></div>
      <div class="sent-block"><b>正確例句</b>（${sense.pos ? esc(sense.pos) + ' ' : ''}${esc(sense.zh || '')}）<div class="sent-line">${res.standardHtml}
        <button class="btn icon" data-say="${esc(sense.example)}">🔊</button></div>
        <div class="ex-zh">${esc(sense.example_zh || '')}</div></div>
      ${missing}
    </div>
    <div class="btn-row"><button class="btn primary" id="next">下一句 →</button></div>`;
  document.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say); });
  document.getElementById('next').onclick = () => { Daily.sentIdx++; dailySentenceShow(); };
}

// 儲存並離開（進度已逐題保存，這裡只返回）
async function saveAndExitDaily() {
  if (Daily.plan) { Daily.plan.updatedAt = Date.now(); await persistPlan(); }
  dailyBack();
}

// ---- 完成 ----
function renderDayDone() {
  const plan = Daily.plan;
  const total = plan.group.wordIds.length;
  const sp = plan.group.wordIds.filter((id) => (plan.progress[id] || {}).spelling === 'correct').length;
  const st = plan.group.wordIds.filter((id) => {
    const p = plan.progress[id] || {}; return p.sentence === 'correct';
  }).length;
  const stTotal = plan.group.wordIds.filter((id) => { const e = getById(id); return e && e.example; }).length;
  archiveSnapshot(State.profile); // 存檔當下整體進度，供歷史報告
  const doneTitle = plan.isGroup ? `${esc(plan.groupName)} 完成 🎉`
    : plan.manual ? `✋ ${esc(plan.name)} 完成 🎉` : `${prettyDate(Daily.date)} 完成 🎉`;
  const types = plan.testTypes || { spelling: true, sentence: true };
  const cells = [`<div><b>${total}</b><span>本組單字</span></div>`];
  if (types.spelling) cells.push(`<div><b>${sp}/${total}</b><span>拼字過關</span></div>`);
  if (types.sentence) cells.push(`<div><b>${st}/${stTotal}</b><span>造句正確</span></div>`);
  const detailRows = plan.group.wordIds.map((id) => {
    const e = getById(id); if (!e) return '';
    const p = plan.progress[id] || {};
    const sp = p.spelling === 'correct' ? '✅' : (p.spelling === 'wrong' ? '❌' : '—');
    const se = !(e.example && e.example.trim()) ? '（無例句）'
      : (p.sentence === 'correct' ? '✅' : (p.sentence === 'wrong' ? '❌' : '—'));
    return `<div class="row"><div class="row-main">
      <span class="row-word">${esc(e.word)}</span><span class="row-zh">${esc(e.zh)}</span></div>
      <div class="row-meta">${types.spelling ? `<span>拼字 ${sp}</span>` : ''}${types.sentence ? `<span>造句 ${se}</span>` : ''}</div></div>`;
  }).join('');

  $main().innerHTML = `
    <div class="card center">
      <h2>${doneTitle}</h2>
      <div class="stat-grid">${cells.join('')}</div>
      <button class="btn primary" id="back-cal">${plan.backTo === 'mywords' ? '回我的單字' : (plan.isGroup ? '回群組' : '回日曆')}</button>
      <a class="btn" href="#report">看每日報告</a>
    </div>
    <div class="card">
      <details><summary>📋 本組明細（${total} 字）</summary><div class="detail-list">${detailRows}</div></details>
    </div>`;
  document.getElementById('back-cal').onclick = () => dailyBack();
}

// ============================================================
// 自訂群組（標籤）
// ============================================================
async function renderGroups() {
  const tags = await getTags(State.profile.id);
  const counts = await tagCounts(State.profile.id);
  $main().innerHTML = `
    <div class="card">
      <h2>我的群組</h2>
      <p class="hint-area">把字分到自訂群組（如「二次段考」），段考前可一鍵測整組。一個字可屬多個群組。</p>
      <div class="btn-row">
        <input id="grp-new" class="answer-input" placeholder="新群組名稱（如：二次段考單字）" />
        <button class="btn primary" id="grp-add">＋ 新增</button>
      </div>
    </div>
    <div id="grp-list">${tags.length ? '' : '<div class="card center">還沒有群組，先新增一個吧</div>'}</div>`;

  const listBox = document.getElementById('grp-list');
  listBox.innerHTML += tags.map((t) => `
    <div class="card grp-card">
      <div class="grp-head">
        <b>${esc(t.name)}</b><span class="row-meta">${counts[t.id] || 0} 字</span>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-act="test" data-id="${t.id}" ${(counts[t.id] || 0) ? '' : 'disabled'}>▶️ 測這個群組</button>
        <button class="btn" data-act="rename" data-id="${t.id}">改名</button>
        <button class="btn danger" data-act="del" data-id="${t.id}">刪除</button>
      </div>
    </div>`).join('');

  document.getElementById('grp-add').onclick = async () => {
    const name = document.getElementById('grp-new').value.trim();
    if (!name) return;
    await createTag(State.profile.id, name);
    renderGroups();
  };
  listBox.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const tag = tags.find((x) => x.id === b.dataset.id);
      if (!tag) return;
      if (b.dataset.act === 'test') return startGroupTest(tag);
      if (b.dataset.act === 'rename') {
        const name = prompt('群組新名稱：', tag.name);
        if (name && name.trim()) { await renameTag(tag, name.trim()); renderGroups(); }
      } else if (b.dataset.act === 'del') {
        if (!confirm(`刪除群組「${tag.name}」？\n（只移除標籤，不會刪掉單字本身）`)) return;
        await deleteTag(State.profile.id, tag.id);
        renderGroups();
      }
    };
  });
}

// 通用「群組選擇器」modal。
// mode 'set'：單字，覆蓋所屬群組（取消勾選＝移除）；mode 'add'：批次，只把勾選的群組加上。
async function openGroupPicker(wordIds, mode, onDone) {
  const tags = await getTags(State.profile.id);
  let preset = new Set();
  if (mode === 'set' && wordIds.length === 1) {
    preset = new Set(await tagsOfWord(State.profile, wordIds[0]));
  }
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>${mode === 'add' ? `把 ${wordIds.length} 個字加入群組` : '設定所屬群組'}</h3>
      <div id="gp-list">
        ${tags.length ? tags.map((t) => `
          <label class="chk gp-row"><input type="checkbox" value="${t.id}" ${preset.has(t.id) ? 'checked' : ''}/> ${esc(t.name)}</label>`).join('')
          : '<p class="hint-area">還沒有群組，先在下面新建。</p>'}
      </div>
      <div class="btn-row">
        <input id="gp-new" class="answer-input" placeholder="或新建群組名稱" />
        <button class="btn" id="gp-create">新建</button>
      </div>
      <div class="btn-row">
        <button class="btn primary" id="gp-save">儲存</button>
        <button class="btn" id="gp-close">取消</button>
      </div>
    </div>`;
  m.classList.add('show');
  document.getElementById('gp-close').onclick = () => m.classList.remove('show');
  document.getElementById('gp-create').onclick = async () => {
    const name = document.getElementById('gp-new').value.trim();
    if (!name) return;
    await createTag(State.profile.id, name);
    openGroupPicker(wordIds, mode, onDone); // 重新開啟以顯示新群組
  };
  document.getElementById('gp-save').onclick = async () => {
    const checked = [...document.querySelectorAll('#gp-list input:checked')].map((c) => c.value);
    if (mode === 'set') {
      await setWordTags(State.profile, wordIds[0], checked);
    } else {
      for (const tid of checked) await addWordsToTag(State.profile, wordIds, tid);
    }
    m.classList.remove('show');
    if (onDone) onDone();
  };
}

// ============================================================
// 手動出題（把自選單字排到某一天）
// ============================================================
async function createManualGroup(date, name, wordIds, testTypes = null) {
  const id = 'mg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const g = {
    id, profileId: State.profile.id, date, name: name.trim() || '手動單字組', manual: true,
    group: { wordIds: [...new Set(wordIds)], memo: '', memos: [], label: name, groupKey: null },
    readDone: false, progress: {}, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (testTypes) g.testTypes = testTypes; // 題型（拼字／造句）由出題碼指定；未指定＝兩者都測
  await putManualGroup(g);
  return g;
}

// 排程 modal：把一批字排到某天（供「我的單字」批次使用）
function openScheduleModal(wordIds, onDone) {
  const today = todayStr();
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>把 ${wordIds.length} 個字排到某天</h3>
      <label>日期
        <input type="date" id="sch-date" class="answer-input" value="${today}" min="${today}" />
      </label>
      <input id="sch-name" class="answer-input" placeholder="單字組名稱（如：段考第3課）" />
      <div class="btn-row">
        <button class="btn primary" id="sch-ok">建立手動組</button>
        <button class="btn" id="sch-cancel">取消</button>
      </div>
    </div>`;
  m.classList.add('show');
  document.getElementById('sch-cancel').onclick = () => m.classList.remove('show');
  document.getElementById('sch-ok').onclick = async () => {
    const date = document.getElementById('sch-date').value;
    const name = document.getElementById('sch-name').value.trim();
    if (!date) { alert('請選日期'); return; }
    await createManualGroup(date, name || '手動單字組', wordIds);
    m.classList.remove('show');
    alert(`✅ 已把 ${wordIds.length} 個字排到 ${prettyDate(date)}`);
    if (onDone) onDone();
  };
}

// 手動出題建立頁（搜尋挑字）
const ManualBuilder = { date: null, wordIds: [] };

function renderManualBuilder() {
  if (!ManualBuilder.date) ManualBuilder.date = todayStr();
  const today = todayStr();
  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="mb-back">‹ 日曆</button><b>✋ 手動出題</b></div>
      <p class="hint-area">自選一批單字排到某天，當天會多一個「手動單字組」，走「先讀→拼字＋造句」。</p>
      <label>排到哪一天
        <input type="date" id="mb-date" class="answer-input" value="${ManualBuilder.date}" min="${today}" />
      </label>
      <input id="mb-name" class="answer-input" placeholder="單字組名稱（如：第二次段考）" />
      <input id="mb-search" class="answer-input" placeholder="搜尋單字加入（英文或中文）" />
      <div id="mb-results"></div>
    </div>
    <div class="card">
      <div class="row-meta">已選 <b id="mb-count">${ManualBuilder.wordIds.length}</b> 字</div>
      <div id="mb-selected" class="fam-chips"></div>
      <button class="btn primary big-copy" id="mb-create">建立手動單字組</button>
      <p id="mb-status" class="hint-area"></p>
    </div>`;
  document.getElementById('mb-back').onclick = () => renderCalendar();
  document.getElementById('mb-date').onchange = (e) => { ManualBuilder.date = e.target.value; };
  const searchEl = document.getElementById('mb-search');
  searchEl.oninput = () => drawManualResults(searchEl.value);
  document.getElementById('mb-create').onclick = async () => {
    if (!ManualBuilder.wordIds.length) { alert('請先加入至少一個字'); return; }
    const name = document.getElementById('mb-name').value.trim();
    const g = await createManualGroup(ManualBuilder.date, name || '手動單字組', ManualBuilder.wordIds);
    const d = g.date;
    ManualBuilder.wordIds = [];
    document.getElementById('mb-status').textContent = `✅ 已建立並排到 ${prettyDate(d)}，可在日曆點該天開始。`;
    drawManualSelected();
    document.getElementById('mb-count').textContent = '0';
  };
  drawManualSelected();
  drawManualResults('');
}

function drawManualResults(q) {
  const box = document.getElementById('mb-results');
  if (!box) return;
  const matches = searchWords(q, 20);
  if (!q.trim()) { box.innerHTML = ''; return; }
  if (!matches.length) { box.innerHTML = `<p class="hint-area">查無「${esc(q)}」，可在「查單字」自動上網查後再排。</p>`; return; }
  box.innerHTML = matches.map((e) => {
    const added = ManualBuilder.wordIds.includes(e.id);
    return `<div class="row" data-add="${e.id}">
      <div class="row-main"><span class="row-word">${esc(e.word)}</span><span class="row-zh">${esc(e.zh)}</span></div>
      <div class="row-meta"><span>${e.level === 0 ? '我查的字' : 'Lv' + e.level}</span><span>${added ? '✓ 已加入' : '＋ 加入'}</span></div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-add]').forEach((r) => {
    r.onclick = () => {
      const id = r.dataset.add;
      if (!ManualBuilder.wordIds.includes(id)) ManualBuilder.wordIds.push(id);
      drawManualResults(document.getElementById('mb-search').value);
      drawManualSelected();
      document.getElementById('mb-count').textContent = ManualBuilder.wordIds.length;
    };
  });
}

function drawManualSelected() {
  const box = document.getElementById('mb-selected');
  if (!box) return;
  box.innerHTML = ManualBuilder.wordIds.map((id) => {
    const e = getById(id);
    return e ? `<span class="fam-chip" data-rm="${id}">${esc(e.word)} ✕</span>` : '';
  }).join('') || '<span class="hint-area">尚未選字</span>';
  box.querySelectorAll('[data-rm]').forEach((c) => {
    c.onclick = () => {
      ManualBuilder.wordIds = ManualBuilder.wordIds.filter((w) => w !== c.dataset.rm);
      drawManualSelected();
      drawManualResults(document.getElementById('mb-search').value);
      document.getElementById('mb-count').textContent = ManualBuilder.wordIds.length;
    };
  });
}

// 對某群組進行「先讀＋拼字＋造句」測驗（虛擬計畫，不寫入日曆）
async function startGroupTest(tag) {
  const wordIds = await wordsInTag(State.profile.id, tag.id);
  if (!wordIds.length) { alert('這個群組還沒有字'); return; }
  Daily.plan = {
    isGroup: true, groupName: tag.name, tagId: tag.id, backTo: 'groups',
    group: { wordIds, memo: `群組：${tag.name}`, memos: [], label: tag.name, groupKey: null },
    readDone: false, progress: {},
  };
  Daily.date = todayStr();
  Daily.spellSession = null; Daily.sentQueue = null; Daily.sentIdx = 0;
  renderDayList();
}

// 測驗方式選擇器：拼字／造句／兩者都測
function openTestTypePicker(wordIds, name, backTo) {
  if (!wordIds.length) { alert('沒有可測的字'); return; }
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>測驗 ${wordIds.length} 個字</h3>
      <p class="hint-area">要測什麼？（造句測驗只測有例句的字）</p>
      <div class="btn-row"><button class="btn primary big-copy" data-t="both">📝 兩者都測（拼字＋造句）</button></div>
      <div class="btn-row">
        <button class="btn" data-t="spelling">✏️ 只測拼字</button>
        <button class="btn" data-t="sentence">🧩 只測造句</button>
      </div>
      <button class="btn" id="tp-close">取消</button>
    </div>`;
  m.classList.add('show');
  m.querySelectorAll('[data-t]').forEach((b) => {
    b.onclick = () => {
      m.classList.remove('show');
      const t = b.dataset.t;
      const types = t === 'both' ? { spelling: true, sentence: true }
        : t === 'spelling' ? { spelling: true, sentence: false }
          : { spelling: false, sentence: true };
      startWordsTest(wordIds, name, types, backTo);
    };
  });
  document.getElementById('tp-close').onclick = () => m.classList.remove('show');
}

// 把一批字轉成連續測驗（虛擬計畫、不寫日曆、不先讀，直接考）
function startWordsTest(wordIds, name, types, backTo) {
  if (!wordIds.length) { alert('沒有可測的字'); return; }
  if (types.sentence && !types.spelling) {
    const anyEx = wordIds.some((id) => { const e = getById(id); return e && e.example && e.example.trim(); });
    if (!anyEx) { alert('這些字目前還沒有例句，無法造句測驗'); return; }
  }
  Daily.plan = {
    isGroup: true, groupName: name, backTo: backTo || 'mywords', testTypes: types,
    group: { wordIds: wordIds.slice(), memo: '', memos: [], label: name, groupKey: null },
    readDone: true, progress: {}, // 跳過先讀，直接測
  };
  Daily.date = todayStr();
  Daily.spellSession = null; Daily.sentQueue = null; Daily.sentIdx = 0;
  dispatchDaily();
}

// ============================================================
// 查單字（自動記錄）
// ============================================================
function renderLookup() {
  $main().innerHTML = `
    <div class="card">
      <h2>查單字</h2>
      <div class="btn-row">
        <input id="lk-input" class="answer-input" type="text" placeholder="輸入單字或片語（如 electricity bill）"
          autocapitalize="off" autocorrect="off" spellcheck="false" />
        <button class="btn primary" id="lk-go">查詢</button>
      </div>
      <p class="hint-area">支援詞組／片語。本機查無會自動上網查；查詢成功自動加入待學清單（免按鈕）。</p>
    </div>
    <div id="lk-result"></div>`;
  const input = document.getElementById('lk-input');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLookup(); });
  document.getElementById('lk-go').onclick = doLookup;
  // 從其他畫面點字進來：自動帶入並查詢
  if (PendingLookup) {
    const t = PendingLookup; PendingLookup = null;
    input.value = t;
    doLookup();
  }
}

async function doLookup() {
  const input = document.getElementById('lk-input');
  const term = input.value.trim();
  if (!term) return;
  const out = document.getElementById('lk-result');
  out.innerHTML = `<div class="card center">查詢中…</div>`;
  await refreshMastered();

  try {
    const { entry, dict, recordStatus, autoAdded } = await lookupWord(State.profile, term);
    if (entry) return renderEntryResult(entry, dict, { autoAdded, recordStatus });
    // 本機 6000 字查無 → 處理上網查 / 片語 / 自訂單字
    return renderNotFound(term, dict);
  } catch (e) {
    out.innerHTML = `<div class="card"><p>⚠️ 查詢發生問題：${esc(e.message)}</p>
      <p class="hint-area">已避免崩潰；可稍後再試或手動補中文加入。</p></div>`;
  }
}

// 本機查無：線上查到→自動建為自訂單字；查不到/離線→手動補中文加入
async function renderNotFound(term, dict) {
  const out = document.getElementById('lk-result');
  // 線上字典查到（有釋義或例句）→ 自動建立「自訂單字」並記錄
  if (dict && (dict.definition || (dict.examples && dict.examples.length))) {
    const { entry } = await createCustomWord(State.profile, term, { dict });
    return renderEntryResult(entry, dict, { recordStatus: 'new', justCreated: true });
  }
  // 查不到（片語常見）或離線 → 手動補中文
  const offline = !navigator.onLine;
  out.innerHTML = `
    <div class="card">
      <div class="result info">${offline ? '📴 目前離線，無法上網查新字'
        : `線上字典也查不到「${esc(term)}」`}</div>
      <p class="hint-area">${offline ? '連網後可查片語/新字。你仍可先手動補中文後加入待學。'
        : '片語或新字字典常查不到，請手動補上中文意思後加入：'}</p>
      <div class="btn-row">
        <input id="m-zh" class="answer-input" placeholder="輸入中文意思（如「電費帳單」）" />
        <button class="btn primary" id="m-add">加入待學</button>
      </div>
    </div>`;
  document.getElementById('m-add').onclick = async () => {
    const zh = document.getElementById('m-zh').value.trim();
    const { entry } = await createCustomWord(State.profile, term, { zh, dict });
    renderEntryResult(entry, dict, { recordStatus: 'new', justCreated: true });
  };
}

// 顯示查詢結果卡片（本機字與自訂字共用）
function renderEntryResult(entry, dict, { autoAdded, recordStatus, justCreated } = {}) {
  const out = document.getElementById('lk-result');
  const cat = displayCategory(recordStatus || 'new');
  const isMastered = cat === 'mastered' || cat === 'proficient';
  let banner;
  if (justCreated) {
    banner = `<div class="result ok">✅ 已加入「我查的字」清單${entry.zh ? '' : '（記得補上中文意思）'}</div>`;
  } else if (autoAdded) {
    banner = `<div class="result ok">✅ 已自動加入待學清單</div>`;
  } else if (isMastered) {
    banner = `<div class="result ok">你已學會這個字 ✅（不重複加入）</div>`;
  } else {
    banner = `<div class="result info">已在你的清單中（${statusBadge(recordStatus)}）</div>`;
  }

  let controls;
  if (entry.custom) {
    controls = `
      <div class="btn-row">
        <input id="edit-zh" class="answer-input" placeholder="補／改中文意思" value="${esc(entry.zh || '')}" />
        <button class="btn primary" id="save-zh">儲存中文</button>
      </div>
      <div class="btn-row">
        <button class="btn" id="quiz-this">立即測這個字</button>
        <button class="btn danger" id="del-custom">🗑 刪除這個字</button>
      </div>`;
  } else {
    controls = `
      <div class="btn-row">
        <button class="btn" id="quiz-this">立即測這個字</button>
        ${isMastered
          ? `<button class="btn" id="readd">再次加入複習</button>`
          : `<button class="btn danger" id="remove">我其實已會 → 移除</button>`}
      </div>`;
  }

  const groupBtn = `<div class="btn-row"><button class="btn" id="add-group">🏷 加入群組</button></div>`;
  out.innerHTML = `${banner}${cardHTML(entry, dict)}${controls}${groupBtn}`;
  attachCardHandlers(entry);
  document.getElementById('add-group').onclick = () =>
    openGroupPicker([entry.id], 'set', () => renderEntryResult(entry, dict, { recordStatus }));
  const qt = document.getElementById('quiz-this');
  if (qt) qt.onclick = () => quizSingle(entry);
  const rm = document.getElementById('remove');
  if (rm) rm.onclick = async () => { await deleteRecord(State.profile.id, entry.id); doLookup(); };
  const ra = document.getElementById('readd');
  if (ra) ra.onclick = async () => { await addToReview(State.profile, entry); doLookup(); };
  const sz = document.getElementById('save-zh');
  if (sz) sz.onclick = async () => {
    await updateCustomZh(entry, document.getElementById('edit-zh').value.trim());
    renderEntryResult(entry, dict, { recordStatus });
    const st = document.getElementById('lk-result');
  };
  const dc = document.getElementById('del-custom');
  if (dc) dc.onclick = async () => {
    if (!confirm(`確定刪除自訂單字「${entry.word}」？`)) return;
    await deleteCustomWord(State.profile, entry);
    out.innerHTML = `<div class="card center">已刪除「${esc(entry.word)}」</div>`;
  };
}

function doLookupTerm(term) {
  document.getElementById('lk-input').value = term;
  doLookup();
}

// 單字即時測驗（從清單或查單字觸發）
function quizSingle(entry) {
  State.quizMode = 'active';
  State.session = new Session([{ wordId: entry.id, level: entry.level, kind: 'review' }]);
  location.hash = '#quiz';
  if (location.hash === '#quiz') route(); else showQuestion();
}

// ============================================================
// 我的單字（總表）
// ============================================================
const MyWordsFilter = { status: 'all', level: 'all', group: 'all', q: '', sort: 'recent' };
const MyWordsSel = { on: false, ids: new Set() };
const MyWordsView = { ids: [] }; // 目前篩選出的全部字（供「測這些字」）

async function renderMyWords() {
  const recs = await getRecordsByProfile(State.profile.id);
  const tags = await getTags(State.profile.id);
  $main().innerHTML = `
    <div class="card">
      <div class="mw-head">
        <h2>我的單字（${recs.length}）</h2>
        <a class="btn" href="#groups" id="mw-groups">🏷 群組</a>
      </div>
      <div class="filters">
        <select id="f-status">
          <option value="all">全部狀態</option>
          <option value="new">🌱 未測驗</option>
          <option value="weak">🌿 學習中</option>
          <option value="mastered">🌳 已熟記</option>
          <option value="proficient">🌲 穩固</option>
        </select>
        <select id="f-level">
          <option value="all">全部級別</option>
          ${[1, 2, 3, 4, 5, 6].map((l) => `<option value="${l}">Level ${l}</option>`).join('')}
          <option value="0">我查的字</option>
        </select>
        <select id="f-group">
          <option value="all">全部群組</option>
          ${tags.map((t) => `<option value="${t.id}">🏷 ${esc(t.name)}</option>`).join('')}
        </select>
        <select id="f-sort">
          <option value="recent">最近新增</option>
          <option value="errors">最常錯</option>
          <option value="due">即將到期</option>
        </select>
      </div>
      <input id="f-q" class="answer-input" placeholder="關鍵字搜尋（英文或中文）" />
      <div class="btn-row">
        <button class="btn primary" id="mw-test">▶️ 測這些字</button>
        <button class="btn" id="mw-select">${MyWordsSel.on ? '✕ 取消多選' : '☑ 多選'}</button>
      </div>
      <div id="mw-selbar" class="${MyWordsSel.on ? '' : 'hidden'}">
        <div class="btn-row">
          <span class="row-meta">已選 <b id="mw-selcount">${MyWordsSel.ids.size}</b> 字</span>
          <button class="btn primary" id="mw-batch">加入群組</button>
          <button class="btn" id="mw-schedule">📅 排到某天</button>
        </div>
      </div>
      ${stageLegendHTML()}
    </div>
    <div id="mw-list"></div>`;

  const sEl = document.getElementById('f-status');
  const lEl = document.getElementById('f-level');
  const gEl = document.getElementById('f-group');
  const sortEl = document.getElementById('f-sort');
  const qEl = document.getElementById('f-q');
  sEl.value = MyWordsFilter.status; lEl.value = MyWordsFilter.level;
  gEl.value = MyWordsFilter.group; sortEl.value = MyWordsFilter.sort; qEl.value = MyWordsFilter.q;

  const update = () => {
    MyWordsFilter.status = sEl.value;
    MyWordsFilter.level = lEl.value;
    MyWordsFilter.group = gEl.value;
    MyWordsFilter.sort = sortEl.value;
    MyWordsFilter.q = qEl.value.trim().toLowerCase();
    drawMyWords(recs);
  };
  [sEl, lEl, gEl, sortEl].forEach((e) => e.onchange = update);
  qEl.oninput = update;

  document.getElementById('mw-select').onclick = () => {
    MyWordsSel.on = !MyWordsSel.on; MyWordsSel.ids.clear(); renderMyWords();
  };
  document.getElementById('mw-test').onclick = () => {
    const useSel = MyWordsSel.on && MyWordsSel.ids.size > 0;
    const ids = useSel ? [...MyWordsSel.ids] : MyWordsView.ids.slice();
    if (!ids.length) { alert('沒有可測的字'); return; }
    let name;
    if (useSel) name = `選取的 ${ids.length} 字`;
    else if (MyWordsFilter.group !== 'all') {
      const tagSel = document.getElementById('f-group');
      name = (tagSel.options[tagSel.selectedIndex].text || '群組').replace('🏷 ', '');
    } else name = `我的單字（${ids.length}）`;
    openTestTypePicker(ids, name, 'mywords');
  };
  const batchBtn = document.getElementById('mw-batch');
  if (batchBtn) batchBtn.onclick = () => {
    if (!MyWordsSel.ids.size) { alert('請先勾選單字'); return; }
    openGroupPicker([...MyWordsSel.ids], 'add', () => { MyWordsSel.on = false; MyWordsSel.ids.clear(); renderMyWords(); });
  };
  const schedBtn = document.getElementById('mw-schedule');
  if (schedBtn) schedBtn.onclick = () => {
    if (!MyWordsSel.ids.size) { alert('請先勾選單字'); return; }
    openScheduleModal([...MyWordsSel.ids], () => { MyWordsSel.on = false; MyWordsSel.ids.clear(); renderMyWords(); });
  };

  drawMyWords(recs);
}

function drawMyWords(recs) {
  let rows = recs.map((r) => ({ rec: r, entry: getById(r.wordId) })).filter((x) => x.entry);

  if (MyWordsFilter.status !== 'all')
    rows = rows.filter((x) => displayCategory(x.rec.status) === MyWordsFilter.status);
  if (MyWordsFilter.level !== 'all')
    rows = rows.filter((x) => String(x.entry.level) === MyWordsFilter.level);
  if (MyWordsFilter.group !== 'all')
    rows = rows.filter((x) => x.rec.tags && x.rec.tags.includes(MyWordsFilter.group));
  if (MyWordsFilter.q) {
    const q = MyWordsFilter.q;
    rows = rows.filter((x) => x.entry.word.toLowerCase().includes(q) || (x.entry.zh || '').includes(q));
  }

  if (MyWordsFilter.sort === 'recent') rows.sort((a, b) => b.rec.addedAt - a.rec.addedAt);
  else if (MyWordsFilter.sort === 'errors')
    rows.sort((a, b) => (b.rec.attempts - b.rec.correct) - (a.rec.attempts - a.rec.correct));
  else if (MyWordsFilter.sort === 'due') rows.sort((a, b) => a.rec.due - b.rec.due);

  MyWordsView.ids = rows.map((x) => x.entry.id); // 目前篩選出的全部字（供「測這些字」）

  const list = document.getElementById('mw-list');
  if (!rows.length) { list.innerHTML = `<div class="card center">沒有符合的單字</div>`; return; }

  const sel = MyWordsSel.on;
  list.innerHTML = rows.slice(0, 300).map((x) => {
    const r = x.rec, e = x.entry;
    const acc = r.attempts ? Math.round((r.correct / r.attempts) * 100) : 0;
    const dueStr = r.attempts ? prettyDate(todayStr(new Date(r.due))) : '—';
    const check = sel ? `<input type="checkbox" class="mw-chk" ${MyWordsSel.ids.has(e.id) ? 'checked' : ''}/> ` : '';
    return `<div class="row ${sel ? 'selrow' : ''}" data-id="${e.id}">
      <div class="row-main">
        <span class="row-word">${check}${esc(e.word)}${e.custom ? ' <span class="tag-custom sm">🔖我查的</span>' : ''}</span>
        <span class="row-zh">${esc(e.zh)}</span>
      </div>
      <div class="row-meta">
        <span>${e.level === 0 ? '我查的字' : 'Lv' + e.level}</span>
        <span>${statusBadge(r.status)}</span>
        <span>到期 ${dueStr}</span>
        <span>答對率 ${acc}%</span>
      </div>
    </div>`;
  }).join('') + (rows.length > 300 ? `<div class="card center">（僅顯示前 300 筆，請用篩選縮小範圍）</div>` : '');

  list.querySelectorAll('.row').forEach((row) => {
    row.onclick = () => {
      const id = row.dataset.id;
      if (MyWordsSel.on) {
        if (MyWordsSel.ids.has(id)) MyWordsSel.ids.delete(id); else MyWordsSel.ids.add(id);
        const chk = row.querySelector('.mw-chk'); if (chk) chk.checked = MyWordsSel.ids.has(id);
        const c = document.getElementById('mw-selcount'); if (c) c.textContent = MyWordsSel.ids.size;
      } else {
        openWordDetail(id);
      }
    };
  });
}

async function openWordDetail(wordId) {
  await refreshMastered();
  const entry = getById(wordId);
  const dict = (entry.custom || (entry.example && entry.example.trim()))
    ? null : await fetchDict(entry.word.replace(/\(.*?\)/g, '').trim());
  const rec = await getRecord(State.profile.id, wordId);
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      ${cardHTML(entry, dict)}
      <div class="row-meta">狀態：${rec ? statusBadge(rec.status) : '未加入'}　答對率：${rec && rec.attempts ? Math.round(rec.correct / rec.attempts * 100) : 0}%</div>
      ${entry.custom ? `
      <div class="btn-row">
        <input id="md-zh" class="answer-input" placeholder="補／改中文意思" value="${esc(entry.zh || '')}" />
        <button class="btn" id="md-savezh">儲存中文</button>
      </div>` : ''}
      <div class="btn-row">
        <button class="btn primary" id="md-quiz">立即測這個字</button>
        <button class="btn" id="md-group">🏷 群組</button>
      </div>
      <div class="btn-row">
        <button class="btn" id="md-weak">標記需重練</button>
        <button class="btn" id="md-known">標記我已會</button>
        ${entry.custom ? `<button class="btn danger" id="md-del">🗑 刪除自訂字</button>` : ''}
      </div>
      <button class="btn" id="md-close">關閉</button>
    </div>`;
  m.classList.add('show');
  attachCardHandlers(entry);
  document.getElementById('md-close').onclick = () => m.classList.remove('show');
  document.getElementById('md-group').onclick = () =>
    openGroupPicker([wordId], 'set', () => { renderMyWords(); });
  document.getElementById('md-quiz').onclick = () => { m.classList.remove('show'); quizSingle(entry); };
  document.getElementById('md-weak').onclick = async () => {
    await addToReview(State.profile, entry); m.classList.remove('show'); renderMyWords();
  };
  document.getElementById('md-known').onclick = async () => {
    await markKnown(entry); m.classList.remove('show'); renderMyWords();
  };
  const mdSaveZh = document.getElementById('md-savezh');
  if (mdSaveZh) mdSaveZh.onclick = async () => {
    await updateCustomZh(entry, document.getElementById('md-zh').value.trim());
    m.classList.remove('show'); renderMyWords();
  };
  const mdDel = document.getElementById('md-del');
  if (mdDel) mdDel.onclick = async () => {
    if (!confirm(`確定刪除自訂單字「${entry.word}」？`)) return;
    await deleteCustomWord(State.profile, entry); m.classList.remove('show'); renderMyWords();
  };
}

// 標記「我已會」：設為已熟記狀態
async function markKnown(entry) {
  let rec = await getRecord(State.profile.id, entry.id);
  const now = Date.now();
  if (!rec) {
    rec = { key: `${State.profile.id}::${entry.id}`, profileId: State.profile.id, wordId: entry.id, level: entry.level, ef: 2.5, addedAt: now };
  }
  rec.status = 'mastered';
  rec.reps = Math.max(rec.reps || 0, 3);
  rec.interval = Math.max(rec.interval || 0, 7);
  rec.due = dayStart(now) + rec.interval * DAY_MS;
  rec.lastResult = 'correct';
  rec.attempts = Math.max(rec.attempts || 0, 1);
  rec.correct = Math.max(rec.correct || 0, 1);
  rec.streak = Math.max(rec.streak || 0, 1);
  rec.updatedAt = now;
  await putRecord(rec);
}

// ============================================================
// 設定
// ============================================================
// ============================================================
// L-1「更多」頁：把次要／管理／家長功能集中，清楚分區、好找
// ============================================================
// 產生一列可點的功能入口
function moreRow(icon, title, desc, onClick, badge = '') {
  const id = 'mr-' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => { const el = document.getElementById(id); if (el) el.onclick = onClick; }, 0);
  return `<div class="row tap more-row" id="${id}"><div class="row-main">
      <span class="row-word">${icon} ${esc(title)}${badge ? ` <span class="tag-custom sm">${badge}</span>` : ''}</span>
      <span class="row-zh">${esc(desc)}</span></div>
      <div class="row-meta"><span>›</span></div></div>`;
}

function renderMore() {
  $main().innerHTML = `
    <div class="card">
      <h2>⋯ 更多</h2>
      <p class="hint-area">日常學習在下方導覽列（首頁／學習／測驗／我的字）。這裡放工具、管理與家長功能。</p>
    </div>

    <div class="card">
      <h3>🧰 學習工具</h3>
      <div class="detail-list">
        ${moreRow('🔎', '查單字', '查 6000 字或上網查新字／片語，自動加入待學', () => go('#lookup'))}
        ${moreRow('🌱', '字根字首', '用字根字首規律成組記憶', () => go('#roots'))}
      </div>
    </div>

    <div class="card">
      <h3>🗂 我的內容</h3>
      <div class="detail-list">
        ${moreRow('🏷', '群組管理', '把 6000 字貼標籤分組（如「二次段考」），可整組測', () => go('#groups'))}
        ${moreRow('📓', '自訂單字本', '完全自己打的內容（片語、成語、講義），可轉測驗', () => go('#custombook'))}
      </div>
    </div>

    <div class="card">
      <h3>📊 記錄</h3>
      <div class="detail-list">
        ${moreRow('📊', '每日報告', '複製當天學習成果傳給家長（LINE）', () => go('#report'))}
      </div>
    </div>

    <div class="card parent-entry">
      <h3>👨‍👩‍👧 家長專區</h3>
      <p class="hint-area">在「家長電腦」排整月進度、出題、列印講義與出題碼／QR。</p>
      <div class="detail-list">
        ${moreRow('🖨️', '家長出題／列印', '月排程、出題碼（QR）、背誦版／考卷版列印', () => go('#parent'))}
      </div>
    </div>

    <div class="card">
      <h3>⚙️ 系統</h3>
      <div class="detail-list">
        ${moreRow('👤', '身分與設定', '切換／新增使用者、每日字數、級別、外觀', () => go('#settings'))}
        ${moreRow('💾', '匯出／匯入備份', '換手機或保險用（在設定頁底部）', () => go('#settings'))}
        ${moreRow('⏰', '每日練習提醒', '設定提醒時間、加入手機行事曆（在設定頁底部）', () => go('#settings'))}
      </div>
    </div>
    <p class="ver-tag">版本 ${APP_UI_VERSION}</p>`;
}

// 裝置分工白話說明（家長專區與相關頁共用）
function deviceRoleNoteHTML() {
  return `<div class="card role-note">
      <h3>📱💻 這套系統怎麼分工？</h3>
      <p>這是純本機 App、<b>沒有雲端</b>。兩台裝置各做各的：</p>
      <ul class="role-list">
        <li><b>家長電腦</b>：排整月進度、出題、列印，產生每天的<b>出題碼／QR</b>。這些排程與題目<b>只存在這台電腦</b>。</li>
        <li><b>孩子手機</b>：掃 QR／貼出題碼載入「要考哪些字」，作答、記錄、複習、週月測都存在手機。</li>
      </ul>
      <p class="hint-area">兩邊只用出題碼單向傳「要考哪些字」，<b>不會傳成績</b>。要看成績，請用孩子手機「每日報告 → 複製」傳給家長。</p>
    </div>`;
}

// ============================================================
// L-3 家長專區：月排程 + 出題碼(QR) + 列印
// 排程存在家長裝置（meta: parentSchedule::<pid>），只單向用出題碼把「要考哪些字」帶到孩子手機。
// ============================================================
const Parent = { sched: null };

async function loadParentSchedule() {
  Parent.sched = (await getMeta(`parentSchedule::${State.profile.id}`)) || null;
  return Parent.sched;
}
async function saveParentSchedule() {
  await setMeta(`parentSchedule::${State.profile.id}`, Parent.sched);
}

// 產生 QR 的 SVG（用離線 vendor window.qrcode，自動選容量）
function qrSvg(text, cell = 4) {
  try {
    if (!window.qrcode) return '<p class="hint-area">QR 產生器尚未載入，請用下方出題碼。</p>';
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return `<div class="qr-box">${qr.createSvgTag(cell, 2)}</div>`;
  } catch (e) {
    return '<p class="hint-area">資料較長，QR 無法產生，請改用下方出題碼。</p>';
  }
}

async function renderParentZone() {
  await loadParentSchedule();
  const s = State.profile.settings;
  const today = todayStr();
  const defEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 29); return todayStr(d); })();
  const hasSched = Parent.sched && Parent.sched.days && Parent.sched.days.length;

  $main().innerHTML = `
    <div class="card">
      <h2>👨‍👩‍👧 家長專區</h2>
      <p class="hint-area">在電腦上為 <b>${esc(State.profile.name)}</b> 排題、出題、列印。孩子作答與成績都在手機端。切換上方使用者可為不同孩子排程。</p>
    </div>
    ${deviceRoleNoteHTML()}
    <div class="card">
      <h3>🗓 一鍵排整月</h3>
      <p class="hint-area">從指定級別自動抽字、逐日填入，<b>跨日不重複</b>、依字根／字首記憶法成組。排好後可手動微調。</p>
      <div>出題級別：</div>
      <div class="level-checks">
        ${[1, 2, 3, 4, 5, 6].map((l) => `<label class="chk"><input type="checkbox" class="pz-lv" value="${l}" ${(s.levels || []).includes(l) ? 'checked' : ''}/> Lv${l}</label>`).join('')}
      </div>
      <label>每日單字數 <input id="pz-per" class="answer-input ts-num" type="number" min="3" max="30" value="${s.dailyNewLimit || 15}" /></label>
      <div class="btn-row">
        <label>起 <input type="date" id="pz-start" class="answer-input" value="${today}" /></label>
        <label>迄 <input type="date" id="pz-end" class="answer-input" value="${defEnd}" /></label>
      </div>
      <label class="chk"><input type="checkbox" id="pz-review" checked /> 新字排完後，接著排「複習輪」</label>
      <button class="btn primary" id="pz-gen">${hasSched ? '重新排整月（會覆蓋目前排程）' : '產生月排程'}</button>
    </div>
    ${hasSched ? `<div class="card">
      <h3>📋 目前月排程</h3>
      <p class="hint-area">${prettyDate(Parent.sched.config.startDate)} ~ ${prettyDate(Parent.sched.config.endDate)}，每日 ${Parent.sched.config.perDay} 字，共 ${Parent.sched.days.length} 天。</p>
      <div class="btn-row">
        <button class="btn primary" id="pz-view">查看／編輯／出題碼</button>
        <button class="btn" id="pz-print-all">🖨️ 列印整月</button>
      </div>
    </div>` : ''}
    <div class="card">
      <h3>✋ 手動出題（排字到某天）</h3>
      <p class="hint-area">臨時自選一批字排到日曆某天（不走月排程）。</p>
      <button class="btn" id="pz-manual">開啟手動出題</button>
    </div>`;

  document.getElementById('pz-gen').onclick = generateSchedule;
  document.getElementById('pz-manual').onclick = () => go('#manual');
  const vbtn = document.getElementById('pz-view');
  if (vbtn) vbtn.onclick = () => renderScheduleView();
  const pall = document.getElementById('pz-print-all');
  if (pall) pall.onclick = () => openPrintPicker(Parent.sched.days);
}

async function generateSchedule() {
  const levels = [...document.querySelectorAll('.pz-lv:checked')].map((c) => Number(c.value));
  if (!levels.length) { alert('請至少選一個級別'); return; }
  const perDay = Math.max(3, Math.min(30, parseInt(document.getElementById('pz-per').value, 10) || 15));
  const startDate = document.getElementById('pz-start').value;
  const endDate = document.getElementById('pz-end').value;
  const includeReview = document.getElementById('pz-review').checked;
  if (!startDate || !endDate || endDate < startDate) { alert('請確認起迄日期'); return; }
  const records = await getRecordsByProfile(State.profile.id);
  Parent.sched = buildMonthSchedule(records, { levels, perDay, startDate, endDate, includeReview });
  await saveParentSchedule();
  const newDays = Parent.sched.days.filter((d) => d.kind === 'new').length;
  alert(`✅ 已排 ${Parent.sched.days.length} 天，其中新字 ${newDays} 天。可查看並微調。`);
  renderScheduleView();
}

function renderScheduleView() {
  const days = Parent.sched.days;
  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="sv-back">‹ 家長專區</button><b>🗓 月排程</b></div>
      <p class="hint-area">每天一張卡：可換一批、加字、移除字，或產生出題碼／QR 給孩子掃。</p>
      <div class="btn-row"><button class="btn" id="sv-print">🖨️ 列印整月</button></div>
    </div>
    <div id="sv-list">${days.map((d, i) => scheduleDayCard(d, i)).join('')}</div>`;
  document.getElementById('sv-back').onclick = () => renderParentZone();
  document.getElementById('sv-print').onclick = () => openPrintPicker(days);
  bindScheduleDayActions();
}

function scheduleDayCard(day, idx) {
  const groups = day.groups.map((g) => `
    <div class="sched-group">
      <div class="sched-memo">🔑 ${esc(g.label)}${g.memo ? '：' + esc(g.memo) : ''}</div>
      <div class="fam-chips">${g.wordIds.map((id) => { const e = getById(id); return e ? `<span class="fam-chip" data-day="${idx}" data-rm="${id}">${esc(e.word)} ✕</span>` : ''; }).join('')}</div>
    </div>`).join('') || '<p class="hint-area">（這天沒有字）</p>';
  return `<div class="card sched-day" data-idx="${idx}">
    <div class="grp-head"><b>${prettyDate(day.date)}　${KIND_LABEL[day.kind] || ''}</b><span class="row-meta">${day.wordIds.length} 字</span></div>
    ${groups}
    <div class="btn-row">
      ${day.kind === 'new' ? `<button class="btn sm" data-regen="${idx}">🔄 換一批</button>` : ''}
      <button class="btn sm" data-add="${idx}">＋ 加字</button>
      <button class="btn sm primary" data-code="${idx}">🔳 出題碼／QR</button>
      <button class="btn sm" data-printday="${idx}">🖨️ 列印當日</button>
    </div>
  </div>`;
}

function bindScheduleDayActions() {
  const rerender = async () => { await saveParentSchedule(); renderScheduleView(); };
  document.querySelectorAll('#sv-list [data-rm]').forEach((c) => {
    c.onclick = async () => {
      const idx = Number(c.dataset.day); const id = c.dataset.rm;
      const day = Parent.sched.days[idx];
      day.wordIds = day.wordIds.filter((w) => w !== id);
      regroupDay(Parent.sched, day.date);
      await rerender();
    };
  });
  document.querySelectorAll('#sv-list [data-regen]').forEach((b) => {
    b.onclick = async () => {
      const idx = Number(b.dataset.regen);
      const records = await getRecordsByProfile(State.profile.id);
      regenerateDay(Parent.sched, records, Parent.sched.days[idx].date);
      await rerender();
    };
  });
  document.querySelectorAll('#sv-list [data-add]').forEach((b) => {
    b.onclick = () => openAddWordToDay(Number(b.dataset.add));
  });
  document.querySelectorAll('#sv-list [data-code]').forEach((b) => {
    b.onclick = () => openDayCode(Number(b.dataset.code));
  });
  document.querySelectorAll('#sv-list [data-printday]').forEach((b) => {
    b.onclick = () => openPrintPicker([Parent.sched.days[Number(b.dataset.printday)]]);
  });
}

function openAddWordToDay(idx) {
  const day = Parent.sched.days[idx];
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>加字到 ${prettyDate(day.date)}</h3>
      <input id="aw-search" class="answer-input" placeholder="搜尋單字（英文或中文）" />
      <div id="aw-results" class="detail-list"></div>
      <button class="btn" id="aw-close">完成</button>
    </div>`;
  m.classList.add('show');
  const draw = (q) => {
    const box = document.getElementById('aw-results');
    if (!q.trim()) { box.innerHTML = ''; return; }
    const matches = searchWords(q, 15);
    box.innerHTML = matches.length ? matches.map((e) => {
      const inDay = day.wordIds.includes(e.id);
      return `<div class="row tap" data-add="${e.id}"><div class="row-main">
        <span class="row-word">${esc(e.word)}</span><span class="row-zh">${esc(e.zh)}</span></div>
        <div class="row-meta"><span>${e.level === 0 ? '自訂' : 'Lv' + e.level}</span><span>${inDay ? '✓ 已在本日' : '＋ 加入'}</span></div></div>`;
    }).join('') : `<p class="hint-area">查無「${esc(q)}」</p>`;
    box.querySelectorAll('[data-add]').forEach((r) => {
      r.onclick = async () => {
        const id = r.dataset.add;
        if (!day.wordIds.includes(id)) { day.wordIds.push(id); regroupDay(Parent.sched, day.date); await saveParentSchedule(); }
        draw(document.getElementById('aw-search').value);
      };
    });
  };
  document.getElementById('aw-search').oninput = (e) => draw(e.target.value);
  document.getElementById('aw-close').onclick = () => { m.classList.remove('show'); renderScheduleView(); };
}

// 某天的題型設定（家長選；出題碼與紙本 QR 都用同一個）
function dayTypes(day) {
  return day.qtype === 'spelling' ? { spelling: true, sentence: false } : { spelling: true, sentence: true };
}

function openDayCode(idx) {
  const day = Parent.sched.days[idx];
  const skipped = day.wordIds.length - encodableIds(day.wordIds).length;
  const m = document.getElementById('modal');

  const draw = () => {
    const code = encodeWordIds(day.wordIds, dayTypes(day));
    m.innerHTML = `
      <div class="modal-box center">
        <h3>🔳 ${prettyDate(day.date)} 出題碼</h3>
        <p class="hint-area">孩子手機：測驗 → 📷 家長出的題 → 掃這個 QR 或貼下面的碼。</p>
        <div class="src-opts" style="text-align:left">
          <label class="chk"><input type="radio" name="dq" value="both" ${day.qtype !== 'spelling' ? 'checked' : ''}/> 題型：拼字＋造句（有例句的字才考造句）</label>
          <label class="chk"><input type="radio" name="dq" value="spelling" ${day.qtype === 'spelling' ? 'checked' : ''}/> 題型：只考拼字</label>
        </div>
        ${skipped > 0 ? `<p class="hint-area">⚠️ 有 ${skipped} 個「自訂字」無法放入出題碼（自訂字只存在這台裝置），孩子手機不會出現這幾個字。</p>` : ''}
        ${qrSvg(code)}
        <textarea class="answer-input code-box" readonly rows="2">${esc(code)}</textarea>
        <div class="btn-row">
          <button class="btn primary" id="dc-copy">複製出題碼</button>
          <button class="btn" id="dc-close">關閉</button>
        </div>
      </div>`;
    m.querySelectorAll('input[name="dq"]').forEach((r) => {
      r.onchange = async () => {
        day.qtype = m.querySelector('input[name="dq"]:checked').value;
        await saveParentSchedule();
        draw(); // 換題型 → 重新產碼與 QR
      };
    });
    document.getElementById('dc-copy').onclick = async () => {
      const ok = await copyToClipboard(code);
      document.getElementById('dc-copy').textContent = ok ? '✅ 已複製' : '請長按上方文字複製';
    };
    document.getElementById('dc-close').onclick = () => m.classList.remove('show');
  };

  draw();
  m.classList.add('show');
}

// ---- 列印（背誦版／考卷版；A4；可含 QR 與字根記憶輔助） ----
function openPrintPicker(days) {
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>🖨️ 列印（${days.length === 1 ? prettyDate(days[0].date) : `整月 ${days.length} 天`}）</h3>
      <p class="hint-area">背誦版：含中英、詞性、例句、字根拆解與記憶點。考卷版：只留中文與空格，附答案頁。</p>
      <button class="btn primary big-copy" id="pp-recite">📖 背誦版（帶記憶方法）</button>
      <button class="btn big-copy" id="pp-quiz">📝 考卷版（中文→填英文）＋答案頁</button>
      <button class="btn" id="pp-close">取消</button>
    </div>`;
  m.classList.add('show');
  document.getElementById('pp-recite').onclick = () => { m.classList.remove('show'); doPrint('recite', days); };
  document.getElementById('pp-quiz').onclick = () => { m.classList.remove('show'); doPrint('quiz', days); };
  document.getElementById('pp-close').onclick = () => m.classList.remove('show');
}

function rootBreakdownHTML(entry) {
  if (!Array.isArray(entry.root) || !entry.root.length) return '';
  const parts = entry.root.map((p) => `${esc(p.part)}${p.mean ? `(${esc(p.mean)})` : ''}`).join(' + ');
  const mnem = entry.mnemonic ? `　💡 ${esc(entry.mnemonic)}` : '';
  return `<div class="pr-root">🔍 ${parts}${mnem}</div>`;
}

function doPrint(mode, days) {
  const old = document.getElementById('print-root');
  if (old) old.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  // 單日列印：控制在 2 頁 A4 內（一張紙正反面）。依字數自動選緊湊等級；超過 30 字才提醒減量。
  if (days.length === 1) {
    const n = days[0].wordIds.length;
    const tier = n <= 12 ? 1 : n <= 20 ? 2 : 3;
    root.classList.add('pr-single', `pr-compact-${tier}`);
    if (n > 30) alert(`提醒：這天有 ${n} 字，即使最緊湊的版面也可能超過 2 頁。建議把每日字數降到 30 以下再列印。`);
  }
  root.innerHTML = days.map((day) => printDayHTML(mode, day)).join('');
  if (mode === 'quiz') {
    root.innerHTML += `<div class="pr-page pr-answers"><h2>✅ 答案頁</h2>${days.map((day) => `
      <div class="pr-day-ans"><h3>${prettyDate(day.date)}</h3>
      <ol>${day.wordIds.map((id) => { const e = getById(id); return e ? `<li>${esc(e.zh)} — <b>${esc(e.word)}</b></li>` : ''; }).join('')}</ol></div>`).join('')}</div>`;
  }
  document.body.appendChild(root);
  document.body.classList.add('printing');
  const cleanup = () => { document.body.classList.remove('printing'); const r = document.getElementById('print-root'); if (r) r.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 150);
}

function printDayHTML(mode, day) {
  // 紙本 QR 與螢幕出題碼用同一份「題型」設定 → 手機掃紙本或螢幕，題型一致
  const types = dayTypes(day);
  const code = encodeWordIds(day.wordIds, types);
  const qr = qrSvg(code, 3);
  const typeLabel = types.sentence ? '拼字＋造句' : '只考拼字';
  const head = `<div class="pr-head"><h2>${prettyDate(day.date)}　${KIND_LABEL[day.kind] || ''}（${day.wordIds.length} 字・${typeLabel}）</h2>
    <div class="pr-qr">${qr}<div class="pr-code">${esc(code)}</div></div></div>`;

  if (mode === 'quiz') {
    const rows = day.wordIds.map((id, i) => { const e = getById(id); return e ? `
      <tr><td>${i + 1}</td><td>${esc(e.zh)}</td><td class="pr-pos">${esc(e.pos)}</td><td class="pr-blank"></td></tr>` : ''; }).join('');
    return `<div class="pr-page">${head}
      <table class="pr-table"><thead><tr><th>#</th><th>中文</th><th>詞性</th><th>寫出英文</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  // 背誦版：依記憶組列出，每組印共同記憶點；每字印字根拆解與記憶聯想
  const groups = day.groups.map((g) => {
    const items = g.wordIds.map((id) => {
      const e = getById(id); if (!e) return '';
      return `<div class="pr-word">
        <div class="pr-w-main"><b>${esc(e.word)}</b> <span class="pr-pos">${esc(e.pos)}</span> — ${esc(e.zh)}</div>
        ${rootBreakdownHTML(e)}
        ${e.example ? `<div class="pr-ex">${esc(e.example)}<br><span class="pr-ex-zh">${esc(e.example_zh || '')}</span></div>` : ''}
      </div>`;
    }).join('');
    return `<div class="pr-group"><div class="pr-memo">🔑 ${esc(g.label)}${g.memo ? '：' + esc(g.memo) : ''}</div>${items}</div>`;
  }).join('');
  return `<div class="pr-page">${head}${groups}</div>`;
}

// ============================================================
// L-3d 孩子手機：掃 QR / 貼出題碼載入「家長出的題」
// ============================================================
let _scanStream = null;
function renderScan() {
  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="sc-back">‹ 測驗</button><b>📷 家長出的題</b></div>
      <p class="hint-area">用家長電腦上的「出題碼／QR」載入今天要考的字。載入後就地作答，記錄存這支手機。</p>
    </div>
    <div class="card">
      <button class="btn primary big-copy" id="sc-cam">📷 開相機掃 QR</button>
      <div id="sc-video-wrap" class="hidden"><video id="sc-video" playsinline class="sc-video"></video><p class="hint-area">把 QR 對準框內…</p></div>
      <p id="sc-cam-status" class="hint-area"></p>
    </div>
    <div class="card">
      <p class="hint-area">或直接貼上出題碼：</p>
      <textarea id="sc-code" class="answer-input code-box" rows="2" placeholder="貼上 V1... 出題碼"></textarea>
      <button class="btn primary" id="sc-load">載入這批字</button>
      <p id="sc-status" class="hint-area"></p>
    </div>`;
  document.getElementById('sc-back').onclick = () => { stopScan(); go('#quiz'); };
  document.getElementById('sc-load').onclick = () => scanLoadCode(document.getElementById('sc-code').value);
  document.getElementById('sc-cam').onclick = startScan;
}

async function startScan() {
  const status = document.getElementById('sc-cam-status');
  if (!window.jsQR) { status.textContent = '⚠️ 掃描元件未載入，請用貼出題碼。'; return; }
  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) { status.textContent = '⚠️ 無法開啟相機（權限或裝置不支援），請改用貼出題碼。'; return; }
  document.getElementById('sc-video-wrap').classList.remove('hidden');
  const video = document.getElementById('sc-video');
  video.srcObject = _scanStream;
  await video.play();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!_scanStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(img.data, img.width, img.height);
      if (found && found.data) { stopScan(); return scanLoadCode(found.data); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopScan() {
  if (_scanStream) { _scanStream.getTracks().forEach((t) => t.stop()); _scanStream = null; }
  const w = document.getElementById('sc-video-wrap'); if (w) w.classList.add('hidden');
}

async function scanLoadCode(code) {
  const status = document.getElementById('sc-status');
  let decoded;
  try { decoded = decodeCode(code); } catch (e) { if (status) status.textContent = '⚠️ ' + e.message; else alert(e.message); return; }
  const { ids, types } = decoded;
  if (!ids.length) { if (status) status.textContent = '⚠️ 這個碼沒有可載入的字。'; return; }
  const g = await createManualGroup(todayStr(), '家長出的題', ids, types);
  enterGroupStudy(g);
}

// ============================================================
// L-2 自訂單字本：自由輸入的單字本（片語／成語／講義），可轉測驗
// 與「群組」不同：群組是把 6000 字貼標籤；單字本＝完全自己打的內容。
// ============================================================
function cbNewId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

async function renderCustomBooks() {
  const books = await getCustomBooksByProfile(State.profile.id);
  const list = books.sort((a, b) => b.updatedAt - a.updatedAt).map((bk) => `
    <div class="card cb-card">
      <div class="grp-head"><b>📓 ${esc(bk.name)}</b><span class="row-meta">${bk.entries.length} 條</span></div>
      <div class="btn-row">
        <button class="btn primary" data-act="test" data-id="${bk.id}" ${bk.entries.length ? '' : 'disabled'}>▶️ 轉測驗</button>
        <button class="btn" data-act="edit" data-id="${bk.id}">✏️ 編輯</button>
        <button class="btn danger" data-act="del" data-id="${bk.id}">🗑 刪除</button>
      </div>
    </div>`).join('');

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="cb-back">‹ 更多</button><b>📓 自訂單字本</b></div>
      <p class="hint-area">完全自己打內容的單字本（片語、成語、講義自己出）。和「群組」不同：群組是幫 6000 字貼標籤，單字本是自己打題目與答案。</p>
      <div class="btn-row">
        <input id="cb-new" class="answer-input" placeholder="新單字本名稱（如：二段考片語）" />
        <button class="btn primary" id="cb-add">＋ 新增</button>
      </div>
    </div>
    <div id="cb-list">${books.length ? list : '<div class="card center">還沒有單字本，先新增一個吧</div>'}</div>`;

  document.getElementById('cb-back').onclick = () => go('#more');
  document.getElementById('cb-add').onclick = async () => {
    const name = document.getElementById('cb-new').value.trim();
    if (!name) return;
    const book = { id: cbNewId('book'), profileId: State.profile.id, name, createdAt: Date.now(), updatedAt: Date.now(), entries: [] };
    await putCustomBook(book);
    openBookEditor(book.id);
  };
  document.querySelectorAll('#cb-list [data-act]').forEach((b) => {
    b.onclick = async () => {
      const bk = books.find((x) => x.id === b.dataset.id);
      if (!bk) return;
      if (b.dataset.act === 'edit') return openBookEditor(bk.id);
      if (b.dataset.act === 'test') return openBookTestSetup(bk);
      if (b.dataset.act === 'del') {
        if (!confirm(`刪除單字本「${bk.name}」？（本內全部條目一起刪除，此動作無法復原）`)) return;
        await deleteCustomBook(bk.id);
        renderCustomBooks();
      }
    };
  });
}

// 單字本編輯器：新增／編輯／刪除條目、批次匯入
async function openBookEditor(bookId) {
  const book = await getCustomBook(bookId);
  if (!book) return renderCustomBooks();
  const rows = book.entries.map((en, i) => `
    <div class="row cb-entry" data-eid="${en.id}">
      <div class="row-main">
        <span class="row-word">${esc(en.prompt)}</span>
        <span class="row-zh">${esc(en.answer)}</span>
      </div>
      ${en.example ? `<div class="row-meta"><span>${esc(en.example)}</span></div>` : ''}
      <div class="btn-row">
        <button class="btn sm" data-eact="edit" data-eid="${en.id}">改</button>
        <button class="btn sm danger" data-eact="del" data-eid="${en.id}">刪</button>
      </div>
    </div>`).join('');

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="be-back">‹ 單字本</button><b>📓 ${esc(book.name)}</b></div>
      <p class="hint-area">每條：題面（中文／詞語／提示）＋ 答案（英文／注釋）＋ 可選例句。測驗時可選方向。</p>
      <div class="cb-form">
        <input id="be-prompt" class="answer-input" placeholder="題面（如：放棄 / give ___ ）" />
        <input id="be-answer" class="answer-input" placeholder="答案（如：give up；多個可用 / 分隔）" />
        <input id="be-example" class="answer-input" placeholder="例句（可留空）" />
        <button class="btn primary" id="be-save">＋ 加入這條</button>
      </div>
    </div>
    <div class="card">
      <details><summary>📥 批次匯入（貼「中文,英文」每行一組）</summary>
        <textarea id="be-bulk" class="answer-input" rows="4" placeholder="放棄,give up&#10;實現,come true&#10;（第三欄可放例句：中文,英文,例句）"></textarea>
        <button class="btn" id="be-import">匯入</button>
        <p id="be-imp-status" class="hint-area"></p>
      </details>
    </div>
    <div class="card">
      <div class="grp-head"><b>條目（${book.entries.length}）</b>
        <button class="btn primary" id="be-test" ${book.entries.length ? '' : 'disabled'}>▶️ 轉測驗</button></div>
      <div id="be-list">${book.entries.length ? rows : '<p class="hint-area">還沒有條目，用上方表單或批次匯入新增。</p>'}</div>
    </div>`;

  document.getElementById('be-back').onclick = () => renderCustomBooks();
  document.getElementById('be-test').onclick = () => openBookTestSetup(book);
  document.getElementById('be-save').onclick = async () => {
    const prompt = document.getElementById('be-prompt').value.trim();
    const answer = document.getElementById('be-answer').value.trim();
    const example = document.getElementById('be-example').value.trim();
    if (!prompt || !answer) { alert('題面與答案都要填'); return; }
    book.entries.push({ id: cbNewId('e'), prompt, answer, example });
    book.updatedAt = Date.now();
    await putCustomBook(book);
    openBookEditor(bookId);
  };
  document.getElementById('be-import').onclick = async () => {
    const raw = document.getElementById('be-bulk').value;
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const parts = line.split(/[,，\t]/).map((x) => x.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        book.entries.push({ id: cbNewId('e'), prompt: parts[0], answer: parts[1], example: parts[2] || '' });
        added++;
      }
    }
    if (added) { book.updatedAt = Date.now(); await putCustomBook(book); }
    document.getElementById('be-imp-status').textContent = `✅ 匯入 ${added} 條${lines.length - added ? `（${lines.length - added} 行格式不符已略過）` : ''}`;
    if (added) setTimeout(() => openBookEditor(bookId), 700);
  };
  document.querySelectorAll('#be-list [data-eact]').forEach((b) => {
    b.onclick = async () => {
      const en = book.entries.find((x) => x.id === b.dataset.eid);
      if (!en) return;
      if (b.dataset.eact === 'del') {
        book.entries = book.entries.filter((x) => x.id !== en.id);
        book.updatedAt = Date.now();
        await putCustomBook(book);
        return openBookEditor(bookId);
      }
      // 編輯：填回表單
      document.getElementById('be-prompt').value = en.prompt;
      document.getElementById('be-answer').value = en.answer;
      document.getElementById('be-example').value = en.example || '';
      book.entries = book.entries.filter((x) => x.id !== en.id);
      book.updatedAt = Date.now();
      await putCustomBook(book);
      openBookEditor(bookId);
      document.getElementById('be-prompt').value = en.prompt;
      document.getElementById('be-answer').value = en.answer;
      document.getElementById('be-example').value = en.example || '';
    };
  });
}

// ---- 單字本測驗（單次計分、可選方向、可選套 SM-2） ----
const CBRun = { active: false, book: null, dir: 'zh2en', useSrs: false, items: [], idx: 0, correct: 0, wrong: [], answered: false };

// 寬鬆比對：去頭尾空白、壓縮空白、去 ASCII 標點、忽略大小寫；答案可用 / , ; 分隔多個可接受寫法
function cbNorm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:'"()\-]/g, '');
}
function cbMatch(input, expected) {
  const norm = cbNorm(input);
  if (!norm) return false;
  return String(expected).split(/[\/,;；、]/).map(cbNorm).filter(Boolean).includes(norm);
}

function openBookTestSetup(book) {
  if (!book.entries.length) { alert('這個單字本還沒有條目'); return; }
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>▶️ ${esc(book.name)} 轉測驗</h3>
      <label class="ts-row">作答方向
        <select id="cb-dir" class="answer-input">
          <option value="zh2en">看題面 → 寫答案（中文→背英文）</option>
          <option value="en2zh">看答案 → 寫題面（英文→答注釋）</option>
        </select>
      </label>
      <label class="ts-row ts-check"><input type="checkbox" id="cb-srs" /> 套用間隔重複複習（僅「中文→英文」，會把這些字加入每日複習與我的單字）</label>
      <p class="hint-area">共 ${book.entries.length} 條，全部考一遍。答錯會列出正解。</p>
      <div class="btn-row">
        <button class="btn primary" id="cb-start">開始測驗</button>
        <button class="btn" id="cb-cancel">取消</button>
      </div>
    </div>`;
  m.classList.add('show');
  document.getElementById('cb-cancel').onclick = () => m.classList.remove('show');
  document.getElementById('cb-start').onclick = () => {
    const dir = document.getElementById('cb-dir').value;
    const useSrs = document.getElementById('cb-srs').checked && dir === 'zh2en';
    m.classList.remove('show');
    Object.assign(CBRun, {
      active: true, book, dir, useSrs,
      items: shuffle(book.entries.slice()), idx: 0, correct: 0, wrong: [], answered: false,
    });
    cbShow();
  };
}


function cbShow() {
  const t = CBRun;
  if (t.idx >= t.items.length) return cbDone();
  t.answered = false;
  const en = t.items[t.idx];
  const question = t.dir === 'zh2en' ? en.prompt : en.answer;
  $main().innerHTML = `
    <div class="quiz-progress"><span>📓 ${esc(t.book.name)}</span><span>第 ${t.idx + 1} / ${t.items.length} 題</span></div>
    <div class="card quiz-card">
      <div class="zh-prompt">${esc(question)}</div>
      <div class="pos">${t.dir === 'zh2en' ? '寫出答案' : '寫出題面'}</div>
      <input id="cb-ans" class="answer-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="輸入你的答案…" />
      <div class="btn-row"><button class="btn primary" id="cb-submit">送出</button></div>
      <button class="btn save-exit" id="cb-quit">✕ 結束測驗</button>
    </div>`;
  const input = document.getElementById('cb-ans');
  input.focus();
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') cbTestSubmit(); });
  document.getElementById('cb-submit').onclick = cbTestSubmit;
  document.getElementById('cb-quit').onclick = () => {
    if (!confirm('結束這次測驗？（已作答的仍計入統計，但不會計分存檔）')) return;
    CBRun.active = false; renderCustomBooks();
  };
}

async function cbTestSubmit() {
  const t = CBRun;
  if (t.answered) return;
  const input = document.getElementById('cb-ans');
  const val = input.value;
  if (!val.trim()) { input.focus(); return; }
  t.answered = true;
  const en = t.items[t.idx];
  const expected = t.dir === 'zh2en' ? en.answer : en.prompt;
  const question = t.dir === 'zh2en' ? en.prompt : en.answer;
  const correct = cbMatch(val, expected);

  if (t.useSrs) {
    // 中文→英文：註冊成自訂單字並走 SM-2（recordAnswer 內含每日紀錄）
    try {
      const { entry } = await createCustomWord(State.profile, en.answer, { zh: en.prompt });
      await recordAnswer(State.profile, entry, correct, false, false, Date.now(),
        { input: val, answer: en.answer, kind: 'spelling' });
      await refreshMastered();
    } catch (e) { await cbLogAnswer(correct); }
  } else {
    await cbLogAnswer(correct);
  }

  if (correct) t.correct++;
  else t.wrong.push({ word: question, zh: '', input: val, answer: expected, kind: 'book' });

  const banner = correct ? `<div class="result ok">✅ 答對了！</div>`
    : `<div class="result no">❌ 答錯，你寫「${esc(val) || '(空白)'}」，正解：<b>${esc(expected)}</b></div>`;
  const exLine = en.example ? `<div class="card"><div class="sent-line">${esc(en.example)}</div></div>` : '';
  $main().innerHTML = `${banner}${exLine}
    <div class="btn-row"><button class="btn primary" id="cb-next">${t.idx + 1 >= t.items.length ? '看成績 →' : '下一題 →'}</button></div>`;
  document.getElementById('cb-next').onclick = () => { t.idx++; cbShow(); };
}

// 把一次作答計入當天每日紀錄（不套 SM-2 時使用；套 SM-2 時由 recordAnswer 負責）
async function cbLogAnswer(correct) {
  const date = todayStr();
  let log = await getDailyLog(State.profile.id, date);
  if (!log) log = { key: dailyKey(State.profile.id, date), profileId: State.profile.id, date, newWords: [], reviewCount: 0, answerCount: 0, correctCount: 0, reviewWords: [], wrong: [] };
  log.answerCount = (log.answerCount || 0) + 1;
  if (correct) log.correctCount = (log.correctCount || 0) + 1;
  await putDailyLog(log);
}

async function cbDone() {
  const t = CBRun;
  t.active = false;
  const total = t.items.length;
  const result = await saveTestResult({
    profileId: State.profile.id, type: 'book', name: t.book.name,
    total, correct: t.correct, wrong: t.wrong,
  });
  const prev = await previousResult(State.profile.id, 'book', result.id, t.book.name);
  let cmp = '<p class="hint-area">這本單字本的第一次紀錄，加油！📓</p>';
  if (prev) {
    const d = result.scorePct - prev.scorePct;
    const arrow = d > 0 ? `📈 進步 ${d} 分` : d < 0 ? `📉 退步 ${-d} 分` : '➖ 與上次持平';
    cmp = `<p class="hint-area">上次（${prettyDate(prev.date)}）：${prev.scorePct} 分　→　這次 ${result.scorePct} 分　<b>${arrow}</b></p>`;
  }
  const wrongRows = result.wrong.length ? result.wrong.map((w) => testWrongRow(w)).join('') : '<p class="hint-area">全部答對，太強了！🎉</p>';
  $main().innerHTML = `
    <div class="card center">
      <h2>📓 ${esc(t.book.name)} 完成 🎉</h2>
      <p class="big">${result.scorePct} 分</p>
      <p>${result.correct} / ${total} 題答對</p>
      ${t.useSrs ? '<p class="hint-area">已套用間隔重複：這些字進了「我的單字」與每日複習。</p>' : ''}
      ${cmp}
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" id="cb-retest">再測一次</button>
        <button class="btn" id="cb-back2">回單字本</button>
      </div>
    </div>
    <div class="card"><h3>❌ 答錯的（${result.wrong.length}）</h3><div class="detail-list">${wrongRows}</div></div>`;
  document.getElementById('cb-retest').onclick = () => openBookTestSetup(t.book);
  document.getElementById('cb-back2').onclick = () => renderCustomBooks();
}

async function renderSettings() {
  const p = State.profile;
  const s = p.settings;
  const stats = await getStats(p.id);
  const profiles = await getAllProfiles();
  $main().innerHTML = `
    <div class="card">
      <h2>使用者管理</h2>
      <div id="user-list">
        ${profiles.map((u) => `
          <div class="row" data-uid="${u.id}">
            <div class="row-main">
              <span class="row-word">${esc(u.name)} ${u.id === p.id ? '（使用中）' : ''}</span>
            </div>
            <div class="btn-row">
              <button class="btn" data-act="switch" data-uid="${u.id}">切換</button>
              <button class="btn" data-act="rename" data-uid="${u.id}">改名</button>
              <button class="btn danger" data-act="delete" data-uid="${u.id}" ${profiles.length <= 1 ? 'disabled' : ''}>刪除</button>
            </div>
          </div>`).join('')}
      </div>
      <button class="btn primary" id="add-user">＋ 新增使用者</button>
      <p class="hint-area">每個使用者各自獨立的進度、設定、單字佇列與學習日曆。</p>
    </div>

    <div class="card">
      <h2>外觀</h2>
      <p class="hint-area">預設白底淺色。深色為手動開啟，不會自動跟隨系統。</p>
      <div class="btn-row">
        <button class="btn theme-opt" data-theme="light">☀️ 淺色（白底）</button>
        <button class="btn theme-opt" data-theme="dark">🌙 深色</button>
      </div>
    </div>

    <div class="card">
      <h2>目前使用者設定（${esc(p.name)}）</h2>
      <label>每日單字數（10–20）
        <input id="set-limit" class="answer-input" type="number" min="10" max="20" value="${s.dailyNewLimit}" />
      </label>
      <div>出題級別（新字來源）：</div>
      <div class="level-checks">
        ${[1, 2, 3, 4, 5, 6].map((l) =>
          `<label class="chk"><input type="checkbox" class="lv" value="${l}" ${s.levels.includes(l) ? 'checked' : ''}/> Lv${l}</label>`).join('')}
      </div>
      <div>每日單字來源：</div>
      <div class="src-opts">
        <label class="chk"><input type="radio" name="dsrc" value="auto" ${(s.dailySource || 'auto') === 'auto' ? 'checked' : ''}/> ① 系統自動排（預設）</label>
        <label class="chk"><input type="radio" name="dsrc" value="parent" ${s.dailySource === 'parent' ? 'checked' : ''}/> ② 家長排程（掃碼／家長出題為準）</label>
      </div>
      <p class="hint-area">選「家長排程」後，手機不再自動排每日新字，改以家長排定或掃入的為準，避免兩套打架。</p>
      <button class="btn primary" id="set-save">儲存設定</button>
      <p id="set-status" class="hint-area"></p>
    </div>

    <div class="card">
      <h2>學習統計</h2>
      <div class="stat-grid">
        <div><b>${stats.masteredCore}</b><span>🌳 已熟記</span></div>
        <div><b>${stats.proficient}</b><span>🌲 穩固</span></div>
        <div><b>${stats.weak}</b><span>🌿 學習中</span></div>
        <div><b>${stats.newCount}</b><span>🌱 未測驗</span></div>
        <div><b>${stats.tracked}</b><span>已納入學習</span></div>
        <div><b>🔥 ${stats.streak}</b><span>連續天數</span></div>
        <div><b>${stats.recentAccuracy}%</b><span>近7日答對率</span></div>
        <div><b>${stats.totalVocab}</b><span>全六級總字數</span></div>
      </div>
      <p class="hint-area">🌳 已熟記＝連續多天答對；🌲 穩固＝隔很多天仍答對。已熟記比例＝🌳＋🌲＝${stats.masteredPct}%。</p>
    </div>

    <div class="card">
      <h2>備份（換手機 / 保險）</h2>
      <div class="btn-row">
        <button class="btn" id="exp">匯出進度(JSON)</button>
        <label class="btn">匯入進度(JSON)<input id="imp" type="file" accept="application/json" hidden /></label>
      </div>
      <p class="hint-area">匯入會「覆蓋」目前身分的進度，請小心。</p>
    </div>

    <div class="card">
      <h2>每日練習提醒</h2>
      <label class="chk"><input type="checkbox" id="rm-on" ${s.reminderOn ? 'checked' : ''}/> 開啟每日提醒</label>
      <label>提醒時間
        <input type="time" id="rm-time" class="answer-input" value="${s.reminderTime || '19:30'}" />
      </label>
      <div class="btn-row">
        <button class="btn primary" id="rm-cal">📅 加入到手機行事曆（最穩定）</button>
      </div>
      <p class="hint-area">行事曆最可靠：匯入後每天到點一定跳，跨 iPhone／Android、不靠 App 開著。</p>
      <div class="btn-row">
        <button class="btn" id="rm-notify">🔔 開啟裝置通知</button>
        <button class="btn" id="rm-test">測試通知</button>
      </div>
      <p id="rm-status" class="hint-area"></p>
    </div>`;

  // 外觀（淺色／深色）— 全裝置共用，存 localStorage
  const curTheme = (() => { try { return localStorage.getItem('vocabTheme') === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; } })();
  document.querySelectorAll('.theme-opt').forEach((b) => {
    if (b.dataset.theme === curTheme) b.classList.add('primary');
    b.onclick = () => {
      const t = b.dataset.theme;
      try { localStorage.setItem('vocabTheme', t); } catch (e) { /* ignore */ }
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
      document.querySelectorAll('.theme-opt').forEach((x) => x.classList.toggle('primary', x.dataset.theme === t));
    };
  });

  // 每日提醒控制
  const rmStatus = document.getElementById('rm-status');
  const saveReminder = async () => {
    p.settings = { ...p.settings, reminderOn: document.getElementById('rm-on').checked, reminderTime: document.getElementById('rm-time').value || '19:30' };
    await putProfile(p);
    State.profile = p;
    await syncReminderMeta(p);
    scheduleForegroundReminder(p);
  };
  document.getElementById('rm-on').onchange = saveReminder;
  document.getElementById('rm-time').onchange = saveReminder;
  document.getElementById('rm-cal').onclick = async () => {
    await saveReminder();
    downloadICS(p);
    rmStatus.textContent = '✅ 已下載 .ics，請點開檔案匯入手機行事曆（每天會重複提醒）。';
  };
  document.getElementById('rm-notify').onclick = async () => {
    if (!notifySupported()) { rmStatus.textContent = '⚠️ 此瀏覽器不支援通知，請用「加入行事曆」。'; return; }
    const perm = await requestNotifyPermission();
    if (perm === 'granted') {
      await saveReminder();
      const periodic = await registerPeriodicReminder();
      scheduleForegroundReminder(p);
      rmStatus.textContent = '✅ 已開啟裝置通知' + (periodic ? '（含背景提醒）' : '（App 開著時最準；背景提醒不一定支援，建議也加行事曆）');
    } else {
      rmStatus.textContent = '⚠️ 通知權限未開啟，請改用「加入行事曆」最穩定。';
    }
  };
  document.getElementById('rm-test').onclick = async () => {
    if (notifyPermission() !== 'granted') { rmStatus.textContent = '請先按「開啟裝置通知」。'; return; }
    const ok = await showReminderNow('📚 測試通知', '這就是每天會看到的提醒，點我開到測驗。');
    rmStatus.textContent = ok ? '✅ 已送出測試通知' : '⚠️ 無法顯示通知';
  };

  document.getElementById('set-save').onclick = async () => {
    let limit = parseInt(document.getElementById('set-limit').value, 10) || s.dailyNewLimit;
    limit = Math.max(10, Math.min(20, limit)); // 限制 10–20
    const levels = [...document.querySelectorAll('.lv:checked')].map((c) => parseInt(c.value, 10));
    const dailySource = (document.querySelector('input[name="dsrc"]:checked') || {}).value || 'auto';
    p.settings = { ...s, dailyNewLimit: limit, levels: levels.length ? levels : [4, 5, 6], dailySource };
    await putProfile(p);
    State.profile = p;
    State.session = null;
    renderHeader();
    document.getElementById('set-status').textContent = '✅ 已儲存';
  };

  // ---- 使用者管理：切換 / 改名 / 刪除 / 新增 ----
  document.querySelectorAll('#user-list [data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.dataset.uid;
      const act = btn.dataset.act;
      const target = profiles.find((u) => u.id === uid);
      if (!target) return;

      if (act === 'switch') {
        State.profile = await getProfile(uid);
        await setMeta('activeProfile', uid);
        State.session = null;
        renderHeader();
        renderSettings();
      } else if (act === 'rename') {
        const name = prompt('輸入新的使用者名稱：', target.name);
        if (name && name.trim()) {
          target.name = name.trim();
          await putProfile(target);
          if (uid === State.profile.id) State.profile = target;
          renderHeader();
          renderSettings();
        }
      } else if (act === 'delete') {
        if (profiles.length <= 1) { alert('至少要保留一個使用者'); return; }
        if (!confirm(`確定要刪除使用者「${target.name}」？\n他的所有單字進度、統計與學習日曆都會永久消失。`)) return;
        if (!confirm(`再次確認：真的要刪除「${target.name}」嗎？此動作無法復原。`)) return;
        await deleteProfileFully(uid);
        // 若刪到使用中身分，切到其餘第一個
        if (uid === State.profile.id) {
          const rest = (await getAllProfiles())[0];
          State.profile = rest;
          await setMeta('activeProfile', rest.id);
          State.session = null;
        }
        renderHeader();
        renderSettings();
      }
    };
  });

  document.getElementById('add-user').onclick = async () => {
    const name = prompt('輸入新使用者的名稱：', '');
    if (!name || !name.trim()) return;
    const newProfile = {
      id: 'user-' + Date.now(),
      name: name.trim(),
      settings: { dailyNewLimit: 15, levels: [4, 5, 6], priorityLevels: [4, 5, 6], reminderTime: '19:30', reminderOn: false },
    };
    await putProfile(newProfile);
    State.profile = newProfile;
    await setMeta('activeProfile', newProfile.id);
    State.session = null;
    renderHeader();
    renderSettings();
  };

  document.getElementById('exp').onclick = async () => {
    const data = await exportProfile(p.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vocab-${p.id}-${todayStr()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('imp').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const n = await importProfile(data, p.id);
      State.profile = await getProfile(p.id);
      State.session = null;
      renderHeader();
      alert(`✅ 已匯入 ${n} 筆紀錄`);
      renderSettings();
    } catch (err) {
      alert('⚠️ 匯入失敗：' + err.message);
    }
  };
}

// ---------- Service Worker（含自動更新到新版） ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let firstInstall = !hadController;
  let refreshing = false;

  navigator.serviceWorker.register('./service-worker.js')
    .then((reg) => {
      reg.update();
      // iOS/Android PWA 常從記憶體恢復而不重新載入頁面 → 回到前景時主動檢查更新
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      // 若新版 SW 已下載完在等待（舊版卡住的情況），直接請它接管 → 觸發 controllerchange 重整
      if (reg.waiting) reg.waiting.postMessage('skipWaiting');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage('skipWaiting');
        });
      });
    })
    .catch((e) => console.warn('SW 註冊失敗', e));

  // 當新版 SW 接管時自動重整一次（首次安裝不重整，避免無謂刷新）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (firstInstall) { firstInstall = false; return; }
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}

window.addEventListener('DOMContentLoaded', init);

export { go, lookupTermNavigate, openDay, openWordDetail, wordDayDone };
