// app.js — 啟動、路由、首頁＝測驗、身分切換
import {
  openDB, getAllProfiles, putProfile, getProfile, setMeta, getMeta,
  getRecordsByProfile, getRecord, putRecord, deleteRecord, deleteProfileFully,
} from './db.js';
import {
  loadVocab, getById, allWords, registerCustomWord, checkAnswer,
} from './vocab.js';
import { buildQueue, Session, recordAnswer } from './quiz.js';
import { lookupWord, fetchDict, speak, addToReview } from './lookup.js';
import { buildDailyReport, buildNewWordsOnly, buildWeeklyReport, copyToClipboard } from './report.js';
import { getStats, exportProfile, importProfile } from './stats.js';
import { displayCategory, statusBadge, computeStatus } from './srs.js';
import { esc, todayStr, prettyDate } from './util.js';

// ---------- 預設身分 ----------
const DEFAULT_PROFILES = [
  { id: 'senior1', name: '升高一', settings: { dailyNewLimit: 20, levels: [4, 5, 6], priorityLevels: [4, 5, 6], reminderTime: '19:30', reminderOn: false } },
  { id: 'junior3', name: '升國三-Sonya', settings: { dailyNewLimit: 15, levels: [3, 4, 5], priorityLevels: [4, 5], reminderTime: '19:30', reminderOn: false } },
];

// ---------- 全域狀態 ----------
const State = {
  profile: null,
  session: null,
  current: null,      // 當前題目 item {wordId, level, kind}
  entry: null,        // 當前單字 entry
  usedHint: false,
  answered: false,
};

const $main = () => document.getElementById('main');

// ---------- 啟動 ----------
async function init() {
  try {
    await openDB();
    await loadVocab();
    await loadCustomWords();
    await ensureProfiles();

    const activeId = (await getMeta('activeProfile')) || DEFAULT_PROFILES[0].id;
    State.profile = (await getProfile(activeId)) || (await getProfile(DEFAULT_PROFILES[0].id));

    renderHeader();
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#quiz';
    route();

    registerServiceWorker();
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
        renderHeader();
        route();
      });
    });
  });
}

// ---------- 路由 ----------
const ROUTES = {
  '#quiz': renderQuiz,
  '#lookup': renderLookup,
  '#mywords': renderMyWords,
  '#roots': renderRoots,
  '#report': renderReport,
  '#settings': renderSettings,
};

function route() {
  const hash = location.hash || '#quiz';
  const fn = ROUTES[hash] || renderQuiz;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.route === hash);
  });
  fn();
}

// ============================================================
// 測驗（首頁）
// ============================================================
async function renderQuiz() {
  if (!State.session || State.session.remaining === 0) {
    const items = await buildQueue(State.profile);
    State.session = new Session(items);
  }
  if (State.session.remaining === 0) {
    return renderQuizDone();
  }
  showQuestion();
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
      <a class="btn" href="#report">看每日報告</a>
    </div>`;
  document.getElementById('again').onclick = async () => {
    const items = await buildQueue(State.profile);
    State.session = new Session(items);
    if (State.session.remaining === 0) {
      $main().innerHTML = `<div class="card center"><h2>目前沒有到期複習或新字了 👍</h2>
        <p>可到「查單字」加入想學的字，或到設定調整每日新字數／級別。</p></div>`;
    } else showQuestion();
  };
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

  await recordAnswer(State.profile, entry, correct, State.usedHint, secondTry);

  if (correct) State.session.advance();
  else State.session.requeueCurrent();

  const dict = await fetchDict(entry.word.replace(/\(.*?\)/g, '').trim());
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

// ============================================================
// 單字卡（共用）
// ============================================================
function cardHTML(entry, dict) {
  const phon = (dict && dict.phonetic) ? `<span class="phon">${esc(dict.phonetic)}</span>` : '';
  const examples = (dict && dict.examples && dict.examples.length)
    ? `<div class="examples"><b>例句</b><ul>${dict.examples.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
    : (entry.example ? `<div class="examples"><b>例句</b><p>${esc(entry.example)}</p></div>` : '');
  const note = entry.note ? `<div class="note">補充（相關詞）：${esc(entry.note)}</div>` : '';
  const root = entry.root
    ? `<div class="root"><b>字根拆解</b>：${esc(typeof entry.root === 'string' ? entry.root : JSON.stringify(entry.root))}</div>`
    : '';
  return `
    <div class="card word-card">
      <div class="word-head">
        <span class="word-en">${esc(entry.word)}</span>
        <button class="btn icon" data-say="${esc(entry.answerKeys[0])}">🔊</button>
      </div>
      ${phon}
      <div class="pos">${esc(entry.pos)}・Level ${entry.level}</div>
      <div class="zh">${esc(entry.zh) || '（無中文）'}</div>
      ${note}
      ${examples}
      ${root}
    </div>`;
}

function attachCardHandlers(entry) {
  document.querySelectorAll('[data-say]').forEach((b) => {
    b.onclick = () => speak(b.dataset.say);
  });
}

// ============================================================
// 查單字（自動記錄）
// ============================================================
function renderLookup() {
  $main().innerHTML = `
    <div class="card">
      <h2>查單字</h2>
      <div class="btn-row">
        <input id="lk-input" class="answer-input" type="text" placeholder="輸入英文單字…"
          autocapitalize="off" autocorrect="off" spellcheck="false" />
        <button class="btn primary" id="lk-go">查詢</button>
      </div>
      <p class="hint-area">查詢成功會自動加入「我的單字」待學清單（免按鈕）。</p>
    </div>
    <div id="lk-result"></div>`;
  const input = document.getElementById('lk-input');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLookup(); });
  document.getElementById('lk-go').onclick = doLookup;
}

async function doLookup() {
  const input = document.getElementById('lk-input');
  const term = input.value.trim();
  if (!term) return;
  const out = document.getElementById('lk-result');
  out.innerHTML = `<div class="card center">查詢中…</div>`;

  try {
    const { entry, dict, recordStatus, autoAdded } = await lookupWord(State.profile, term);
    if (!entry) {
      return renderLookupNotFound(term, dict);
    }
    let banner = '';
    if (autoAdded) banner = `<div class="result ok">✅ 已自動加入待學清單</div>`;
    else if (displayCategory(recordStatus) === 'mastered')
      banner = `<div class="result ok">你已學會這個字 ✅（不重複加入）</div>`;
    else banner = `<div class="result info">已在你的清單中（${statusBadge(recordStatus)}）</div>`;

    out.innerHTML = `${banner}${cardHTML(entry, dict)}
      <div class="btn-row">
        <button class="btn" id="quiz-this">立即測這個字</button>
        ${displayCategory(recordStatus) === 'mastered'
          ? `<button class="btn" id="readd">再次加入複習</button>`
          : `<button class="btn danger" id="remove">我其實已會 → 移除</button>`}
      </div>`;
    attachCardHandlers(entry);
    const qt = document.getElementById('quiz-this');
    if (qt) qt.onclick = () => quizSingle(entry);
    const rm = document.getElementById('remove');
    if (rm) rm.onclick = async () => { await deleteRecord(State.profile.id, entry.id); doLookup(); };
    const ra = document.getElementById('readd');
    if (ra) ra.onclick = async () => { await addToReview(State.profile, entry); doLookup(); };
  } catch (e) {
    out.innerHTML = `<div class="card"><p>⚠️ 查詢發生問題：${esc(e.message)}</p></div>`;
  }
}

function renderLookupNotFound(term, dict) {
  const out = document.getElementById('lk-result');
  const dictBox = dict ? cardHTMLFromDict(term, dict) : '';
  out.innerHTML = `
    <div class="card">
      <p>本機 6000 字表查無「${esc(term)}」。</p>
      ${dict ? '<p>以下為線上字典資料：</p>' : '<p>（離線或字典也查無）</p>'}
      ${dictBox}
      <h3>手動加入</h3>
      <div class="btn-row">
        <input id="m-zh" class="answer-input" placeholder="輸入中文意思" />
        <button class="btn primary" id="m-add">加入待學</button>
      </div>
    </div>`;
  document.getElementById('m-add').onclick = async () => {
    const zh = document.getElementById('m-zh').value.trim();
    const id = 'custom-' + term.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const entry = {
      id, word: term.toLowerCase(), pos: '', zh, level: 0,
      answerKeys: [term.toLowerCase()], example: '', root: null, custom: true,
    };
    registerCustomWord(entry);
    const custom = (await getMeta('customWords')) || [];
    if (!custom.find((c) => c.id === id)) { custom.push(entry); await setMeta('customWords', custom); }
    await addToReview(State.profile, entry);
    doLookupTerm(term);
  };
}

function cardHTMLFromDict(word, dict) {
  return `<div class="card word-card">
    <div class="word-head"><span class="word-en">${esc(word)}</span>
      <button class="btn icon" data-say="${esc(word)}">🔊</button></div>
    ${dict.phonetic ? `<span class="phon">${esc(dict.phonetic)}</span>` : ''}
    ${dict.examples && dict.examples.length ? `<ul>${dict.examples.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function doLookupTerm(term) {
  document.getElementById('lk-input').value = term;
  doLookup();
}

// 單字即時測驗（從清單或查單字觸發）
function quizSingle(entry) {
  State.session = new Session([{ wordId: entry.id, level: entry.level, kind: 'review' }]);
  location.hash = '#quiz';
  if (location.hash === '#quiz') route(); else showQuestion();
}

// ============================================================
// 我的單字（總表）
// ============================================================
const MyWordsFilter = { status: 'all', level: 'all', q: '', sort: 'recent' };

async function renderMyWords() {
  const recs = await getRecordsByProfile(State.profile.id);
  $main().innerHTML = `
    <div class="card">
      <h2>我的單字（${recs.length}）</h2>
      <div class="filters">
        <select id="f-status">
          <option value="all">全部狀態</option>
          <option value="new">🆕 未測驗</option>
          <option value="weak">📖 需加強</option>
          <option value="mastered">✅ 已熟記</option>
        </select>
        <select id="f-level">
          <option value="all">全部級別</option>
          ${[1, 2, 3, 4, 5, 6].map((l) => `<option value="${l}">Level ${l}</option>`).join('')}
        </select>
        <select id="f-sort">
          <option value="recent">最近新增</option>
          <option value="errors">最常錯</option>
          <option value="due">即將到期</option>
        </select>
      </div>
      <input id="f-q" class="answer-input" placeholder="關鍵字搜尋（英文或中文）" />
    </div>
    <div id="mw-list"></div>`;

  const sEl = document.getElementById('f-status');
  const lEl = document.getElementById('f-level');
  const sortEl = document.getElementById('f-sort');
  const qEl = document.getElementById('f-q');
  sEl.value = MyWordsFilter.status; lEl.value = MyWordsFilter.level;
  sortEl.value = MyWordsFilter.sort; qEl.value = MyWordsFilter.q;

  const update = () => {
    MyWordsFilter.status = sEl.value;
    MyWordsFilter.level = lEl.value;
    MyWordsFilter.sort = sortEl.value;
    MyWordsFilter.q = qEl.value.trim().toLowerCase();
    drawMyWords(recs);
  };
  [sEl, lEl, sortEl].forEach((e) => e.onchange = update);
  qEl.oninput = update;
  drawMyWords(recs);
}

function drawMyWords(recs) {
  let rows = recs.map((r) => ({ rec: r, entry: getById(r.wordId) })).filter((x) => x.entry);

  if (MyWordsFilter.status !== 'all')
    rows = rows.filter((x) => displayCategory(x.rec.status) === MyWordsFilter.status);
  if (MyWordsFilter.level !== 'all')
    rows = rows.filter((x) => String(x.entry.level) === MyWordsFilter.level);
  if (MyWordsFilter.q) {
    const q = MyWordsFilter.q;
    rows = rows.filter((x) => x.entry.word.toLowerCase().includes(q) || (x.entry.zh || '').includes(q));
  }

  if (MyWordsFilter.sort === 'recent') rows.sort((a, b) => b.rec.addedAt - a.rec.addedAt);
  else if (MyWordsFilter.sort === 'errors')
    rows.sort((a, b) => (b.rec.attempts - b.rec.correct) - (a.rec.attempts - a.rec.correct));
  else if (MyWordsFilter.sort === 'due') rows.sort((a, b) => a.rec.due - b.rec.due);

  const list = document.getElementById('mw-list');
  if (!rows.length) { list.innerHTML = `<div class="card center">沒有符合的單字</div>`; return; }

  list.innerHTML = rows.slice(0, 300).map((x) => {
    const r = x.rec, e = x.entry;
    const acc = r.attempts ? Math.round((r.correct / r.attempts) * 100) : 0;
    const dueStr = r.attempts ? prettyDate(todayStr(new Date(r.due))) : '—';
    return `<div class="row" data-id="${e.id}">
      <div class="row-main">
        <span class="row-word">${esc(e.word)}</span>
        <span class="row-zh">${esc(e.zh)}</span>
      </div>
      <div class="row-meta">
        <span>Lv${e.level}</span>
        <span>${statusBadge(r.status)}</span>
        <span>到期 ${dueStr}</span>
        <span>答對率 ${acc}%</span>
      </div>
    </div>`;
  }).join('') + (rows.length > 300 ? `<div class="card center">（僅顯示前 300 筆，請用篩選縮小範圍）</div>` : '');

  list.querySelectorAll('.row').forEach((row) => {
    row.onclick = () => openWordDetail(row.dataset.id);
  });
}

async function openWordDetail(wordId) {
  const entry = getById(wordId);
  const dict = await fetchDict(entry.word.replace(/\(.*?\)/g, '').trim());
  const rec = await getRecord(State.profile.id, wordId);
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      ${cardHTML(entry, dict)}
      <div class="row-meta">狀態：${rec ? statusBadge(rec.status) : '未加入'}　答對率：${rec && rec.attempts ? Math.round(rec.correct / rec.attempts * 100) : 0}%</div>
      <div class="btn-row">
        <button class="btn primary" id="md-quiz">立即測這個字</button>
        <button class="btn" id="md-weak">標記需重練</button>
        <button class="btn" id="md-known">標記我已會</button>
      </div>
      <button class="btn" id="md-close">關閉</button>
    </div>`;
  m.classList.add('show');
  attachCardHandlers(entry);
  document.getElementById('md-close').onclick = () => m.classList.remove('show');
  document.getElementById('md-quiz').onclick = () => { m.classList.remove('show'); quizSingle(entry); };
  document.getElementById('md-weak').onclick = async () => {
    await addToReview(State.profile, entry); m.classList.remove('show'); renderMyWords();
  };
  document.getElementById('md-known').onclick = async () => {
    await markKnown(entry); m.classList.remove('show'); renderMyWords();
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
  rec.due = now + 7 * 24 * 60 * 60 * 1000;
  rec.lastResult = 'correct';
  rec.attempts = Math.max(rec.attempts || 0, 1);
  rec.correct = Math.max(rec.correct || 0, 1);
  rec.streak = Math.max(rec.streak || 0, 1);
  rec.updatedAt = now;
  await putRecord(rec);
}

// ============================================================
// 字根（Phase 2 佔位）
// ============================================================
function renderRoots() {
  $main().innerHTML = `
    <div class="card center">
      <h2>字根字首記憶法</h2>
      <p>📦 此功能將於 <b>Phase 2</b> 推出：</p>
      <ul style="text-align:left">
        <li>字首／字根／字尾瀏覽（80–120 個高頻者）</li>
        <li>單字卡顯示「字根拆解」與同字根衍生字</li>
        <li>一鍵把整組同字根的字加入練習</li>
      </ul>
      <p>Phase 1 先把核心測驗與每日報告做穩。</p>
    </div>`;
}

// ============================================================
// 每日報告
// ============================================================
async function renderReport() {
  $main().innerHTML = `<div class="card center">產生報告中…</div>`;
  const text = await buildDailyReport(State.profile);
  $main().innerHTML = `
    <div class="card">
      <h2>每日報告</h2>
      <pre id="report-text" class="report-text">${esc(text)}</pre>
      <button class="btn primary big-copy" id="copy-main">📋 複製報告</button>
      <div class="btn-row">
        <button class="btn" id="copy-new">只複製今日新字</button>
        <button class="btn" id="copy-week">複製本週彙整</button>
      </div>
      <p id="copy-status" class="hint-area"></p>
    </div>`;
  const status = document.getElementById('copy-status');
  const doCopy = async (getter) => {
    const t = await getter();
    document.getElementById('report-text').textContent = t;
    const ok = await copyToClipboard(t);
    status.textContent = ok ? '✅ 已複製，貼到 LINE 傳給家長吧！' : '⚠️ 複製失敗，請長按上方文字手動複製';
  };
  document.getElementById('copy-main').onclick = () => doCopy(() => buildDailyReport(State.profile));
  document.getElementById('copy-new').onclick = () => doCopy(() => buildNewWordsOnly(State.profile));
  document.getElementById('copy-week').onclick = () => doCopy(() => buildWeeklyReport(State.profile));
}

// ============================================================
// 設定
// ============================================================
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
      <h2>目前使用者設定（${esc(p.name)}）</h2>
      <label>每日單字數（10–20）
        <input id="set-limit" class="answer-input" type="number" min="10" max="20" value="${s.dailyNewLimit}" />
      </label>
      <div>出題級別（新字來源）：</div>
      <div class="level-checks">
        ${[1, 2, 3, 4, 5, 6].map((l) =>
          `<label class="chk"><input type="checkbox" class="lv" value="${l}" ${s.levels.includes(l) ? 'checked' : ''}/> Lv${l}</label>`).join('')}
      </div>
      <button class="btn primary" id="set-save">儲存設定</button>
      <p id="set-status" class="hint-area"></p>
    </div>

    <div class="card">
      <h2>學習統計</h2>
      <div class="stat-grid">
        <div><b>${stats.mastered}</b><span>✅ 已熟記</span></div>
        <div><b>${stats.weak}</b><span>📖 需加強</span></div>
        <div><b>${stats.newCount}</b><span>🆕 未測驗</span></div>
        <div><b>${stats.tracked}</b><span>已納入學習</span></div>
        <div><b>${stats.todayNew}</b><span>今日新學</span></div>
        <div><b>🔥 ${stats.streak}</b><span>連續天數</span></div>
        <div><b>${stats.recentAccuracy}%</b><span>近7日答對率</span></div>
        <div><b>${stats.totalVocab}</b><span>全六級總字數</span></div>
      </div>
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
      <h2>每日提醒</h2>
      <p class="hint-area">裝置通知與「加入行事曆(.ics)」備援將於 <b>Phase 2</b> 提供。</p>
    </div>`;

  document.getElementById('set-save').onclick = async () => {
    let limit = parseInt(document.getElementById('set-limit').value, 10) || s.dailyNewLimit;
    limit = Math.max(10, Math.min(20, limit)); // 限制 10–20
    const levels = [...document.querySelectorAll('.lv:checked')].map((c) => parseInt(c.value, 10));
    p.settings = { ...s, dailyNewLimit: limit, levels: levels.length ? levels : [4, 5, 6] };
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
    .then((reg) => { reg.update(); })
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
