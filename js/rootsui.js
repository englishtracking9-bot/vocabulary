// rootsui.js — 字根字首頁（自 app.js 原樣搬出，G1 拆分）

import { openWordDetail } from './app.js';
import { getRecordsByProfile } from './db.js';
import { allRoots, membersOfAffix } from './grouping.js';
import { addToReview, speak } from './lookup.js';
import { statusBadge } from './srs.js';
import { $main, State } from './state.js';
import { esc } from './util.js';
import { getById } from './vocab.js';


// ============================================================
// 字根（Phase 2 佔位）
// ============================================================
const RootsFilter = { type: 'all', q: '' };
const AFFIX_TYPE_LABEL = { prefix: '字首', root: '字根', suffix: '字尾' };

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
        <span class="row-word">${dash} <span class="rt-type">${AFFIX_TYPE_LABEL[r.type]}</span></span>
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
        <b>${dash}（${AFFIX_TYPE_LABEL[type]}）</b></div>
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
export { RootsFilter, AFFIX_TYPE_LABEL, renderRoots, drawRoots, openRootDetail };
