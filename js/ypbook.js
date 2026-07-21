// ypbook.js — YP 單字書：完全獨立專區（S-1 瀏覽；S-2/S-3 測驗與進度另接）
// 資料來源 data/books.json（build_books.py 產出），與 6000 字庫分開；
// 但同一個字（拼字相符）共用同一筆 SM-2 記錄 → 不用背兩次。

import { go } from './app.js';
import { getMeta, getRecordsByProfile, setMeta } from './db.js';
import { speak } from './lookup.js';
import { statusBadge } from './srs.js';
import { $main, State } from './state.js';
import { esc } from './util.js';
import { findByWord } from './vocab.js';

let _book = null;                 // books.json（載入一次）
const Yp = { level: null, unit: null }; // 導覽狀態：null=在上一層

async function loadBook() {
  if (_book) return _book;
  const res = await fetch('./data/books.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('無法載入 books.json：' + res.status);
  _book = await res.json();
  return _book;
}

// YP 字對應到 6000 的記錄 id（拼字相符就共用，否則用自己的 yp-id）
function vocabMatch(entry) { return findByWord(entry.word) || null; }
function recordIdOf(entry) { const m = vocabMatch(entry); return m ? m.id : entry.id; }

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
    </div>
    <div class="home-sec"><div class="block-grid yp-grid">${tiles || '<p class="hint-area">還沒有資料</p>'}</div></div>`;
  document.getElementById('yp-home').onclick = () => go('#home');
  $main().querySelectorAll('.yp-tile[data-level]').forEach((b) => {
    b.onclick = () => { Yp.level = +b.dataset.level; Yp.unit = null; renderYp(); };
  });
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
    <div class="card"><div class="detail-list">${rows}</div></div>`;
  document.getElementById('yp-back').onclick = () => { Yp.level = null; renderYp(); };
  $main().querySelectorAll('.yp-unit[data-unit]').forEach((b) => {
    b.onclick = () => { Yp.unit = +b.dataset.unit; renderYp(); };
  });
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
  const recs = await getRecordsByProfile(State.profile.id);
  const recMap = new Map(recs.map((r) => [r.wordId, r]));
  const read = await getReadSet(State.profile.id);

  const cardHTML = (e) => {
    const isRead = read.has(e.id);
    const rec = recMap.get(recordIdOf(e));
    const tested = rec && rec.attempts > 0;
    const readBadge = `<span class="yp-badge ${isRead ? 'on' : ''}">${isRead ? '✅ 讀過' : '未讀'}</span>`;
    const testBadge = tested ? statusBadge(rec.status) : '<span class="yp-badge">未測</span>';
    const senses = e.senses.map((s) => `
      <div class="yp-sense">
        <div class="pos">${esc(s.pos)}${s.pos && s.zh ? '　' : ''}${esc(s.zh)}</div>
        ${s.example ? `<div class="examples"><div class="ex-en">${esc(s.example)}
          <button class="btn icon sm" data-say="${esc(s.example)}">🔊</button></div>
          ${s.example_zh ? `<div class="ex-zh">${esc(s.example_zh)}</div>` : ''}</div>` : ''}
      </div>`).join('');
    return `<div class="read-card yp-card" data-id="${esc(e.id)}">
        <div class="word-head">
          <span class="word-en">${esc(e.word)}</span>
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
      <div class="memo">💡 點一張卡片＝標記「讀過」；🔊 聽發音。之後在「YP 測驗」可考這個單元。</div>
      <div class="btn-row">
        <button class="btn" id="yp-readall">✅ 全部標為讀過</button>
      </div>
    </div>
    ${u.entries.map(cardHTML).join('')}`;

  document.getElementById('yp-back').onclick = () => { Yp.unit = null; renderYp(); };
  // 🔊 發音（不觸發「讀過」）
  $main().querySelectorAll('[data-say]').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); speak(b.dataset.say); };
  });
  // 點卡片 → 標記讀過
  $main().querySelectorAll('.yp-card[data-id]').forEach((card) => {
    card.onclick = async () => {
      const set = await getReadSet(State.profile.id);
      if (!set.has(card.dataset.id)) {
        set.add(card.dataset.id);
        await saveReadSet(State.profile.id, set);
        const badge = card.querySelector('.yp-badge');
        if (badge) { badge.textContent = '✅ 讀過'; badge.classList.add('on'); }
      }
    };
  });
  document.getElementById('yp-readall').onclick = async () => {
    const set = await getReadSet(State.profile.id);
    u.entries.forEach((e) => set.add(e.id));
    await saveReadSet(State.profile.id, set);
    renderWords(lv, u);
  };
}

export { renderYp, Yp, loadBook, recordIdOf, vocabMatch };
