// ypbook.js — YP 單字書：完全獨立專區（S-1 瀏覽；S-2/S-3 測驗與進度另接）
// 資料來源 data/books.json（build_books.py 產出），與 6000 字庫分開；
// 但同一個字（拼字相符）共用同一筆 SM-2 記錄 → 不用背兩次。

import { go } from './app.js';
import { getMeta, getRecordsByProfile, setMeta } from './db.js';
import { speak } from './lookup.js';
import { qrSvg } from './parent.js';
import { recordAnswer } from './quiz.js';
import { copyToClipboard } from './report.js';
import { compareSentence } from './sentence.js';
import { displayCategory, statusBadge } from './srs.js';
import { $main, State, refreshMastered } from './state.js';
import { esc, shuffle } from './util.js';
import { findByWord, getById, registerCustomWord } from './vocab.js';

let _book = null;                 // books.json（載入一次）
// 扁平化 YP 索引（依 books.json 順序，供 YP 完成碼跨裝置對位）
let _ypFlat = [];                 // idx -> entry id
const _ypById = new Map();        // id -> entry(含 level/unit)
const _ypIndex = new Map();       // id -> idx
const YP_TAG = { senior1: 1, junior3: 2 };
const YP_TAG_REV = { 1: 'senior1', 2: 'junior3' };
const Yp = { level: null, unit: null, progress: false }; // 導覽狀態：null=在上一層
const YpSel = { on: false, unit: null, ids: new Set() }; // 單元頁「挑字測驗」選取
const YpTest = { active: false, name: '', items: [], idx: 0, correct: 0, wrong: [], answered: false, backLv: null, backU: null };

async function loadBook() {
  if (_book) return _book;
  const res = await fetch('./data/books.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('無法載入 books.json：' + res.status);
  _book = await res.json();
  registerYpOnlyWords(_book); // YP 專屬字（不在 6000）註冊成 level-0 條目，供顯示與作答
  buildYpIndex(_book);
  return _book;
}

// 扁平化索引：child 與 parent 用同一份 books.json → 相同 idx，YP 完成碼才能對位
function buildYpIndex(book) {
  _ypFlat = []; _ypById.clear(); _ypIndex.clear();
  for (const lv of book.levels) for (const u of lv.units) for (const e of u.entries) {
    _ypIndex.set(e.id, _ypFlat.length);
    _ypById.set(e.id, { ...e, level: lv.level, unit: u.unit });
    _ypFlat.push(e.id);
  }
}

// ---------- YP 完成碼（孩子測完 → 傳給家長紀錄）----------
// 格式 YC1：學生代號(1，0=自訂後接 len+utf8) + [ypIdx(2) + flags(1)]×字
//   flags bit0 拼字測過 / bit1 拼字對 / bit2 造句測過 / bit3 造句對
function b64u(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }

function encodeYpCompletion(profileId, results) {
  const tag = YP_TAG[profileId] || 0;
  const parts = [tag];
  if (tag === 0) { const b = new TextEncoder().encode(String(profileId)); parts.push(b.length, ...b); }
  for (const id in results) {
    const idx = _ypIndex.get(id);
    if (idx == null) continue;
    parts.push((idx >> 8) & 0xff, idx & 0xff, results[id] & 0xff);
  }
  return 'YC1' + b64u(new Uint8Array(parts));
}

// YP 完成碼 → { profileId, results:[{id, flags, entry}] }（供家長端）
function decodeYpCompletion(code) {
  const m = String(code || '').trim().match(/YC1([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error('YP 完成碼格式不符（應以 YC1 開頭）');
  const bytes = unb64u(m[1]);
  let p = 0; const tag = bytes[p++]; let profileId;
  if (tag === 0) { const len = bytes[p++]; profileId = new TextDecoder().decode(bytes.slice(p, p + len)); p += len; }
  else { profileId = YP_TAG_REV[tag]; if (!profileId) throw new Error('YP 完成碼內的學生代號無法辨識'); }
  const results = [];
  for (; p + 2 < bytes.length; p += 3) {
    const idx = (bytes[p] << 8) | bytes[p + 1];
    const id = _ypFlat[idx];
    if (id) results.push({ id, flags: bytes[p + 2], entry: _ypById.get(id) });
  }
  return { profileId, results };
}

// 從貼上的文字抓出所有 YP 完成碼
function extractYpCompletions(text) { return String(text || '').match(/YC1[A-Za-z0-9\-_]{2,}/g) || []; }
// 供 app 啟動時預先載入（讓報告/統計即使沒開 YP 也能顯示 YP 專屬字）
async function ensureBooksLoaded() { try { await loadBook(); } catch (e) { /* 忽略 */ } }

// 把 6000 沒有的 YP 字，註冊成記憶體 level-0 條目（與「查過的字」同一機制，安全：
// level 0 不進 6000 每日排程；讓 getById/報告/統計能正常顯示這些字）。
function registerYpOnlyWords(book) {
  for (const lv of book.levels) for (const u of lv.units) for (const e of u.entries) {
    if (findByWord(e.word)) continue; // 6000 已有 → 用 6000 條目（共用記憶）
    const first = e.senses.find((s) => s.example) || e.senses[0] || {};
    registerCustomWord({
      id: e.id, word: e.word, level: 0, custom: true, yp: true,
      pos: e.senses[0] ? e.senses[0].pos : '',
      zh: e.senses.map((s) => s.zh).filter(Boolean).join('；'),
      answerKeys: [e.word],
      example: first.example || '', example_zh: first.example_zh || '',
      senses: e.senses, root: null, groupKeys: [], mnemonic: null, syllable: null,
    });
  }
}

// YP 字對應到 6000 的記錄 id（拼字相符就共用，否則用自己的 yp-id）
function vocabMatch(entry) { return findByWord(entry.word) || null; }
function recordIdOf(entry) { const m = vocabMatch(entry); return m ? m.id : entry.id; }
// 作答回寫用的「記錄目標」：共用 6000 記錄或 YP 專屬 level-0 記錄
function recordTarget(entry) { const m = findByWord(entry.word); return m ? { id: m.id, level: m.level } : { id: entry.id, level: 0 }; }

// 已讀集合（每身分一份，存 meta；新資料、不動既有學習進度）
async function getReadSet(pid) { return new Set((await getMeta(`ypRead::${pid}`)) || []); }
async function saveReadSet(pid, set) { await setMeta(`ypRead::${pid}`, [...set]); }

// ============================================================
// 進入點：依導覽狀態顯示 level → unit → 單字清單
// ============================================================
async function renderYp() {
  let book;
  try { book = await loadBook(); }
  catch (e) {
    $main().innerHTML = `<div class="card"><div class="daily-top"><button class="btn" id="yp-home">‹ 首頁</button><b>📖 YP 單字書</b></div>
      <p>⚠️ 尚未匯入 YP 單字書資料。請在電腦執行 <code>python scripts/build_books.py</code> 產生 data/books.json。</p></div>`;
    document.getElementById('yp-home').onclick = () => go('#home');
    return;
  }
  if (YpTest.active) return ypShow(); // 測驗進行中：繼續顯示題目
  if (Yp.progress) return renderYpProgress(book);
  if (Yp.level == null) return renderLevels(book);
  const lv = book.levels.find((l) => l.level === Yp.level);
  if (!lv) { Yp.level = null; return renderLevels(book); }
  if (Yp.unit == null) return renderUnits(lv);
  const u = lv.units.find((x) => x.unit === Yp.unit);
  if (!u) { Yp.unit = null; return renderUnits(lv); }
  return renderWords(lv, u);
}

// ---------- 第一層：選 Level ----------
function renderLevels(book) {
  const tiles = book.levels.map((lv) => `
    <button class="block-btn yp yp-tile" data-level="${lv.level}">
      <span class="blk-ic">📖</span>
      <span class="blk-txt"><span class="blk-tt">Level ${lv.level}</span>
      <span class="blk-sub">${lv.unitCount} 單元・${lv.wordCount} 字</span></span>
    </button>`).join('');
  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="yp-home">‹ 首頁</button><b>📖 YP 單字書</b></div>
      <p class="hint-area">YP 單字書是獨立專區，進度與 6000 字相通（同一個字不用背兩次）。選一個 Level 開始。</p>
      <div class="btn-row"><button class="btn" id="yp-progress">📊 看 YP 學習進度</button></div>
    </div>
    <div class="home-sec"><div class="block-grid yp-grid">${tiles || '<p class="hint-area">還沒有資料</p>'}</div></div>`;
  document.getElementById('yp-home').onclick = () => go('#home');
  document.getElementById('yp-progress').onclick = () => { Yp.progress = true; renderYp(); };
  $main().querySelectorAll('.yp-tile[data-level]').forEach((b) => {
    b.onclick = () => { Yp.level = +b.dataset.level; Yp.unit = null; renderYp(); };
  });
}

// ---------- S-3：YP 專屬進度（各生獨立；已熟記/需加強/未測驗＋讀過/測過比例）----------
async function renderYpProgress(book) {
  const recs = await getRecordsByProfile(State.profile.id);
  const recMap = new Map(recs.map((r) => [r.wordId, r]));
  const read = await getReadSet(State.profile.id);

  // 統計一組 entries：{tot, mastered, weak, untested, readN, testedN}
  const tally = (entries) => {
    const t = { tot: 0, mastered: 0, weak: 0, untested: 0, readN: 0, testedN: 0 };
    for (const e of entries) {
      t.tot++;
      if (read.has(e.id)) t.readN++;
      const r = recMap.get(recordIdOf(e));
      if (r && r.attempts > 0) {
        t.testedN++;
        const c = displayCategory(r.status);
        if (c === 'mastered' || c === 'proficient') t.mastered++;
        else t.weak++;
      } else t.untested++;
    }
    return t;
  };
  const bar = (t) => {
    const pct = (n) => t.tot ? Math.round(n / t.tot * 100) : 0;
    return `<div class="yp-prog-bar">
      <i class="seg mastered" style="width:${pct(t.mastered)}%"></i>
      <i class="seg weak" style="width:${pct(t.weak)}%"></i>
      <i class="seg untested" style="width:${pct(t.untested)}%"></i></div>`;
  };

  let body = '';
  for (const lv of book.levels) {
    const lt = tally(lv.units.flatMap((u) => u.entries));
    const unitRows = lv.units.map((u) => {
      const t = tally(u.entries);
      return `<div class="row"><div class="row-main">
          <span class="row-word">Unit ${u.unit}</span>${bar(t)}</div>
        <div class="row-meta"><span>🌳${t.mastered}</span><span>🌿${t.weak}</span><span>未測${t.untested}</span>
          <span>讀${t.readN}/${t.tot}</span></div></div>`;
    }).join('');
    body += `<div class="card">
        <div class="mw-head"><h3>Level ${lv.level}</h3>
          <span class="row-meta">熟 ${lt.mastered}・加強 ${lt.weak}・未測 ${lt.untested}（共 ${lt.tot} 字）</span></div>
        ${bar(lt)}
        <div class="detail-list">${unitRows}</div>
      </div>`;
  }

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="yp-back">‹ 返回</button><b>📊 YP 學習進度・${esc(State.profile.name)}</b></div>
      <p class="hint-area">🌳 已熟記（含穩固）　🌿 需加強　未測＝還沒考過。與 6000 共用的字，這裡與平常進度同步。</p>
    </div>
    ${body}`;
  document.getElementById('yp-back').onclick = () => { Yp.progress = false; renderYp(); };
}

// ---------- 第二層：選 Unit（顯示每單元 讀X／測Y）----------
async function renderUnits(lv) {
  const recs = await getRecordsByProfile(State.profile.id);
  const recMap = new Map(recs.map((r) => [r.wordId, r]));
  const read = await getReadSet(State.profile.id);

  const rows = lv.units.map((u) => {
    let readN = 0, testN = 0;
    for (const e of u.entries) {
      if (read.has(e.id)) readN++;
      const r = recMap.get(recordIdOf(e));
      if (r && r.attempts > 0) testN++;
    }
    return `<div class="row tap yp-unit" data-unit="${u.unit}"><div class="row-main">
        <span class="row-word">Unit ${u.unit}</span>
        <span class="row-zh">${u.count} 字</span></div>
      <div class="row-meta"><span>讀 ${readN}/${u.count}</span><span>測 ${testN}/${u.count}</span><span>›</span></div></div>`;
  }).join('');

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="yp-back">‹ Level</button><b>📖 YP・Level ${lv.level}</b></div>
      <p class="hint-area">共 ${lv.unitCount} 單元、${lv.wordCount} 字。選一個 Unit 看單字。</p>
    </div>
    <div class="card"><div class="detail-list">${rows}</div></div>
    <div class="card center">
      <button class="btn" id="yp-testlv">📝 測整個 Level ${lv.level}（${lv.wordCount} 字）</button>
    </div>`;
  document.getElementById('yp-back').onclick = () => { Yp.level = null; renderYp(); };
  $main().querySelectorAll('.yp-unit[data-unit]').forEach((b) => {
    b.onclick = () => { Yp.unit = +b.dataset.unit; renderYp(); };
  });
  document.getElementById('yp-testlv').onclick = () => {
    const all = lv.units.flatMap((x) => x.entries);
    openYpTypePicker(all, `Level ${lv.level}`);
  };
}

// ---------- 第三層：單元單字清單 ----------
function rootHTML(entry) {
  const vm = vocabMatch(entry);
  if (!vm) return '';
  let out = '';
  if (Array.isArray(vm.root) && vm.root.length) {
    const seg = vm.root.map((p) => `<b>${esc(p.part)}</b>(${esc(p.mean)})`).join(' + ');
    out += `<div class="root">🔧 字根拆解：${seg}</div>`;
  } else if (typeof vm.root === 'string' && vm.root) {
    out += `<div class="root">🔧 字根拆解：${esc(vm.root)}</div>`;
  }
  if (vm.syllable) out += `<div class="syllable">🔡 照音節拼：<b>${esc(vm.syllable)}</b></div>`;
  return out;
}

async function renderWords(lv, u) {
  if (YpSel.unit !== u.unit) { YpSel.on = false; YpSel.ids.clear(); YpSel.unit = u.unit; } // 換單元清空選取
  const recs = await getRecordsByProfile(State.profile.id);
  const recMap = new Map(recs.map((r) => [r.wordId, r]));
  const read = await getReadSet(State.profile.id);
  const sel = YpSel.on;

  const cardHTML = (e) => {
    const isRead = read.has(e.id);
    const rec = recMap.get(recordIdOf(e));
    const tested = rec && rec.attempts > 0;
    const readBadge = `<span class="yp-badge ${isRead ? 'on' : ''}">${isRead ? '✅ 讀過' : '未讀'}</span>`;
    const testBadge = tested ? statusBadge(rec.status) : '<span class="yp-badge">未測</span>';
    const check = sel ? `<input type="checkbox" class="yp-chk" ${YpSel.ids.has(e.id) ? 'checked' : ''}/> ` : '';
    const senses = e.senses.map((s) => `
      <div class="yp-sense">
        <div class="pos">${esc(s.pos)}${s.pos && s.zh ? '　' : ''}${esc(s.zh)}</div>
        ${s.example ? `<div class="examples"><div class="ex-en">${esc(s.example)}
          <button class="btn icon sm" data-say="${esc(s.example)}">🔊</button></div>
          ${s.example_zh ? `<div class="ex-zh">${esc(s.example_zh)}</div>` : ''}</div>` : ''}
      </div>`).join('');
    return `<div class="read-card yp-card ${sel ? 'selrow' : ''}" data-id="${esc(e.id)}">
        <div class="word-head">
          <span class="word-en">${check}${esc(e.word)}</span>
          <button class="btn icon" data-say="${esc(e.word)}">🔊</button>
        </div>
        <div class="yp-badges">${readBadge}${testBadge}</div>
        ${senses}
        ${rootHTML(e)}
      </div>`;
  };

  $main().innerHTML = `
    <div class="card memo-card">
      <div class="daily-top"><button class="btn" id="yp-back">‹ Unit</button><b>📖 YP・Lv${lv.level} Unit ${u.unit}（${u.count} 字）</b></div>
      <div class="memo">💡 ${sel ? '勾選要考的字，再按「測選取的字」。' : '點卡片＝標記「讀過」；🔊 聽發音。'}</div>
      <div class="btn-row">
        <button class="btn primary" id="yp-test">📝 測這個單元</button>
        <button class="btn" id="yp-select">${sel ? '✕ 取消挑字' : '☑ 挑字測驗'}</button>
        <button class="btn" id="yp-readall">✅ 全部已讀</button>
      </div>
      ${sel ? `<div class="btn-row"><span class="row-meta">已選 <b id="yp-selcount">${YpSel.ids.size}</b> 字</span>
        <button class="btn primary" id="yp-testsel">測選取的字</button></div>` : ''}
    </div>
    ${u.entries.map(cardHTML).join('')}`;

  document.getElementById('yp-back').onclick = () => { Yp.unit = null; renderYp(); };
  // 🔊 發音（不觸發「讀過」/選取）
  $main().querySelectorAll('[data-say]').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); speak(b.dataset.say); };
  });
  // 點卡片：挑字模式＝選取；一般模式＝標記讀過
  $main().querySelectorAll('.yp-card[data-id]').forEach((card) => {
    card.onclick = async () => {
      const id = card.dataset.id;
      if (YpSel.on) {
        if (YpSel.ids.has(id)) YpSel.ids.delete(id); else YpSel.ids.add(id);
        const chk = card.querySelector('.yp-chk'); if (chk) chk.checked = YpSel.ids.has(id);
        const c = document.getElementById('yp-selcount'); if (c) c.textContent = YpSel.ids.size;
      } else {
        const set = await getReadSet(State.profile.id);
        if (!set.has(id)) {
          set.add(id); await saveReadSet(State.profile.id, set);
          const badge = card.querySelector('.yp-badge');
          if (badge) { badge.textContent = '✅ 讀過'; badge.classList.add('on'); }
        }
      }
    };
  });
  document.getElementById('yp-test').onclick = () => openYpTypePicker(u.entries, `Lv${lv.level} Unit ${u.unit}`);
  document.getElementById('yp-select').onclick = () => { YpSel.on = !YpSel.on; YpSel.ids.clear(); renderWords(lv, u); };
  const testSel = document.getElementById('yp-testsel');
  if (testSel) testSel.onclick = () => {
    const picked = u.entries.filter((e) => YpSel.ids.has(e.id));
    if (!picked.length) { alert('請先勾選要考的字'); return; }
    openYpTypePicker(picked, `Lv${lv.level} Unit ${u.unit}・選取 ${picked.length} 字`);
  };
  document.getElementById('yp-readall').onclick = async () => {
    const set = await getReadSet(State.profile.id);
    u.entries.forEach((e) => set.add(e.id));
    await saveReadSet(State.profile.id, set);
    renderWords(lv, u);
  };
}

// ============================================================
// S-2：YP 專屬測驗（獨立、自帶內容；拼字/造句分開；回寫 SM-2、共用 6000 記憶）
// ============================================================
function openYpTypePicker(entries, name) {
  const list = entries.slice();
  if (!list.length) { alert('沒有可測的字'); return; }
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal-box">
      <h3>YP 測驗：${esc(name)}（${list.length} 字）</h3>
      <p class="hint-area">要測什麼？（造句測驗只測有例句的字）</p>
      <div class="btn-row"><button class="btn primary big-copy" data-t="both">📝 兩者都測（拼字＋造句）</button></div>
      <div class="btn-row">
        <button class="btn" data-t="spelling">✏️ 只測拼字（看中文拼英文）</button>
        <button class="btn" data-t="sentence">🧩 只測造句（默寫例句）</button>
      </div>
      <button class="btn" id="ypt-close">取消</button>
    </div>`;
  m.classList.add('show');
  m.querySelectorAll('[data-t]').forEach((b) => {
    b.onclick = () => { m.classList.remove('show'); startYpTest(list, name, b.dataset.t); };
  });
  document.getElementById('ypt-close').onclick = () => m.classList.remove('show');
}

function startYpTest(entries, name, type) {
  const items = [];
  for (const e of entries) {
    if (type === 'spelling' || type === 'both') items.push({ e, kind: 'spelling' });
    if (type === 'sentence' || type === 'both') {
      const sense = e.senses.find((s) => s.example);
      if (sense) items.push({ e, kind: 'sentence', sense });
    }
  }
  if (!items.length) { alert('這些字目前沒有可測的題目（造句需要有例句）'); return; }
  Object.assign(YpTest, {
    active: true, name, items: shuffle(items), idx: 0, correct: 0, wrong: [], answered: false,
    backLv: Yp.level, backU: Yp.unit, results: {},
  });
  if (location.hash !== '#yp') location.hash = '#yp';
  ypShow();
}

function ypShow() {
  const t = YpTest;
  if (t.idx >= t.items.length) return ypDone();
  t.answered = false;
  const it = t.items[t.idx];
  const e = it.e;
  const kindLabel = it.kind === 'spelling' ? '✏️ 拼字' : '🧩 造句';
  const head = `<div class="quiz-progress"><span>YP 測驗</span><span>第 ${t.idx + 1} / ${t.items.length} 題</span><span>${kindLabel}</span></div>`;
  const zhAll = e.senses.map((s) => s.zh).filter(Boolean).join('；');
  if (it.kind === 'spelling') {
    $main().innerHTML = `${head}
      <div class="card quiz-card">
        <div class="zh-prompt">${esc(zhAll) || '（無中文）'}</div>
        <div class="pos">${esc(e.senses[0] ? e.senses[0].pos : '')}</div>
        <input id="yp-ans" class="answer-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="latin" placeholder="輸入英文拼字…" />
        <div class="btn-row"><button class="btn primary" id="yp-submit">送出</button><button class="btn" id="yp-say">🔊 聽發音<small>(算提示)</small></button></div>
        <button class="btn save-exit" id="yp-quit">結束測驗</button>
      </div>`;
    const inp = document.getElementById('yp-ans'); inp.focus();
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ypSubmit(); });
    document.getElementById('yp-say').onclick = () => speak(e.word);
  } else {
    const s = it.sense;
    $main().innerHTML = `${head}
      <div class="card quiz-card">
        <p class="hint-area">把這個句子的英文完整默寫出來（含 <b>${esc(e.word)}</b>）：</p>
        <div class="zh-prompt sent-zh">${esc(s.example_zh || '')}</div>
        <div class="pos">關鍵字：${esc(e.word)}</div>
        <textarea id="yp-sent" class="answer-input sent-input" rows="2" autocapitalize="sentences" autocorrect="off" spellcheck="false" placeholder="輸入完整英文句子…"></textarea>
        <div class="btn-row"><button class="btn primary" id="yp-submit">送出</button></div>
        <button class="btn save-exit" id="yp-quit">結束測驗</button>
      </div>`;
    document.getElementById('yp-sent').focus();
  }
  document.getElementById('yp-submit').onclick = ypSubmit;
  document.getElementById('yp-quit').onclick = () => {
    if (!confirm('結束這次 YP 測驗？（已作答的字已回寫進度）')) return;
    YpTest.active = false; Yp.level = t.backLv; Yp.unit = t.backU; renderYp();
  };
}

async function ypSubmit() {
  const t = YpTest;
  if (t.answered) return;
  const it = t.items[t.idx];
  const e = it.e;
  let correct, val, answer, banner, detail = '';
  if (it.kind === 'spelling') {
    const inp = document.getElementById('yp-ans'); val = inp.value;
    if (!val.trim()) { inp.focus(); return; }
    t.answered = true;
    answer = e.word;
    correct = val.trim().toLowerCase() === e.word.trim().toLowerCase();
    banner = correct ? `<div class="result ok">✅ 答對了！</div>`
      : `<div class="result no">❌ 答錯，你寫「${esc(val) || '(空白)'}」，正解：<b>${esc(answer)}</b></div>`;
  } else {
    const ta = document.getElementById('yp-sent'); val = ta.value;
    if (!val.trim()) { ta.focus(); return; }
    t.answered = true;
    const s = it.sense; answer = s.example;
    const res = compareSentence(val, s.example);
    correct = res.correct;
    banner = correct ? `<div class="result ok">✅ 完全正確！</div>` : `<div class="result no">❌ 有些地方不一樣</div>`;
    detail = `<div class="card">
      <div class="sent-block"><b>你的句子</b><div class="sent-line">${res.userHtml}</div></div>
      <div class="sent-block"><b>正確例句</b><div class="sent-line">${res.standardHtml}</div></div></div>`;
  }
  await recordAnswer(State.profile, recordTarget(e), correct, false, false, Date.now(), { input: val, answer, kind: it.kind });
  await markYpTested(State.profile.id, e.id, it.kind);
  await refreshMastered();
  // 累積本次測驗結果（供 YP 完成碼）：flags bit0 拼字測/1 拼字對/2 造句測/3 造句對
  const add = it.kind === 'spelling' ? (1 | (correct ? 2 : 0)) : (4 | (correct ? 8 : 0));
  t.results[e.id] = (t.results[e.id] || 0) | add;
  if (correct) t.correct++;
  else t.wrong.push({ word: e.word, zh: e.senses.map((s) => s.zh).filter(Boolean).join('；'), input: val, answer, kind: it.kind });

  const last = t.idx + 1 >= t.items.length;
  $main().innerHTML = `${banner}${detail}
    <div class="card"><div class="word-head"><span class="word-en">${esc(e.word)}</span>
      <button class="btn icon" id="yp-say2">🔊</button></div>
      <div class="pos">${esc(e.senses[0] ? e.senses[0].pos : '')}　${esc(e.senses.map((s) => s.zh).filter(Boolean).join('；'))}</div></div>
    <div class="btn-row"><button class="btn primary" id="yp-next">${last ? '看成績 →' : '下一題 →'}</button></div>`;
  document.getElementById('yp-say2').onclick = () => speak(e.word);
  document.getElementById('yp-next').onclick = () => { t.idx++; ypShow(); };
}

async function ypDone() {
  const t = YpTest; t.active = false;
  const total = t.items.length;
  const pct = total ? Math.round(t.correct / total * 100) : 0;
  const wrongRows = t.wrong.length
    ? t.wrong.map((w) => `<div class="row"><div class="row-main">
        <span class="row-word">${esc(w.word)}</span><span class="row-zh">${esc(w.zh)}</span></div>
      <div class="row-meta"><span>${w.kind === 'sentence' ? '造句' : '拼字'}</span>
        <span>你寫：${esc(w.input) || '(空白)'}</span></div></div>`).join('')
    : '<p class="hint-area">全部答對，太強了！🎉</p>';
  const wordN = Object.keys(t.results).length;
  $main().innerHTML = `
    <div class="card center">
      <h2>YP 測驗完成 🎉</h2>
      <p class="big">${pct} 分</p>
      <p>${t.correct} / ${total} 題答對</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" id="yp-sendcode">📤 傳完成碼給家長</button>
        <button class="btn" id="yp-back-unit">回單元</button>
      </div>
    </div>
    <div class="card"><h3>❌ 答錯的字（${t.wrong.length}）— 已回寫進度、排入複習</h3>
      <div class="detail-list">${wrongRows}</div></div>`;
  document.getElementById('yp-back-unit').onclick = () => { Yp.level = t.backLv; Yp.unit = t.backU; renderYp(); };
  document.getElementById('yp-sendcode').onclick = () => showYpCompletionCode(t.name, t.results, pct, t.correct, total);
}

// 測完 → 產生 YP 完成碼給家長（含 QR、可複製，附一行白話摘要）
function showYpCompletionCode(name, results, pct, correct, total) {
  const code = encodeYpCompletion(State.profile.id, results);
  const wordN = Object.keys(results).length;
  let spT = 0, spOk = 0, seT = 0, seOk = 0;
  for (const id in results) {
    const f = results[id];
    if (f & 1) { spT++; if (f & 2) spOk++; }
    if (f & 4) { seT++; if (f & 8) seOk++; }
  }
  const summary = `【YP 測驗】${esc(State.profile.name)}・${esc(name)}\n`
    + `做了 ${wordN} 字，得分 ${pct} 分（${correct}/${total}）\n`
    + (spT ? `拼字 ${spOk}/${spT}　` : '') + (seT ? `造句 ${seOk}/${seT}` : '') + '\n'
    + `YP完成碼（請貼到家長電腦「家長專區→輸入完成碼」）：\n${code}`;
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box center">
      <h3>📤 YP 完成碼</h3>
      <p class="hint-area">傳給家長貼進電腦「家長專區 → 輸入完成碼」，就會記錄 ${esc(State.profile.name)} 做過的 YP 字。</p>
      ${code.length <= 800 ? qrSvg(code) : '<p class="hint-area">字數較多，請用下方文字複製傳送。</p>'}
      <textarea class="answer-input code-box" readonly rows="5">${esc(summary)}</textarea>
      <div class="btn-row">
        <button class="btn primary" id="ypc-copy">複製完成碼</button>
        <button class="btn" id="ypc-close">關閉</button>
      </div>
    </div>`;
  m.classList.add('show');
  document.getElementById('ypc-copy').onclick = async () => {
    const ok = await copyToClipboard(summary);
    document.getElementById('ypc-copy').textContent = ok ? '✅ 已複製' : '請長按上方文字複製';
  };
  document.getElementById('ypc-close').onclick = () => m.classList.remove('show');
}

// YP 測驗類型追蹤（哪些字測過拼字/造句），供 S-3 進度用
async function getYpTested(pid) { return (await getMeta(`ypTested::${pid}`)) || {}; }
async function markYpTested(pid, id, kind) {
  const m = await getYpTested(pid);
  if (!m[id]) m[id] = {};
  m[id][kind] = true;
  await setMeta(`ypTested::${pid}`, m);
}

export { renderYp, Yp, loadBook, ensureBooksLoaded, recordIdOf, recordTarget, vocabMatch, getYpTested, encodeYpCompletion, decodeYpCompletion, extractYpCompletions };
