// parent.js — 家長專區：月排程/出題碼/手動出題/列印（自 app.js 原樣搬出，G1 拆分）

import { go } from './app.js';
import { renderCalendar } from './daily.js';
import { getAllProfiles, getMeta, getProfile, getRecordsByProfile, putManualGroup, setMeta } from './db.js';
import { deviceRoleNoteHTML } from './more.js';
import { decodeCompletion, decodeSync, encodableIds, encodeWordIds, extractCodes } from './paircode.js';
import { copyToClipboard } from './report.js';
import { KIND_LABEL, buildMonthSchedule, regenerateDay, regroupDay } from './schedule.js';
import { $main, State } from './state.js';
import { esc, prettyDate, todayStr } from './util.js';
import { findByWord, getById, searchWords, wordsByLevels } from './vocab.js';
import { decodeYpCompletion, encodeYpQuiz, extractYpCompletions, levelEntries, loadBook, printYpEntries, unitEntries } from './ypbook.js';


// ============================================================
// 手動出題（把自選單字排到某一天）
// ============================================================
async function createManualGroup(date, name, wordIds, testTypes = null, batchId = null) {
  const id = 'mg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const g = {
    id, profileId: State.profile.id, date, name: name.trim() || '手動單字組', manual: true,
    group: { wordIds: [...new Set(wordIds)], memo: '', memos: [], label: name, groupKey: null },
    readDone: false, progress: {}, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (testTypes) g.testTypes = testTypes; // 題型（拼字／造句）由出題碼指定；未指定＝兩者都測
  if (batchId != null) g.batchId = batchId; // 家長出題的批次編號 → 每日報告的完成碼靠它對帳
  await putManualGroup(g);
  return g;
}

// ---------- 完成碼（N 計畫）：批次編號配發＋家長端記錄 ----------
// 批次編號：家長裝置全域流水號（1..65535 循環），配過就存在該日排程上，重印/重開同一天不換號
async function nextBatchId() {
  const n = ((await getMeta('batchSeq')) || 0) % 65535 + 1;
  await setMeta('batchSeq', n);
  return n;
}
async function ensureDayBatchId(day) {
  if (day.batchId == null) {
    day.batchId = await nextBatchId();
    await saveParentSchedule();
  }
  return day.batchId;
}

// 家長端「已做過」紀錄：meta doneWords::<pid>（wordId 陣列，各生獨立累積）
async function getDoneWords(profileId) {
  return (await getMeta(`doneWords::${profileId}`)) || [];
}
// 貼上的文字裡可能有：每日完成碼 C1（增量）、進度同步碼 S1（全量、可多段）——
// 自動辨識、全部解析、依碼內身分各自累加進該生的已做字庫。
async function recordCompletion(text) {
  const ypCodes = extractYpCompletions(text); // YP 完成碼 YC1（測驗回報）
  // 先移除 YC1（內含 "C1" 子字串，否則會被 C1 完成碼誤抓）再抓 C1／S1
  const rest = String(text || '').replace(/YC1[A-Za-z0-9\-_]{2,}/g, ' ');
  const { completions, syncs } = extractCodes(rest);
  if (!completions.length && !syncs.length && !ypCodes.length) {
    throw new Error('找不到完成碼（C1…）、進度同步碼（S1…）或 YP 完成碼（YC1…），請確認貼上的內容。');
  }
  // 依身分彙整這次回報的字
  const incoming = new Map(); // pid -> { ids:Set, sync, comp, yp, ypRes:Map(entryId->flags) }
  const bucket = (pid) => {
    if (!incoming.has(pid)) incoming.set(pid, { ids: new Set(), sync: false, comp: false, yp: false, ypRes: new Map() });
    return incoming.get(pid);
  };
  for (const c of completions) {
    const { profileId, batches } = decodeCompletion(c);
    const b = bucket(profileId); b.comp = true;
    for (const bt of batches) bt.ids.forEach((id) => b.ids.add(id));
  }
  for (const s of syncs) {
    const { profileId, ids } = decodeSync(s);
    const b = bucket(profileId); b.sync = true;
    ids.forEach((id) => b.ids.add(id));
  }
  for (const y of ypCodes) {
    const { profileId, results } = decodeYpCompletion(y);
    const b = bucket(profileId); b.yp = true;
    for (const r of results) {
      b.ypRes.set(r.id, (b.ypRes.get(r.id) || 0) | r.flags);
      // YP 字若也在 6000 → 一併記入 doneWords，未來排程也跳過（共用記憶）
      const m = r.entry && findByWord(r.entry.word);
      if (m) b.ids.add(m.id);
    }
  }
  // 各生獨立合併進已做字庫（＋ YP 專屬完成紀錄）
  const msgs = [];
  for (const [pid, b] of incoming) {
    const prof = await getProfile(pid);
    const name = prof ? prof.name : pid;
    if (b.ids.size) {
      const before = await getDoneWords(pid);
      const done = new Set(before);
      b.ids.forEach((id) => done.add(id));
      await setMeta(`doneWords::${pid}`, [...done]);
      const kind = b.sync ? (b.comp || b.yp ? '同步碼＋完成碼' : '進度同步碼') : (b.yp && !b.comp ? 'YP 完成碼' : '完成碼');
      msgs.push(`✅ 已記錄 ${name}（${kind}）：本次回報 ${b.ids.size} 字、累計已做 ${done.size} 字`);
    }
    if (b.yp) {
      const prev = (await getMeta(`ypDone::${pid}`)) || {};
      let spOk = 0, spT = 0, seOk = 0, seT = 0;
      for (const [id, f] of b.ypRes) {
        prev[id] = (prev[id] || 0) | f;
        if (f & 1) { spT++; if (f & 2) spOk++; }
        if (f & 4) { seT++; if (f & 8) seOk++; }
      }
      await setMeta(`ypDone::${pid}`, prev);
      msgs.push(`  📖 ${name} 的 YP 測驗：${b.ypRes.size} 字`
        + (spT ? `　拼字 ${spOk}/${spT}` : '') + (seT ? `　造句 ${seOk}/${seT}` : '')
        + `（YP 累計 ${Object.keys(prev).length} 字）`);
    }
  }
  return msgs.join('\n');
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
// L-3 家長專區：月排程 + 出題碼(QR) + 列印
// 排程存在家長裝置（meta: parentSchedule::<pid>），只單向用出題碼把「要考哪些字」帶到孩子手機。
// ============================================================
const Parent = { sched: null, target: null };

// Q：出題對象——家長專區的排程/出題碼/列印全部以「對象」為準，
// 與右上角的作答身分脫鉤（兩個孩子進度不同，出題必須指定給誰）。
function pzTarget() {
  return Parent.target || State.profile;
}
async function loadParentTarget() {
  if (Parent.target) return Parent.target;
  const savedId = await getMeta('parentTarget');
  Parent.target = (savedId && await getProfile(savedId)) || State.profile;
  return Parent.target;
}

async function loadParentSchedule() {
  Parent.sched = (await getMeta(`parentSchedule::${pzTarget().id}`)) || null;
  return Parent.sched;
}
async function saveParentSchedule() {
  await setMeta(`parentSchedule::${pzTarget().id}`, Parent.sched);
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
  await loadParentTarget();
  await loadParentSchedule();
  const tgt = pzTarget();
  const profiles = await getAllProfiles();
  const s = tgt.settings;
  const today = todayStr();
  const defEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 29); return todayStr(d); })();
  const hasSched = Parent.sched && Parent.sched.days && Parent.sched.days.length;
  // D：已做／剩餘統計（以完成碼回報為準；「剩」＝目前設定級別內未回報做過的字數）
  const doneList = await getDoneWords(tgt.id);
  const doneCount = doneList.length;
  const doneSet = new Set(doneList);
  const lvls = (s.levels && s.levels.length) ? s.levels : [4, 5, 6];
  const remaining = wordsByLevels(lvls).filter((e) => !doneSet.has(e.id)).length;

  $main().innerHTML = `
    <div class="card">
      <h2>👨‍👩‍👧 家長專區</h2>
      <div>出題對象：</div>
      <div class="btn-row">
        ${profiles.map((p) => `<button class="btn ${p.id === tgt.id ? 'primary' : ''}" data-tg="${p.id}">${esc(p.name)}</button>`).join('')}
      </div>
      <p class="hint-area">本頁的排程／出題碼／列印全部出給 <b>${esc(tgt.name)}</b>（跳過的是 <b>${esc(tgt.name)}</b> 做過的字），
      與畫面右上的作答身分無關。</p>
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
    <div class="card">
      <h3>📖 從 YP 單字書出題</h3>
      <p class="hint-area">選 YP 的 Level／Unit 出一份題給 <b>${esc(tgt.name)}</b>，產生 YP 出題碼／QR 或列印背誦表；孩子掃碼即做，測完用「YP 完成碼」回報。</p>
      <button class="btn primary" id="pz-yp">📖 選 YP 範圍出題</button>
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
      <h3>✅ 輸入完成碼／進度同步碼</h3>
      <p class="hint-area">三種碼都貼這裡，會自動辨識：<b>每日完成碼（C1…）</b>＝孩子每天報告末尾附的「這次做了哪些字」；
      <b>進度同步碼（S1…）</b>＝孩子手機「設定」裡產生的「目前為止做過的所有字」（第一次使用時同步一次即可，之後靠每日完成碼累加）；
      <b>YP 完成碼（YC1…）</b>＝孩子在 YP 單字書測驗完，按「傳完成碼給家長」產生的。
      整段報告或多段碼一起貼都可以（碼裡帶著是誰的，會自動歸到正確的孩子）。
      目前已記錄 <b>${esc(tgt.name)}</b> 完成 <b>${doneCount}</b> 字；
      設定級別（Lv${lvls.join('/')}）還有 <b>${remaining}</b> 字未做。重排月排程會自動跳過做過的字。</p>
      <textarea id="pz-comp" class="answer-input code-box" rows="2" placeholder="貼上 C1…／S1…／YC1…，或整段報告、多段碼"></textarea>
      <div class="btn-row">
        <button class="btn primary" id="pz-comp-ok">記錄完成碼</button>
      </div>
      <p id="pz-comp-status" class="hint-area"></p>
    </div>
    <div class="card">
      <h3>✋ 手動出題（排字到某天）</h3>
      <p class="hint-area">臨時自選一批字排到日曆某天（不走月排程）。</p>
      <button class="btn" id="pz-manual">開啟手動出題</button>
    </div>`;

  // 出題對象切換（persist，下次開家長專區記得上次選誰）
  document.querySelectorAll('[data-tg]').forEach((b) => {
    b.onclick = async () => {
      Parent.target = await getProfile(b.dataset.tg);
      await setMeta('parentTarget', Parent.target.id);
      Parent.sched = null; // 換對象 → 載入該生自己的排程
      renderParentZone();
    };
  });
  document.getElementById('pz-comp-ok').onclick = async () => {
    const status = document.getElementById('pz-comp-status');
    status.style.whiteSpace = 'pre-line'; // 多段/多人回報逐行顯示
    try {
      status.textContent = await recordCompletion(document.getElementById('pz-comp').value);
      document.getElementById('pz-comp').value = '';
    } catch (e) {
      status.textContent = `⚠️ ${e.message}`;
    }
  };
  document.getElementById('pz-gen').onclick = generateSchedule;
  document.getElementById('pz-yp').onclick = openYpQuizModal;
  document.getElementById('pz-manual').onclick = () => go('#manual');
  const vbtn = document.getElementById('pz-view');
  if (vbtn) vbtn.onclick = () => renderScheduleView();
  const pall = document.getElementById('pz-print-all');
  if (pall) pall.onclick = () => openPrintPicker(Parent.sched.days);
}

// S-4：家長從 YP 某 Level/Unit 出題 → YP 出題碼（YQ1）/QR/列印
async function openYpQuizModal() {
  let book;
  try { book = await loadBook(); } catch (e) { alert('尚未匯入 YP 單字書資料（請先在電腦執行 build_books.py）'); return; }
  const tgt = pzTarget();
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>📖 從 YP 出題給 ${esc(tgt.name)}</h3>
      <label class="ts-row">Level
        <select id="yq-level" class="answer-input">${book.levels.map((l) => `<option value="${l.level}">Level ${l.level}（${l.wordCount} 字）</option>`).join('')}</select></label>
      <label class="ts-row">範圍
        <select id="yq-unit" class="answer-input"></select></label>
      <div>題型：</div>
      <div class="src-opts">
        <label class="chk"><input type="radio" name="yqt" value="both" checked/> 拼字＋造句</label>
        <label class="chk"><input type="radio" name="yqt" value="spelling"/> 只拼字</label>
        <label class="chk"><input type="radio" name="yqt" value="sentence"/> 只造句</label>
      </div>
      <div class="btn-row">
        <button class="btn primary" id="yq-gen">產生出題碼／QR</button>
        <button class="btn" id="yq-cancel">取消</button>
      </div>
      <div id="yq-out"></div>
    </div>`;
  m.classList.add('show');
  const levelSel = document.getElementById('yq-level');
  const unitSel = document.getElementById('yq-unit');
  const fillUnits = () => {
    const lv = book.levels.find((l) => l.level === +levelSel.value);
    unitSel.innerHTML = `<option value="all">整個 Level（${lv.wordCount} 字）</option>`
      + lv.units.map((u) => `<option value="${u.unit}">Unit ${u.unit}（${u.count} 字）</option>`).join('');
  };
  fillUnits();
  levelSel.onchange = fillUnits;
  document.getElementById('yq-cancel').onclick = () => m.classList.remove('show');
  document.getElementById('yq-gen').onclick = () => {
    const level = +levelSel.value;
    const unitVal = unitSel.value;
    const entries = unitVal === 'all' ? levelEntries(level) : unitEntries(level, +unitVal);
    if (!entries.length) { alert('這個範圍沒有字'); return; }
    const type = (document.querySelector('input[name="yqt"]:checked') || {}).value || 'both';
    const types = { spelling: type !== 'sentence', sentence: type !== 'spelling' };
    const code = encodeYpQuiz(tgt.id, entries.map((e) => e.id), types);
    const name = `YP Lv${level}${unitVal === 'all' ? '' : ' Unit ' + unitVal}`;
    const typeLabel = type === 'both' ? '拼字＋造句' : type === 'spelling' ? '只拼字' : '只造句';
    const out = document.getElementById('yq-out');
    out.innerHTML = `
      <p class="hint-area">出給 <b>${esc(tgt.name)}</b>・${esc(name)}・${entries.length} 字・${typeLabel}</p>
      ${code.length <= 800 ? qrSvg(code) : '<p class="hint-area">字數較多，建議用列印或下方出題碼傳給孩子。</p>'}
      <textarea class="answer-input code-box" readonly rows="3">${esc(code)}</textarea>
      <div class="btn-row">
        <button class="btn primary" id="yq-copy">複製出題碼</button>
        <button class="btn" id="yq-print">🖨️ 列印單字表</button>
      </div>`;
    document.getElementById('yq-copy').onclick = async () => {
      const ok = await copyToClipboard(code);
      document.getElementById('yq-copy').textContent = ok ? '✅ 已複製' : '請長按上方文字複製';
    };
    document.getElementById('yq-print').onclick = () => printYpEntries(`${tgt.name}・${name}（${entries.length} 字）`, entries);
  };
}

async function generateSchedule() {
  const levels = [...document.querySelectorAll('.pz-lv:checked')].map((c) => Number(c.value));
  if (!levels.length) { alert('請至少選一個級別'); return; }
  const perDay = Math.max(3, Math.min(30, parseInt(document.getElementById('pz-per').value, 10) || 15));
  const startDate = document.getElementById('pz-start').value;
  const endDate = document.getElementById('pz-end').value;
  const includeReview = document.getElementById('pz-review').checked;
  if (!startDate || !endDate || endDate < startDate) { alert('請確認起迄日期'); return; }
  const records = await getRecordsByProfile(pzTarget().id);
  const doneWordIds = await getDoneWords(pzTarget().id); // 該生完成碼回報做過的字：不再排入、進複習池
  Parent.sched = buildMonthSchedule(records, { levels, perDay, startDate, endDate, includeReview, doneWordIds });
  await saveParentSchedule();
  const newDays = Parent.sched.days.filter((d) => d.kind === 'new').length;
  alert(`✅ 已為 ${pzTarget().name} 排 ${Parent.sched.days.length} 天，其中新字 ${newDays} 天${doneWordIds.length ? `（已自動跳過 ${pzTarget().name} 做過的 ${doneWordIds.length} 字）` : ''}。可查看並微調。`);
  renderScheduleView();
}

function renderScheduleView() {
  const days = Parent.sched.days;
  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="sv-back">‹ 家長專區</button><b>🗓 月排程</b></div>
      <p class="hint-area"><b>本批出給：${esc(pzTarget().name)}</b>。每天一張卡：可換一批、加字、移除字，或產生出題碼／QR 給孩子掃。</p>
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
      const records = await getRecordsByProfile(pzTarget().id);
      const doneWordIds = await getDoneWords(pzTarget().id);
      regenerateDay(Parent.sched, records, Parent.sched.days[idx].date, doneWordIds);
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

async function openDayCode(idx) {
  const day = Parent.sched.days[idx];
  await ensureDayBatchId(day); // 出題碼帶批次編號，完成碼回報時對帳用
  const skipped = day.wordIds.length - encodableIds(day.wordIds).length;
  const m = document.getElementById('modal');

  const draw = () => {
    const code = encodeWordIds(day.wordIds, dayTypes(day), day.batchId, pzTarget().id);
    m.innerHTML = `
      <div class="modal-box center">
        <h3>🔳 ${prettyDate(day.date)} 出題碼</h3>
        <p class="hint-area"><b>出給：${esc(pzTarget().name)}</b>（掃碼時會核對身分）。孩子手機：測驗 → 📷 家長出的題 → 掃這個 QR 或貼下面的碼。</p>
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

async function doPrint(mode, days) {
  // 紙本 QR 也帶批次編號：先為還沒配號的日子配號（配過的不換）
  for (const day of days) await ensureDayBatchId(day);
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
  // 紙本 QR 與螢幕出題碼用同一份「題型」「批次編號」「出題對象」→ 手機掃紙本或螢幕完全一致
  const types = dayTypes(day);
  const code = encodeWordIds(day.wordIds, types, day.batchId != null ? day.batchId : null, pzTarget().id);
  const qr = qrSvg(code, 3);
  const typeLabel = types.sentence ? '拼字＋造句' : '只考拼字';
  const head = `<div class="pr-head"><h2>${esc(pzTarget().name)}・${prettyDate(day.date)}　${KIND_LABEL[day.kind] || ''}（${day.wordIds.length} 字・${typeLabel}）</h2>
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
export { createManualGroup, openScheduleModal, ManualBuilder, renderManualBuilder, drawManualResults, drawManualSelected, Parent, loadParentSchedule, saveParentSchedule, qrSvg, renderParentZone, generateSchedule, renderScheduleView, scheduleDayCard, bindScheduleDayActions, openAddWordToDay, dayTypes, openDayCode, openPrintPicker, rootBreakdownHTML, doPrint, printDayHTML, getDoneWords, recordCompletion };
