// app.js — 啟動、路由、首頁＝測驗、身分切換
import {
  openDB, getAllProfiles, putProfile, getProfile, setMeta, getMeta,
  getRecordsByProfile, getRecord, putRecord, deleteRecord, deleteProfileFully,
  getDayPlan, putDayPlan, getDaysByProfile, dayKey,
} from './db.js';
import {
  loadVocab, getById, allWords, registerCustomWord, checkAnswer,
} from './vocab.js';
import { buildQueue, Session, recordAnswer } from './quiz.js';
import { lookupWord, fetchDict, speak, addToReview } from './lookup.js';
import { buildDailyReport, buildNewWordsOnly, buildWeeklyReport, copyToClipboard } from './report.js';
import { getStats, exportProfile, importProfile } from './stats.js';
import { displayCategory, statusBadge, computeStatus } from './srs.js';
import { loadGroupsIndex, formDailyGroup, familyOf } from './grouping.js';
import { compareSentence } from './sentence.js';
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
    await loadGroupsIndex();
    await loadCustomWords();
    await ensureProfiles();

    const activeId = (await getMeta('activeProfile')) || DEFAULT_PROFILES[0].id;
    State.profile = (await getProfile(activeId)) || (await getProfile(DEFAULT_PROFILES[0].id));

    renderHeader();
    window.addEventListener('hashchange', route);
    // 導覽列：即使 hash 沒變也要重繪（例如在日曆子頁點「日曆」要回到月曆）
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.addEventListener('click', () => go(b.dataset.route));
    });
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
  '#calendar': renderCalendar,
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

// 導覽：設定 hash 並強制重繪（即使 hash 未變）
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
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
  let examples = '';
  if (entry.example && entry.example.trim()) {
    // 優先用已存的標準例句（含中文翻譯，離線可用）
    examples = `<div class="examples"><b>例句</b>
      <div class="ex-en">${esc(entry.example)} <button class="btn icon" data-say="${esc(entry.example)}">🔊</button></div>
      ${entry.example_zh ? `<div class="ex-zh">${esc(entry.example_zh)}</div>` : ''}</div>`;
  } else if (dict && dict.examples && dict.examples.length) {
    examples = `<div class="examples"><b>例句</b><ul>${dict.examples.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }
  const note = entry.note ? `<div class="note">補充（相關詞）：${esc(entry.note)}</div>` : '';
  let root = '';
  if (Array.isArray(entry.root) && entry.root.length) {
    const seg = entry.root.map((p) => `<b>${esc(p.part)}</b>(${esc(p.mean)})`).join(' + ');
    root = `<div class="root">🔧 字根拆解：${seg}</div>`;
  } else if (typeof entry.root === 'string' && entry.root) {
    root = `<div class="root">🔧 字根拆解：${esc(entry.root)}</div>`;
  }
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
// 學習日曆
// ============================================================
const Cal = { year: null, month: null }; // month: 0-11

async function renderCalendar() {
  const now = new Date();
  if (Cal.year == null) { Cal.year = now.getFullYear(); Cal.month = now.getMonth(); }

  const days = await getDaysByProfile(State.profile.id);
  const planMap = new Map(days.map((d) => [d.date, d]));

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
    // 過去且無紀錄 → 不可點（不補排）
    if (isPast && !hasPlan) {
      cells += `<div class="cal-cell noplan"><span class="cal-d">${d}</span></div>`;
    } else {
      cells += `
      <button class="cal-cell ${st.cls} ${isToday ? 'today' : ''}" data-date="${ds}">
        <span class="cal-d">${d}</span>
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
      </div>
    </div>
    <div class="card center">
      <button class="btn primary" id="cal-today">📚 開始今天的單字組</button>
      <p class="hint-area">點任一天，進入「當日學習」：先讀一組字 → 拼字測驗 ＋ 造句測驗。</p>
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
const Daily = { date: null, plan: null, spellSession: null, sentQueue: null, sentIdx: 0, answered: false, usedHint: false };

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
  let plan = await getDayPlan(State.profile.id, dateStr);
  if (!plan) {
    // 過去且無紀錄 → 不補排、不即時生成
    if (dateStr < todayStr()) {
      $main().innerHTML = `<div class="card center">
        <h2>${prettyDate(dateStr)}</h2>
        <p>這天沒有學習紀錄。</p>
        <button class="btn" id="back-cal">回日曆</button></div>`;
      document.getElementById('back-cal').onclick = () => renderCalendar();
      return;
    }
    // 今天 / 未來 → 生成並鎖定
    plan = await ensureDayPlan(dateStr);
  }
  Daily.date = dateStr; Daily.plan = plan;
  Daily.spellSession = null; Daily.sentQueue = null; Daily.sentIdx = 0;
  dispatchDaily();
}

function dispatchDaily() {
  const plan = Daily.plan;
  if (!plan.group.wordIds.length) {
    $main().innerHTML = `<div class="card center"><h2>今天沒有可學的新字 👍</h2>
      <p>可能你的範圍內的字都已熟記。到「設定」調整級別，或到「查單字」加字。</p>
      <button class="btn" id="back-cal">回日曆</button></div>`;
    document.getElementById('back-cal').onclick = () => renderCalendar();
    return;
  }
  if (!plan.readDone) return renderReadList();

  const needSpelling = plan.group.wordIds.filter((id) => (plan.progress[id] || {}).spelling !== 'correct');
  if (needSpelling.length) return startSpelling(needSpelling);

  const needSentence = plan.group.wordIds.filter((id) => {
    const e = getById(id);
    const p = plan.progress[id] || {};
    return e && e.example && e.example.trim() && !p.sentence;
  });
  if (needSentence.length) return startSentence(needSentence);

  return renderDayDone();
}

// ---- 第一段：先讀 ----
function renderReadList() {
  const plan = Daily.plan;
  const cards = plan.group.wordIds.map((id) => {
    const e = getById(id);
    if (!e) return '';
    return `
      <div class="read-card">
        <div class="word-head">
          <span class="word-en">${esc(e.word)}</span>
          <button class="btn icon" data-say="${esc(e.answerKeys[0])}">🔊</button>
          <button class="btn icon remove-word" data-rm="${e.id}" title="從今天移除">✕</button>
        </div>
        <div class="pos">${esc(e.pos)}・Lv${e.level}</div>
        <div class="zh">${esc(e.zh)}</div>
        ${e.root ? `<div class="root">🔧 ${e.root.map((p) => `${esc(p.part)}(${esc(p.mean)})`).join(' + ')}</div>` : ''}
        ${e.example ? `<div class="examples">
          <div class="ex-en">${esc(e.example)} <button class="btn icon" data-say="${esc(e.example)}">🔊</button></div>
          <div class="ex-zh">${esc(e.example_zh || '')}</div>
        </div>` : ''}
      </div>`;
  }).join('');

  $main().innerHTML = `
    <div class="card memo-card">
      <div class="daily-top">
        <button class="btn" id="back-cal">‹ 日曆</button>
        <b>${prettyDate(Daily.date)}・先讀（${plan.group.wordIds.length} 字）</b>
      </div>
      <div class="memo">💡 本組共同記憶點：${esc(plan.group.memo)}</div>
      <div class="btn-row">
        <button class="btn" id="regroup">🔄 換一組</button>
      </div>
    </div>
    ${cards}
    <div class="card center">
      <button class="btn primary big-copy" id="read-done">✅ 讀完了，開始測驗 →</button>
    </div>`;

  document.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say); });
  document.getElementById('back-cal').onclick = () => renderCalendar();

  // 移除某字
  document.querySelectorAll('.remove-word').forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      const id = b.dataset.rm;
      Daily.plan.group.wordIds = Daily.plan.group.wordIds.filter((w) => w !== id);
      delete Daily.plan.progress[id];
      Daily.plan.updatedAt = Date.now();
      await putDayPlan(Daily.plan);
      renderReadList();
    };
  });

  // 換一組（排除目前分組，重新湊一組）
  document.getElementById('regroup').onclick = async () => {
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
    await putDayPlan(Daily.plan);
    renderReadList();
  };
  document.getElementById('read-done').onclick = async () => {
    Daily.plan.readDone = true;
    Daily.plan.updatedAt = Date.now();
    await putDayPlan(Daily.plan);
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
  await recordAnswer(State.profile, e, correct, Daily.usedHint, secondTry);

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
  await putDayPlan(Daily.plan);

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
function startSentence(wordIds) {
  Daily.sentQueue = wordIds.slice();
  Daily.sentIdx = 0;
  dailySentenceShow();
}

function dailySentenceShow() {
  if (Daily.sentIdx >= Daily.sentQueue.length) return dispatchDaily();
  Daily.answered = false;
  const e = getById(Daily.sentQueue[Daily.sentIdx]);
  $main().innerHTML = `
    <div class="quiz-progress">
      <span>📝 造句測驗（默寫）</span><span>${Daily.sentIdx + 1} / ${Daily.sentQueue.length}</span>
    </div>
    <div class="card quiz-card">
      <p class="hint-area">看著中文翻譯，把這個單字的英文例句完整默寫出來（含 <b>${esc(e.word)}</b>）：</p>
      <div class="zh-prompt sent-zh">${esc(e.example_zh || '')}</div>
      <div class="pos">關鍵字：${esc(e.word)}（${esc(e.zh)}）
        <button class="btn icon" data-say="${esc(e.example)}">🔊 聽例句</button>
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
  const e = getById(Daily.sentQueue[Daily.sentIdx]);
  const res = compareSentence(val, e.example);

  // 回寫 SM-2（造句也是一次提取練習）
  await recordAnswer(State.profile, e, res.correct, false, false);
  Daily.plan.progress[e.id] = Daily.plan.progress[e.id] || {};
  Daily.plan.progress[e.id].sentence = res.correct ? 'correct' : 'wrong';
  Daily.plan.updatedAt = Date.now();
  await putDayPlan(Daily.plan);

  const banner = res.correct ? `<div class="result ok">✅ 完全正確！</div>`
    : `<div class="result no">❌ 有些地方不一樣，看看下面的對照</div>`;
  const missing = res.missing.length ? `<p class="hint-area">缺少的字：${res.missing.map(esc).join('、')}</p>` : '';
  $main().innerHTML = `
    ${banner}
    <div class="card">
      <div class="sent-block"><b>你的句子</b><div class="sent-line">${res.userHtml}</div></div>
      <div class="sent-block"><b>正確例句</b><div class="sent-line">${res.standardHtml}
        <button class="btn icon" data-say="${esc(e.example)}">🔊</button></div>
        <div class="ex-zh">${esc(e.example_zh || '')}</div></div>
      ${missing}
    </div>
    <div class="btn-row"><button class="btn primary" id="next">下一句 →</button></div>`;
  document.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say); });
  document.getElementById('next').onclick = () => { Daily.sentIdx++; dailySentenceShow(); };
}

// 儲存並離開（進度已逐題保存，這裡只回日曆）
async function saveAndExitDaily() {
  if (Daily.plan) { Daily.plan.updatedAt = Date.now(); await putDayPlan(Daily.plan); }
  renderCalendar();
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
  $main().innerHTML = `
    <div class="card center">
      <h2>${prettyDate(Daily.date)} 完成 🎉</h2>
      <div class="stat-grid">
        <div><b>${total}</b><span>本組單字</span></div>
        <div><b>${sp}/${total}</b><span>拼字過關</span></div>
        <div><b>${st}/${stTotal}</b><span>造句正確</span></div>
      </div>
      <button class="btn primary" id="back-cal">回日曆</button>
      <a class="btn" href="#report">看每日報告</a>
    </div>`;
  document.getElementById('back-cal').onclick = () => renderCalendar();
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
