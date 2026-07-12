// mywords.js — 我的單字總表與自訂群組（自 app.js 原樣搬出，G1 拆分）

import { getRecord, getRecordsByProfile, putRecord } from './db.js';
import { addToReview, deleteCustomWord, fetchDict, updateCustomZh } from './lookup.js';
import { quizSingle } from './lookupui.js';
import { openScheduleModal } from './parent.js';
import { openTestTypePicker, startGroupTest } from './quizui.js';
import { displayCategory, forceMastered, newRecord, statusBadge } from './srs.js';
import { $main, State, refreshMastered, stageLegendHTML } from './state.js';
import { addWordsToTag, createTag, deleteTag, getTags, renameTag, setWordTags, tagCounts, tagsOfWord } from './tags.js';
import { esc, prettyDate, todayStr } from './util.js';
import { getById } from './vocab.js';
import { attachCardHandlers, cardHTML } from './wordcard.js';


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
          <option value="new">🌱 未測驗</option>
          <option value="weak">🌿 學習中</option>
          <option value="mastered">🌳 已熟記</option>
          <option value="proficient">🌲 穩固</option>
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
      ${stageLegendHTML()}
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

// 標記「我已會」：設為已熟記狀態（G4：一律經 srs.js 的正式入口，不手改欄位）
async function markKnown(entry) {
  let rec = await getRecord(State.profile.id, entry.id);
  if (!rec) rec = newRecord(State.profile.id, entry.id, entry.level);
  forceMastered(rec);
  await putRecord(rec);
}
export { renderGroups, openGroupPicker, MyWordsFilter, MyWordsSel, MyWordsView, renderMyWords, drawMyWords, openWordDetail, markKnown };
