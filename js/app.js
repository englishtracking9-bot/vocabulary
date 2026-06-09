// app.js — 啟動、路由、首頁(落點)＋測驗(到期複習)、身分切換
import {
  openDB, getAllProfiles, putProfile, getProfile, setMeta, getMeta,
  getRecordsByProfile, getRecord, putRecord, deleteRecord, deleteProfileFully, getDueRecords,
  getDayPlan, putDayPlan, getDaysByProfile, dayKey, getDailyLog, getDailyLogsByProfile,
  putManualGroup, deleteManualGroup, getManualGroupsByProfile, getManualGroupsByDate,
} from './db.js';
import {
  loadVocab, getById, allWords, registerCustomWord, checkAnswer, searchWords,
} from './vocab.js';
import { buildQueue, Session, recordAnswer } from './quiz.js';
import { lookupWord, fetchDict, speak, addToReview, createCustomWord, updateCustomZh, deleteCustomWord } from './lookup.js';
import { buildDailyReport, buildNewWordsOnly, buildWeeklyReport, copyToClipboard, archiveSnapshot } from './report.js';
import { getStats, exportProfile, importProfile } from './stats.js';
import { displayCategory, statusBadge, computeStatus } from './srs.js';
import { loadGroupsIndex, loadRoots, allRoots, membersOfAffix, formDailyGroup, familyOf, rootFamilyOf } from './grouping.js';
import {
  getTags, createTag, renameTag, deleteTag, setWordTags, addWordToTag, addWordsToTag,
  wordsInTag, tagsOfWord, tagCounts,
} from './tags.js';
import { compareSentence } from './sentence.js';
import { esc, todayStr, prettyDate } from './util.js';
import {
  notifySupported, notifyPermission, requestNotifyPermission, showReminderNow,
  scheduleForegroundReminder, registerPeriodicReminder, syncReminderMeta, downloadICS,
} from './notify.js';

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
  masteredIds: new Set(), // 目前身分「已熟記」的字（供同字根家族標記錨點字）
};

// 重新整理「已熟記」集合（F-2：同字根家族錨點字）
async function refreshMastered() {
  try {
    const recs = await getRecordsByProfile(State.profile.id);
    State.masteredIds = new Set(
      recs.filter((r) => displayCategory(r.status) === 'mastered').map((r) => r.wordId)
    );
  } catch (e) { State.masteredIds = new Set(); }
}

const $main = () => document.getElementById('main');

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
        ReportDate = null; // 報告日期回到今天
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
  '#settings': renderSettings,
};

function route() {
  const hash = location.hash || '#home';
  const fn = ROUTES[hash] || renderHome;
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
// 首頁（預設落點）— 今日進度 + 快捷，不強迫測驗
// ============================================================
async function renderHome() {
  const stats = await getStats(State.profile.id);
  const today = todayStr();
  const due = await getDueRecords(State.profile.id, Date.now());
  const dueCount = due.length;

  // 今天的單字組進度（若已生成）
  const autoPlan = await getDayPlan(State.profile.id, today);
  let groupLabel = '今天的單字組';
  if (autoPlan && autoPlan.group.wordIds.length) {
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
      <p class="hint-area">想去哪就點哪，今天慢慢來 😊</p>
      <button class="btn primary big-copy" id="h-group">▶️ ${esc(groupLabel)}</button>
      <button class="btn big-copy" id="h-review">🔁 今天該複習的到期字（${dueCount}）</button>
      <div class="btn-row">
        <button class="btn" id="h-lookup">🔎 查單字</button>
        <button class="btn" id="h-mywords">📋 我的單字</button>
      </div>
    </div>`;
  document.getElementById('h-group').onclick = () => openDay(today);
  document.getElementById('h-review').onclick = () => go('#quiz');
  document.getElementById('h-lookup').onclick = () => go('#lookup');
  document.getElementById('h-mywords').onclick = () => go('#mywords');
  document.querySelectorAll('.stat-cell.tap').forEach((c) => { c.onclick = () => openStatDetail(c.dataset.stat); });
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
    return `<div class="row"><div class="row-main">
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
    title = '🔥 最近學習日';
    body = days.length ? days.map((l) => `<div class="row"><div class="row-main">
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
}

// ============================================================
// 測驗（只出「今天到期該複習」的字；學新字走日曆）
// ============================================================
async function renderQuiz() {
  if (!State.session || State.session.remaining === 0) {
    const items = await buildQueue(State.profile, Date.now(), { reviewOnly: true });
    State.session = new Session(items);
  }
  if (State.session.remaining === 0) {
    return renderReviewEmpty();
  }
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
      <a class="btn" href="#report">看每日報告</a>
    </div>`;
  document.getElementById('again').onclick = async () => {
    const items = await buildQueue(State.profile, Date.now(), { reviewOnly: true });
    State.session = new Session(items);
    if (State.session.remaining === 0) renderReviewEmpty();
    else showQuestion();
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

// ============================================================
// 單字卡（共用）
// ============================================================
// 把英文句子拆成「可點的單字 + 原樣標點空白」。點字會去掉標點與大小寫再查。
function exampleHTML(sentence) {
  const s = sentence || '';
  let out = '';
  let last = 0;
  const re = /[A-Za-z][A-Za-z'’-]*/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out += esc(s.slice(last, m.index)); // 中間的標點／空白原樣保留
    const word = m[0];
    const clean = word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
    out += clean
      ? `<span class="ex-word" data-look="${esc(clean)}">${esc(word)}</span>`
      : esc(word);
    last = m.index + word.length;
  }
  out += esc(s.slice(last));
  return out;
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

function cardHTML(entry, dict) {
  const phon = (dict && dict.phonetic) ? `<span class="phon">${esc(dict.phonetic)}</span>` : '';
  let examples = '';
  if (entry.example && entry.example.trim()) {
    // 優先用已存的標準例句（含中文翻譯，離線可用）；例句裡每個字可點
    examples = `<div class="examples"><b>例句</b>
      <div class="ex-en">${exampleHTML(entry.example)} <button class="btn icon" data-say="${esc(entry.example)}">🔊</button></div>
      ${entry.example_zh ? `<div class="ex-zh">${esc(entry.example_zh)}</div>` : ''}</div>`;
  } else if (dict && dict.examples && dict.examples.length) {
    examples = `<div class="examples"><b>例句</b><ul>${dict.examples.map((x) => `<li>${exampleHTML(x)}</li>`).join('')}</ul></div>`;
  }
  const note = entry.note ? `<div class="note">補充（相關詞）：${esc(entry.note)}</div>` : '';
  const customTag = entry.custom ? `<span class="tag-custom">🔖 我查的字</span>` : '';
  const definition = (entry.custom && entry.definition)
    ? `<div class="def">釋義：${esc(entry.definition)}</div>` : '';
  let root = '';
  if (Array.isArray(entry.root) && entry.root.length) {
    const seg = entry.root.map((p) => `<b>${esc(p.part)}</b>(${esc(p.mean)})`).join(' + ');
    const eq = `<b>${esc(entry.word)}</b>${entry.zh ? '（' + esc(entry.zh) + '）' : ''}`;
    root = `<div class="root">🔧 字根拆解：${seg} = ${eq}</div>`;
  } else if (typeof entry.root === 'string' && entry.root) {
    root = `<div class="root">🔧 字根拆解：${esc(entry.root)}</div>`;
  }
  // F-3：可念音節（僅當各部位剛好拼回單字才顯示）
  const syllable = entry.syllable
    ? `<div class="syllable">🔡 照音節拼：<b>${esc(entry.syllable)}</b></div>` : '';
  // F-1：記憶聯想
  const mnemonic = entry.mnemonic
    ? `<div class="mnemonic">🧠 記憶聯想：${esc(entry.mnemonic)}</div>` : '';
  // 同字根家族（最多 8 個，可點）；F-2：已學會的字標成錨點
  let family = '';
  const fam = rootFamilyOf(entry.id).slice(0, 8);
  if (fam.length) {
    let anyLearned = false;
    const chips = fam.map((id) => {
      const fe = getById(id);
      if (!fe) return '';
      const learned = State.masteredIds && State.masteredIds.has(id);
      if (learned) anyLearned = true;
      return `<span class="fam-chip ${learned ? 'learned' : ''}" data-fam="${id}">${learned ? '✓ ' : ''}${esc(fe.word)}</span>`;
    }).join('');
    const hint = anyLearned ? '<div class="fam-hint">✓ 是你已學會的字，用它來記住同字根的新字</div>' : '';
    family = `<div class="family"><b>同字根家族</b><div class="fam-chips">${chips}</div>${hint}</div>`;
  }
  const levelLabel = entry.level === 0 ? '我查的字' : `Level ${entry.level}`;
  return `
    <div class="card word-card">
      <div class="word-head">
        <span class="word-en">${esc(entry.word)}</span>
        <button class="btn icon" data-say="${esc(entry.answerKeys[0])}">🔊</button>
        ${customTag}
      </div>
      ${phon}
      <div class="pos">${esc(entry.pos) || ''}${entry.pos ? '・' : ''}${levelLabel}</div>
      <div class="zh">${esc(entry.zh) || '（尚無中文，可在下方補上）'}</div>
      ${definition}
      ${note}
      ${examples}
      ${root}
      ${syllable}
      ${mnemonic}
      ${family}
    </div>`;
}

function attachCardHandlers(entry) {
  document.querySelectorAll('[data-say]').forEach((b) => {
    b.onclick = () => speak(b.dataset.say);
  });
  // 同字根家族：點一個字 → 開該字卡
  document.querySelectorAll('[data-fam]').forEach((c) => {
    c.onclick = () => openWordDetail(c.dataset.fam);
  });
  // 例句裡的單字：點 → 走查單字流程
  document.querySelectorAll('[data-look]').forEach((w) => {
    w.onclick = () => lookupTermNavigate(w.dataset.look);
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

  let actionBtn;
  if (allDone) {
    actionBtn = `<button class="btn primary big-copy" id="day-start">🔁 重新練習這組</button>`;
  } else if (isPast) {
    actionBtn = `<button class="btn primary big-copy" id="day-start">繼續測驗（先讀→拼字＋造句）</button>`;
  } else {
    const label = plan.readDone ? '▶️ 繼續測驗' : '▶️ 開始（先讀 → 拼字 ＋ 造句）';
    actionBtn = `<button class="btn primary big-copy" id="day-start">${label}</button>`;
  }

  const namePart = isGroup ? esc(plan.groupName)
    : isManual ? `✋ ${esc(plan.name)}` : prettyDate(Daily.date);
  const title = `${namePart}・單字清單（${total} 字）`;
  const memoText = isGroup ? '群組測驗：先讀一遍，再拼字＋造句'
    : isManual ? `手動單字組（${prettyDate(plan.date)}）：先讀一遍，再拼字＋造句`
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
      <div class="read-card">
        <div class="word-head">
          <span class="word-en">${esc(e.word)}</span>
          <button class="btn icon" data-say="${esc(e.answerKeys[0])}">🔊</button>
          ${browse ? '' : `<button class="btn icon remove-word" data-rm="${e.id}" title="從今天移除">✕</button>`}
        </div>
        <div class="pos">${esc(e.pos)}・Lv${e.level}</div>
        <div class="zh">${esc(e.zh)}</div>
        ${Array.isArray(e.root) && e.root.length ? `<div class="root">🔧 ${e.root.map((p) => `${esc(p.part)}(${esc(p.mean)})`).join(' + ')}</div>` : ''}
        ${e.syllable ? `<div class="syllable">🔡 照音節拼：<b>${esc(e.syllable)}</b></div>` : ''}
        ${e.mnemonic ? `<div class="mnemonic">🧠 ${esc(e.mnemonic)}</div>` : ''}
        ${e.example ? `<div class="examples">
          <div class="ex-en">${exampleHTML(e.example)} <button class="btn icon" data-say="${esc(e.example)}">🔊</button></div>
          <div class="ex-zh">${esc(e.example_zh || '')}</div>
        </div>` : ''}
      </div>`;
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
  await recordAnswer(State.profile, e, res.correct, false, false, Date.now(),
    { input: val, answer: e.example, kind: 'sentence' });
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
      <div class="sent-block"><b>正確例句</b><div class="sent-line">${res.standardHtml}
        <button class="btn icon" data-say="${esc(e.example)}">🔊</button></div>
        <div class="ex-zh">${esc(e.example_zh || '')}</div></div>
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
async function createManualGroup(date, name, wordIds) {
  const id = 'mg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const g = {
    id, profileId: State.profile.id, date, name: name.trim() || '手動單字組', manual: true,
    group: { wordIds: [...new Set(wordIds)], memo: '', memos: [], label: name, groupKey: null },
    readDone: false, progress: {}, createdAt: Date.now(), updatedAt: Date.now(),
  };
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
  let banner;
  if (justCreated) {
    banner = `<div class="result ok">✅ 已加入「我查的字」清單${entry.zh ? '' : '（記得補上中文意思）'}</div>`;
  } else if (autoAdded) {
    banner = `<div class="result ok">✅ 已自動加入待學清單</div>`;
  } else if (cat === 'mastered') {
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
        ${cat === 'mastered'
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
          <option value="new">🆕 未測驗</option>
          <option value="weak">📖 需加強</option>
          <option value="mastered">✅ 已熟記</option>
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
const RootsFilter = { type: 'all', q: '' };
const TYPE_LABEL = { prefix: '字首', root: '字根', suffix: '字尾' };

function renderRoots() {
  const roots = allRoots();
  $main().innerHTML = `
    <div class="card">
      <h2>字根字首記憶法</h2>
      <div class="filters">
        <select id="rt-type">
          <option value="all">全部</option>
          <option value="prefix">字首 prefix-</option>
          <option value="root">字根 root</option>
          <option value="suffix">字尾 -suffix</option>
        </select>
      </div>
      <input id="rt-q" class="answer-input" placeholder="搜尋字根或中文意思（如 port、運送）" />
      <p class="hint-area">共 ${roots.length} 個字首／字根／字尾。點一個看意思、聯想與整組衍生字。</p>
    </div>
    <div id="rt-list"></div>`;
  const tEl = document.getElementById('rt-type');
  const qEl = document.getElementById('rt-q');
  tEl.value = RootsFilter.type; qEl.value = RootsFilter.q;
  const update = () => { RootsFilter.type = tEl.value; RootsFilter.q = qEl.value.trim().toLowerCase(); drawRoots(); };
  tEl.onchange = update; qEl.oninput = update;
  drawRoots();
}

function drawRoots() {
  let list = allRoots();
  if (RootsFilter.type !== 'all') list = list.filter((r) => r.type === RootsFilter.type);
  if (RootsFilter.q) {
    const q = RootsFilter.q;
    list = list.filter((r) => r.affix.toLowerCase().includes(q) || (r.meaning || '').includes(q));
  }
  const box = document.getElementById('rt-list');
  if (!list.length) { box.innerHTML = `<div class="card center">沒有符合的字根</div>`; return; }
  box.innerHTML = list.map((r) => {
    const n = membersOfAffix(r.affix, r.type).length;
    const dash = r.type === 'prefix' ? `${esc(r.affix)}-` : (r.type === 'suffix' ? `-${esc(r.affix)}` : esc(r.affix));
    return `<div class="row" data-affix="${esc(r.affix)}" data-type="${r.type}">
      <div class="row-main">
        <span class="row-word">${dash} <span class="rt-type">${TYPE_LABEL[r.type]}</span></span>
        <span class="row-zh">${esc(r.meaning)}</span>
      </div>
      <div class="row-meta"><span>${n} 個衍生字</span></div>
    </div>`;
  }).join('');
  box.querySelectorAll('.row').forEach((row) => {
    row.onclick = () => openRootDetail(row.dataset.affix, row.dataset.type);
  });
}

async function openRootDetail(affix, type) {
  const r = allRoots().find((x) => x.affix === affix && x.type === type);
  if (!r) return;
  const memberIds = membersOfAffix(affix, type);
  const records = await getRecordsByProfile(State.profile.id);
  const recMap = new Map(records.map((x) => [x.wordId, x]));
  const dash = type === 'prefix' ? `${esc(affix)}-` : (type === 'suffix' ? `-${esc(affix)}` : esc(affix));

  const wordRows = memberIds.map((id) => {
    const e = getById(id);
    if (!e) return '';
    const rec = recMap.get(id);
    const badge = rec ? statusBadge(rec.status) : '🆕 未測驗';
    return `<div class="row" data-id="${id}">
      <div class="row-main">
        <span class="row-word">${esc(e.word)}
          <button class="btn icon" data-say="${esc(e.answerKeys[0])}">🔊</button></span>
        <span class="row-zh">${esc(e.zh)}</span>
        ${e.mnemonic ? `<span class="row-mnem">🧠 ${esc(e.mnemonic)}</span>` : ''}
      </div>
      <div class="row-meta"><span>Lv${e.level}</span><span>${badge}</span></div>
    </div>`;
  }).join('');

  $main().innerHTML = `
    <div class="card memo-card">
      <div class="daily-top"><button class="btn" id="rt-back">‹ 字根列表</button>
        <b>${dash}（${TYPE_LABEL[type]}）</b></div>
      <div class="zh" style="font-size:20px">${esc(r.meaning)}</div>
      ${r.note ? `<div class="memo">💡 聯想：${esc(r.note)}</div>` : ''}
    </div>
    <div class="card">
      <div class="row-meta">衍生單字（${memberIds.length}）</div>
    </div>
    ${wordRows || '<div class="card center">本機字表中沒有對應單字</div>'}
    ${memberIds.length ? `<div class="card center">
      <button class="btn primary big-copy" id="rt-add">把這組字加入我的單字</button>
      <p id="rt-add-status" class="hint-area"></p>
    </div>` : ''}`;

  document.getElementById('rt-back').onclick = () => renderRoots();
  document.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => speak(b.dataset.say); });
  document.querySelectorAll('#main .row[data-id]').forEach((row) => {
    row.onclick = (ev) => { if (ev.target.closest('[data-say]')) return; openWordDetail(row.dataset.id); };
  });
  const addBtn = document.getElementById('rt-add');
  if (addBtn) addBtn.onclick = async () => {
    let added = 0;
    for (const id of memberIds) {
      const e = getById(id);
      if (e) { await addToReview(State.profile, e); added++; }
    }
    document.getElementById('rt-add-status').textContent = `✅ 已加入 ${added} 個字到「我的單字」`;
  };
}

// ============================================================
// 每日報告
// ============================================================
let ReportDate = null; // 目前檢視的報告日期（null=今天）

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
    <div id="report-detail"></div>`;
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
