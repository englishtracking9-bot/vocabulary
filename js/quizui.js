// quizui.js — 測驗頁：複習回合＋週測/月測/自訂測驗引擎（自 app.js 原樣搬出，G1 拆分）

import { go } from './app.js';
import { Daily, dispatchDaily, openDay, renderDayList, sensesWithExample } from './daily.js';
import { getDueRecords } from './db.js';
import { fetchDict, speak } from './lookup.js';
import { openWordDetail } from './mywords.js';
import { Session, buildQueue, recordAnswer } from './quiz.js';
import { compareSentence } from './sentence.js';
import { $main, APP_UI_VERSION, State, refreshMastered } from './state.js';
import { getStats } from './stats.js';
import { getTags, wordsInTag } from './tags.js';
import { TEST_TYPE_LABEL, allMyWordIds, allResults, groupWordIds, levelWordIds, previousResult, recentWordIds, sample, saveTestResult } from './tests.js';
import { esc, prettyDate, todayStr } from './util.js';
import { checkAnswer, getById } from './vocab.js';
import { attachCardHandlers, cardHTML } from './wordcard.js';


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
export { renderQuiz, renderTestHub, startReview, renderReviewEmpty, renderQuizDone, TestRun, openTestSetup, STAGE_SIZE, startTest, gauntletStars, testShow, testSubmit, testStageBreak, testQuit, testDone, testWrongRow, showTestResultDetail, openTestHistory, showQuestion, doSubmit, showAnswerCard, kindLabel, startGroupTest, openTestTypePicker, startWordsTest };
