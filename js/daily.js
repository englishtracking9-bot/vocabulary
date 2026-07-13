// daily.js — 學習日曆與當日學習流程（先讀→拼字→造句）（自 app.js 原樣搬出，G1 拆分）

import { dayKey, deleteDayPlan, deleteManualGroup, getDayPlan, getDaysByProfile, getManualGroupsByDate, getManualGroupsByProfile, getRecordsByProfile, putDayPlan, putManualGroup } from './db.js';
import { formDailyGroup } from './grouping.js';
import { speak } from './lookup.js';
import { lookupTermNavigate } from './lookupui.js';
import { openWordDetail, renderGroups, renderMyWords } from './mywords.js';
import { Session, recordAnswer } from './quiz.js';
import { archiveSnapshot } from './report.js';
import { compareSentence } from './sentence.js';
import { isIntroduced, statusBadge } from './srs.js';
import { $main, State, refreshMastered } from './state.js';
import { esc, prettyDate, todayStr } from './util.js';
import { checkAnswer, getById } from './vocab.js';
import { attachCardHandlers, cardHTML, senseBlockHTML } from './wordcard.js';


// ============================================================
// E：系統自動組「順延」——某天沒做，字不作廢
// 過去未完成的自動組：還沒做完的字（排除已學過 isIntroduced、已排在今天/未來的）
// 搬進今天的自動組，部分進度一併帶著；過去那天只留「已做完的字」（一個都沒做就整天清掉）。
// 只處理系統自動組；家長手動組/QR 組（manualGroups）與家長模式的空殼（parentMode）不順延。
// ============================================================
async function rolloverAutoPlans() {
  if (State.profile.settings.dailySource === 'parent') return 0; // 家長排程模式：手機不自動排字，也不順延
  const today = todayStr();
  const days = await getDaysByProfile(State.profile.id);
  const pastIncomplete = days
    .filter((d) => d.date < today && !d.parentMode && d.group.wordIds.length
      && d.group.wordIds.some((id) => !wordDayDone(d, id)))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!pastIncomplete.length) return 0;

  const records = await getRecordsByProfile(State.profile.id);
  const introduced = new Set(records.filter(isIntroduced).map((r) => r.wordId));
  // 今天與未來已排的字 → 不重複搬入
  const upcoming = new Set();
  days.forEach((d) => { if (d.date >= today) d.group.wordIds.forEach((id) => upcoming.add(id)); });

  const todayPlan = await ensureDayPlan(today);
  todayPlan.group.wordIds.forEach((id) => upcoming.add(id));

  let moved = 0;
  for (const plan of pastIncomplete) {
    const doneIds = plan.group.wordIds.filter((id) => wordDayDone(plan, id));
    for (const id of plan.group.wordIds) {
      if (doneIds.includes(id) || introduced.has(id) || upcoming.has(id)) continue;
      todayPlan.group.wordIds.push(id);
      upcoming.add(id);
      if (plan.progress[id]) todayPlan.progress[id] = plan.progress[id]; // 帶著部分進度（如拼字已過）
      moved++;
    }
    if (doneIds.length) {
      // 過去那天縮成「只剩已做完的字」→ 日曆顯示 ✓，做過的紀錄不消失
      plan.group.wordIds = doneIds;
      plan.updatedAt = Date.now();
      await putDayPlan(plan);
    } else {
      await deleteDayPlan(State.profile.id, plan.date); // 整天都沒做 → 清掉
    }
  }
  if (moved) {
    todayPlan.updatedAt = Date.now();
    await putDayPlan(todayPlan);
  }
  return moved;
}

// ============================================================
// 學習日曆
// ============================================================
const Cal = { year: null, month: null }; // month: 0-11

async function renderCalendar() {
  const now = new Date();
  if (Cal.year == null) { Cal.year = now.getFullYear(); Cal.month = now.getMonth(); }
  const rolled = await rolloverAutoPlans(); // E：先把過去沒做完的字順延到今天

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
      ${rolled ? `<p class="hint-area">⏩ 之前沒做完的 ${rolled} 個字已順延到今天，不會漏掉。</p>` : ''}
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

// ============================================================
// 完成定義（G3 完成碼地基）：「一個字還要做什麼／完成了沒」的唯一真理來源。
// 日曆打勾、進度％、當日流程派工（dispatchDaily）、未來的完成碼，一律用這三個函式，
// 不得在別處另寫 progress 判斷。
// ============================================================

// 這個字還需要拼字測驗嗎？（題型不含拼字＝不需要）
function wordNeedsSpelling(plan, wid) {
  const types = plan.testTypes || { spelling: true, sentence: true };
  if (!types.spelling) return false;
  return (plan.progress[wid] || {}).spelling !== 'correct';
}

// 這個字還需要造句測驗嗎？（題型不含造句、或無例句＝不需要；已作答過即不再考）
function wordNeedsSentence(plan, wid) {
  const types = plan.testTypes || { spelling: true, sentence: true };
  if (!types.sentence) return false;
  const e = getById(wid);
  if (!(e && e.example && e.example.trim())) return false;
  return !(plan.progress[wid] || {}).sentence;
}

// 這個字今天「完成」了沒（日曆打勾、進度％都用這個）＝該做的都做完了。
// 與派工共用同一組定義 → 題型「只考拼字」的組，拼字全對即完成（不再卡在造句）。
function wordDayDone(plan, wid) {
  return !wordNeedsSpelling(plan, wid) && !wordNeedsSentence(plan, wid);
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
  if (dateStr === todayStr()) await rolloverAutoPlans(); // E：從首頁等捷徑直接開今天也要先順延
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
      ${(isManual && g.batchId == null) ? `<div class="btn-row"><button class="btn danger" data-del="${g.id}">🗑 刪除此手動組</button></div>`
        : (isManual ? '<div class="row-meta">📷 家長出的題（永久記錄，點開可看答題狀況）</div>' : '')}
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

  // 題型文案跟著 plan.testTypes（出題碼可指定「只考拼字」）
  const tt = plan.testTypes || { spelling: true, sentence: true };
  const flowText = tt.sentence ? '拼字＋造句' : '拼字';

  const rows = plan.group.wordIds.map((id) => {
    const e = getById(id);
    if (!e) return '';
    const rec = recMap.get(id);
    const badge = rec ? statusBadge(rec.status) : '🆕 未測驗';
    // I：本組作答狀況（✏️ 拼字／🧩 造句，✅ 對 ❌ 錯；沒作答不顯示）
    const p = plan.progress[id] || {};
    const marks = [];
    if (tt.spelling && p.spelling) marks.push(`✏️${p.spelling === 'correct' ? '✅' : '❌'}`);
    if (tt.sentence && p.sentence) marks.push(`🧩${p.sentence === 'correct' ? '✅' : '❌'}`);
    return `<div class="row tap" data-id="${id}">
      <div class="row-main">
        <span class="row-word">${esc(e.word)}
          <button class="btn icon" data-say="${esc(e.answerKeys[0])}">🔊</button></span>
        <span class="row-zh">${esc(e.zh)}</span>
      </div>
      <div class="row-meta"><span>${esc(e.pos)}・Lv${e.level}</span>${marks.length ? `<span>${marks.join(' ')}</span>` : ''}<span>${badge}</span></div>
    </div>`;
  }).join('');

  // I：本組答對率（以拼字為準；作答過才顯示）
  const spAnswered = plan.group.wordIds.filter((id) => (plan.progress[id] || {}).spelling).length;
  const spCorrect = plan.group.wordIds.filter((id) => (plan.progress[id] || {}).spelling === 'correct').length;
  const rateLine = spAnswered
    ? `　拼字答對 ${spCorrect}/${spAnswered}（${Math.round(spCorrect / spAnswered * 100)}%）` : '';

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
      <div class="row-meta">進度：${doneCount}/${total} 字完成${rateLine}${isPast ? '（純查看，可重練）' : ''}</div>
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

  const needSpelling = plan.group.wordIds.filter((id) => wordNeedsSpelling(plan, id));
  if (needSpelling.length) return startSpelling(needSpelling);

  const needSentence = plan.group.wordIds.filter((id) => wordNeedsSentence(plan, id));
  if (needSentence.length) return startSentence(needSentence);

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
          ${(browse || plan.batchId != null) ? '' : `<button class="btn icon remove-word" data-rm="${e.id}" title="從今天移除">✕</button>`}
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
export { Cal, renderCalendar, shiftMonth, dayStatus, wordDayDone, wordNeedsSpelling, wordNeedsSentence, rolloverAutoPlans, Daily, persistPlan, dailyBack, backFromDayList, scheduledWordIds, ensureDayPlan, openDay, enterGroupStudy, renderDayMenu, renderDayList, dispatchDaily, renderReadList, startSpelling, dailySpellingShow, dailySpellingSubmit, sensesWithExample, startSentence, dailySentenceShow, dailySentenceSubmit, saveAndExitDaily, renderDayDone };
