// app.js — 入口：啟動、路由、身分切換、SW 註冊（G1 拆分後的常駐核心）
import { renderCustomBooks } from './books.js';
import { renderCalendar } from './daily.js';
import { deleteProfileFully, getAllProfiles, getMeta, getProfile, getRecordsByProfile, openDB, putManualGroup, putProfile, setMeta } from './db.js';
import { loadGroupsIndex, loadRoots } from './grouping.js';
import { renderHome } from './home.js';
import { renderLookup } from './lookupui.js';
import { renderGroups, renderMyWords } from './mywords.js';
import { downloadICS, notifyPermission, notifySupported, registerPeriodicReminder, requestNotifyPermission, scheduleForegroundReminder, showReminderNow, syncReminderMeta } from './notify.js';
import { encodableIds, encodeWordIds } from './paircode.js';
import { renderQuiz } from './quizui.js';
import { copyToClipboard } from './report.js';
import { renderReport, resetReportDate } from './reportui.js';
import { renderRoots } from './rootsui.js';
import { renderScan } from './scan.js';
import { KIND_LABEL, buildMonthSchedule, regenerateDay, regroupDay } from './schedule.js';
import { $main, APP_UI_VERSION, DEFAULT_PROFILES, State, refreshMastered } from './state.js';
import { exportProfile, getStats, importProfile } from './stats.js';
import { esc, prettyDate, todayStr } from './util.js';
import { getById, loadVocab, registerCustomWord, searchWords } from './vocab.js';


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

export { createManualGroup, go, openScheduleModal, route };
