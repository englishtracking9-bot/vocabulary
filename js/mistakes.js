// mistakes.js — V：錯題本＋重考（各使用者獨立；資料存 meta mistakes::<pid>）
// 錯題由 quiz.js recordAnswer 自動收集；達「已熟記」自動畢業移出。

import { go } from './app.js';
import { getMeta, setMeta } from './db.js';
import { openWordDetail } from './mywords.js';
import { statusBadge } from './srs.js';
import { $main, State } from './state.js';
import { esc, prettyDate, todayStr } from './util.js';
import { getById } from './vocab.js';
import { openYpTypePicker, startYpTest } from './ypbook.js';

const MistakeFilter = { kind: 'all', level: 'all' };
const KIND_ZH = { spelling: '拼字', meaning: '看英文答中文', free: '自由作答', sentence: '造句', book: '單字本' };

async function getMistakes(pid) { return (await getMeta(`mistakes::${pid}`)) || {}; }

function matchLevel(wordId, m, f) {
  if (f === 'all') return true;
  if (f === 'yp') return String(wordId).startsWith('yp');
  if (f === '0') return (m.level === 0 || m.level == null) && !String(wordId).startsWith('yp');
  return String(m.level) === f;
}

async function renderMistakes() {
  const pid = State.profile.id;
  const book = await getMistakes(pid);
  let rows = Object.entries(book)
    .map(([wordId, m]) => ({ wordId, m, entry: getById(wordId) }))
    .filter((x) => x.entry);
  const total = rows.length;

  if (MistakeFilter.kind !== 'all') rows = rows.filter((x) => (x.m.kinds || {})[MistakeFilter.kind]);
  if (MistakeFilter.level !== 'all') rows = rows.filter((x) => matchLevel(x.wordId, x.m, MistakeFilter.level));
  rows.sort((a, b) => (b.m.lastWrong || 0) - (a.m.lastWrong || 0));

  const list = rows.length ? rows.map((x) => {
    const e = x.entry, m = x.m;
    const kinds = Object.keys(m.kinds || {}).map((k) => KIND_ZH[k] || k).join('、');
    return `<div class="row tap mk-row" data-id="${esc(x.wordId)}"><div class="row-main">
        <span class="row-word">${esc(e.word)}</span><span class="row-zh">${esc(e.zh || '')}</span></div>
      <div class="row-meta"><span>錯 ${m.count || 1} 次</span><span>${esc(kinds)}</span>
        ${m.lastKind ? `<span>上次(${esc(KIND_ZH[m.lastKind] || m.lastKind)}) 你寫：${esc(m.lastInput) || '(空白)'}</span>` : ''}</div>
      <div class="btn-row"><button class="btn sm" data-retest="${esc(x.wordId)}">▶️ 重測這個字</button></div></div>`;
  }).join('') : `<div class="card center">${total ? '這個篩選沒有錯題 🎉' : '目前沒有錯題，繼續加油！答錯的字會自動收進這裡。'}</div>`;

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="mk-back">‹ 測驗</button><b>❌ 錯題本（${total}）</b></div>
      <p class="hint-area">任何測驗答錯的字都會自動收進來。專攻不會的字最有效；答到「🌳 已熟記」就會自動畢業移出。</p>
      <div class="filters">
        <select id="mk-kind">
          <option value="all">全部題型</option>
          <option value="spelling">拼字</option>
          <option value="meaning">看英文答中文</option>
          <option value="free">自由作答</option>
          <option value="sentence">造句</option>
        </select>
        <select id="mk-level">
          <option value="all">全部範圍</option>
          ${[1, 2, 3, 4, 5, 6].map((l) => `<option value="${l}">Level ${l}</option>`).join('')}
          <option value="yp">YP 單字書</option>
          <option value="0">我查的字</option>
        </select>
      </div>
      <button class="btn primary big-copy" id="mk-retest" ${rows.length ? '' : 'disabled'}>▶️ ${MistakeFilter.kind === 'all' ? `重考錯題（隨機・${rows.length} 字）` : `重考「${KIND_ZH[MistakeFilter.kind]}」錯題（${rows.length} 字）`}</button>
      <p class="hint-area">上面「題型」選一種，就只重考那一類的錯字（用同一種題型出題）；選「全部題型」則可自選要考的題型。</p>
    </div>
    <div id="mk-list">${list}</div>`;

  document.getElementById('mk-back').onclick = () => go('#quiz');
  const kEl = document.getElementById('mk-kind'); const lEl = document.getElementById('mk-level');
  kEl.value = MistakeFilter.kind; lEl.value = MistakeFilter.level;
  kEl.onchange = () => { MistakeFilter.kind = kEl.value; renderMistakes(); };
  lEl.onchange = () => { MistakeFilter.level = lEl.value; renderMistakes(); };

  const retestBtn = document.getElementById('mk-retest');
  if (retestBtn) retestBtn.onclick = () => {
    const entries = rows.map((x) => x.entry);
    if (!entries.length) { alert('沒有可重考的字'); return; }
    if (MistakeFilter.kind !== 'all') {
      // 已篩到某題型 → 只重考這一類、直接用同一種題型出題（不用再選）
      startYpTest(entries, `${KIND_ZH[MistakeFilter.kind]}錯題 ${entries.length} 字`, [MistakeFilter.kind], 'mistakes');
    } else {
      openYpTypePicker(entries, `錯題 ${entries.length} 字`, 'mistakes');
    }
  };
  $main().querySelectorAll('[data-retest]').forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const e = getById(b.dataset.retest);
      if (e) openYpTypePicker([e], e.word, 'mistakes');
    };
  });
  $main().querySelectorAll('.mk-row[data-id]').forEach((row) => {
    row.onclick = () => openWordDetail(row.dataset.id);
  });
}

export { renderMistakes, MistakeFilter, getMistakes };
