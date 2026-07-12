// books.js — 自訂單字本與單字本測驗（自 app.js 原樣搬出，G1 拆分）

import { go } from './app.js';
import { dailyKey, deleteCustomBook, getCustomBook, getCustomBooksByProfile, getDailyLog, putCustomBook, putDailyLog } from './db.js';
import { createCustomWord } from './lookup.js';
import { recordAnswer } from './quiz.js';
import { testWrongRow } from './quizui.js';
import { $main, State, refreshMastered } from './state.js';
import { previousResult, saveTestResult } from './tests.js';
import { esc, prettyDate, shuffle, todayStr } from './util.js';


// ============================================================
// L-2 自訂單字本：自由輸入的單字本（片語／成語／講義），可轉測驗
// 與「群組」不同：群組是把 6000 字貼標籤；單字本＝完全自己打的內容。
// ============================================================
function cbNewId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

async function renderCustomBooks() {
  const books = await getCustomBooksByProfile(State.profile.id);
  const list = books.sort((a, b) => b.updatedAt - a.updatedAt).map((bk) => `
    <div class="card cb-card">
      <div class="grp-head"><b>📓 ${esc(bk.name)}</b><span class="row-meta">${bk.entries.length} 條</span></div>
      <div class="btn-row">
        <button class="btn primary" data-act="test" data-id="${bk.id}" ${bk.entries.length ? '' : 'disabled'}>▶️ 轉測驗</button>
        <button class="btn" data-act="edit" data-id="${bk.id}">✏️ 編輯</button>
        <button class="btn danger" data-act="del" data-id="${bk.id}">🗑 刪除</button>
      </div>
    </div>`).join('');

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="cb-back">‹ 更多</button><b>📓 自訂單字本</b></div>
      <p class="hint-area">完全自己打內容的單字本（片語、成語、講義自己出）。和「群組」不同：群組是幫 6000 字貼標籤，單字本是自己打題目與答案。</p>
      <div class="btn-row">
        <input id="cb-new" class="answer-input" placeholder="新單字本名稱（如：二段考片語）" />
        <button class="btn primary" id="cb-add">＋ 新增</button>
      </div>
    </div>
    <div id="cb-list">${books.length ? list : '<div class="card center">還沒有單字本，先新增一個吧</div>'}</div>`;

  document.getElementById('cb-back').onclick = () => go('#more');
  document.getElementById('cb-add').onclick = async () => {
    const name = document.getElementById('cb-new').value.trim();
    if (!name) return;
    const book = { id: cbNewId('book'), profileId: State.profile.id, name, createdAt: Date.now(), updatedAt: Date.now(), entries: [] };
    await putCustomBook(book);
    openBookEditor(book.id);
  };
  document.querySelectorAll('#cb-list [data-act]').forEach((b) => {
    b.onclick = async () => {
      const bk = books.find((x) => x.id === b.dataset.id);
      if (!bk) return;
      if (b.dataset.act === 'edit') return openBookEditor(bk.id);
      if (b.dataset.act === 'test') return openBookTestSetup(bk);
      if (b.dataset.act === 'del') {
        if (!confirm(`刪除單字本「${bk.name}」？（本內全部條目一起刪除，此動作無法復原）`)) return;
        await deleteCustomBook(bk.id);
        renderCustomBooks();
      }
    };
  });
}

// 單字本編輯器：新增／編輯／刪除條目、批次匯入
async function openBookEditor(bookId) {
  const book = await getCustomBook(bookId);
  if (!book) return renderCustomBooks();
  const rows = book.entries.map((en, i) => `
    <div class="row cb-entry" data-eid="${en.id}">
      <div class="row-main">
        <span class="row-word">${esc(en.prompt)}</span>
        <span class="row-zh">${esc(en.answer)}</span>
      </div>
      ${en.example ? `<div class="row-meta"><span>${esc(en.example)}</span></div>` : ''}
      <div class="btn-row">
        <button class="btn sm" data-eact="edit" data-eid="${en.id}">改</button>
        <button class="btn sm danger" data-eact="del" data-eid="${en.id}">刪</button>
      </div>
    </div>`).join('');

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="be-back">‹ 單字本</button><b>📓 ${esc(book.name)}</b></div>
      <p class="hint-area">每條：題面（中文／詞語／提示）＋ 答案（英文／注釋）＋ 可選例句。測驗時可選方向。</p>
      <div class="cb-form">
        <input id="be-prompt" class="answer-input" placeholder="題面（如：放棄 / give ___ ）" />
        <input id="be-answer" class="answer-input" placeholder="答案（如：give up；多個可用 / 分隔）" />
        <input id="be-example" class="answer-input" placeholder="例句（可留空）" />
        <button class="btn primary" id="be-save">＋ 加入這條</button>
      </div>
    </div>
    <div class="card">
      <details><summary>📥 批次匯入（貼「中文,英文」每行一組）</summary>
        <textarea id="be-bulk" class="answer-input" rows="4" placeholder="放棄,give up&#10;實現,come true&#10;（第三欄可放例句：中文,英文,例句）"></textarea>
        <button class="btn" id="be-import">匯入</button>
        <p id="be-imp-status" class="hint-area"></p>
      </details>
    </div>
    <div class="card">
      <div class="grp-head"><b>條目（${book.entries.length}）</b>
        <button class="btn primary" id="be-test" ${book.entries.length ? '' : 'disabled'}>▶️ 轉測驗</button></div>
      <div id="be-list">${book.entries.length ? rows : '<p class="hint-area">還沒有條目，用上方表單或批次匯入新增。</p>'}</div>
    </div>`;

  document.getElementById('be-back').onclick = () => renderCustomBooks();
  document.getElementById('be-test').onclick = () => openBookTestSetup(book);
  document.getElementById('be-save').onclick = async () => {
    const prompt = document.getElementById('be-prompt').value.trim();
    const answer = document.getElementById('be-answer').value.trim();
    const example = document.getElementById('be-example').value.trim();
    if (!prompt || !answer) { alert('題面與答案都要填'); return; }
    book.entries.push({ id: cbNewId('e'), prompt, answer, example });
    book.updatedAt = Date.now();
    await putCustomBook(book);
    openBookEditor(bookId);
  };
  document.getElementById('be-import').onclick = async () => {
    const raw = document.getElementById('be-bulk').value;
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const parts = line.split(/[,，\t]/).map((x) => x.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        book.entries.push({ id: cbNewId('e'), prompt: parts[0], answer: parts[1], example: parts[2] || '' });
        added++;
      }
    }
    if (added) { book.updatedAt = Date.now(); await putCustomBook(book); }
    document.getElementById('be-imp-status').textContent = `✅ 匯入 ${added} 條${lines.length - added ? `（${lines.length - added} 行格式不符已略過）` : ''}`;
    if (added) setTimeout(() => openBookEditor(bookId), 700);
  };
  document.querySelectorAll('#be-list [data-eact]').forEach((b) => {
    b.onclick = async () => {
      const en = book.entries.find((x) => x.id === b.dataset.eid);
      if (!en) return;
      if (b.dataset.eact === 'del') {
        book.entries = book.entries.filter((x) => x.id !== en.id);
        book.updatedAt = Date.now();
        await putCustomBook(book);
        return openBookEditor(bookId);
      }
      // 編輯：填回表單
      document.getElementById('be-prompt').value = en.prompt;
      document.getElementById('be-answer').value = en.answer;
      document.getElementById('be-example').value = en.example || '';
      book.entries = book.entries.filter((x) => x.id !== en.id);
      book.updatedAt = Date.now();
      await putCustomBook(book);
      openBookEditor(bookId);
      document.getElementById('be-prompt').value = en.prompt;
      document.getElementById('be-answer').value = en.answer;
      document.getElementById('be-example').value = en.example || '';
    };
  });
}

// ---- 單字本測驗（單次計分、可選方向、可選套 SM-2） ----
const CBRun = { active: false, book: null, dir: 'zh2en', useSrs: false, items: [], idx: 0, correct: 0, wrong: [], answered: false };

// 寬鬆比對：去頭尾空白、壓縮空白、去 ASCII 標點、忽略大小寫；答案可用 / , ; 分隔多個可接受寫法
function cbNorm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:'"()\-]/g, '');
}
function cbMatch(input, expected) {
  const norm = cbNorm(input);
  if (!norm) return false;
  return String(expected).split(/[\/,;；、]/).map(cbNorm).filter(Boolean).includes(norm);
}

function openBookTestSetup(book) {
  if (!book.entries.length) { alert('這個單字本還沒有條目'); return; }
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>▶️ ${esc(book.name)} 轉測驗</h3>
      <label class="ts-row">作答方向
        <select id="cb-dir" class="answer-input">
          <option value="zh2en">看題面 → 寫答案（中文→背英文）</option>
          <option value="en2zh">看答案 → 寫題面（英文→答注釋）</option>
        </select>
      </label>
      <label class="ts-row ts-check"><input type="checkbox" id="cb-srs" /> 套用間隔重複複習（僅「中文→英文」，會把這些字加入每日複習與我的單字）</label>
      <p class="hint-area">共 ${book.entries.length} 條，全部考一遍。答錯會列出正解。</p>
      <div class="btn-row">
        <button class="btn primary" id="cb-start">開始測驗</button>
        <button class="btn" id="cb-cancel">取消</button>
      </div>
    </div>`;
  m.classList.add('show');
  document.getElementById('cb-cancel').onclick = () => m.classList.remove('show');
  document.getElementById('cb-start').onclick = () => {
    const dir = document.getElementById('cb-dir').value;
    const useSrs = document.getElementById('cb-srs').checked && dir === 'zh2en';
    m.classList.remove('show');
    Object.assign(CBRun, {
      active: true, book, dir, useSrs,
      items: shuffle(book.entries.slice()), idx: 0, correct: 0, wrong: [], answered: false,
    });
    cbShow();
  };
}


function cbShow() {
  const t = CBRun;
  if (t.idx >= t.items.length) return cbDone();
  t.answered = false;
  const en = t.items[t.idx];
  const question = t.dir === 'zh2en' ? en.prompt : en.answer;
  $main().innerHTML = `
    <div class="quiz-progress"><span>📓 ${esc(t.book.name)}</span><span>第 ${t.idx + 1} / ${t.items.length} 題</span></div>
    <div class="card quiz-card">
      <div class="zh-prompt">${esc(question)}</div>
      <div class="pos">${t.dir === 'zh2en' ? '寫出答案' : '寫出題面'}</div>
      <input id="cb-ans" class="answer-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="輸入你的答案…" />
      <div class="btn-row"><button class="btn primary" id="cb-submit">送出</button></div>
      <button class="btn save-exit" id="cb-quit">✕ 結束測驗</button>
    </div>`;
  const input = document.getElementById('cb-ans');
  input.focus();
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') cbTestSubmit(); });
  document.getElementById('cb-submit').onclick = cbTestSubmit;
  document.getElementById('cb-quit').onclick = () => {
    if (!confirm('結束這次測驗？（已作答的仍計入統計，但不會計分存檔）')) return;
    CBRun.active = false; renderCustomBooks();
  };
}

async function cbTestSubmit() {
  const t = CBRun;
  if (t.answered) return;
  const input = document.getElementById('cb-ans');
  const val = input.value;
  if (!val.trim()) { input.focus(); return; }
  t.answered = true;
  const en = t.items[t.idx];
  const expected = t.dir === 'zh2en' ? en.answer : en.prompt;
  const question = t.dir === 'zh2en' ? en.prompt : en.answer;
  const correct = cbMatch(val, expected);

  if (t.useSrs) {
    // 中文→英文：註冊成自訂單字並走 SM-2（recordAnswer 內含每日紀錄）
    try {
      const { entry } = await createCustomWord(State.profile, en.answer, { zh: en.prompt });
      await recordAnswer(State.profile, entry, correct, false, false, Date.now(),
        { input: val, answer: en.answer, kind: 'spelling' });
      await refreshMastered();
    } catch (e) { await cbLogAnswer(correct); }
  } else {
    await cbLogAnswer(correct);
  }

  if (correct) t.correct++;
  else t.wrong.push({ word: question, zh: '', input: val, answer: expected, kind: 'book' });

  const banner = correct ? `<div class="result ok">✅ 答對了！</div>`
    : `<div class="result no">❌ 答錯，你寫「${esc(val) || '(空白)'}」，正解：<b>${esc(expected)}</b></div>`;
  const exLine = en.example ? `<div class="card"><div class="sent-line">${esc(en.example)}</div></div>` : '';
  $main().innerHTML = `${banner}${exLine}
    <div class="btn-row"><button class="btn primary" id="cb-next">${t.idx + 1 >= t.items.length ? '看成績 →' : '下一題 →'}</button></div>`;
  document.getElementById('cb-next').onclick = () => { t.idx++; cbShow(); };
}

// 把一次作答計入當天每日紀錄（不套 SM-2 時使用；套 SM-2 時由 recordAnswer 負責）
async function cbLogAnswer(correct) {
  const date = todayStr();
  let log = await getDailyLog(State.profile.id, date);
  if (!log) log = { key: dailyKey(State.profile.id, date), profileId: State.profile.id, date, newWords: [], reviewCount: 0, answerCount: 0, correctCount: 0, reviewWords: [], wrong: [] };
  log.answerCount = (log.answerCount || 0) + 1;
  if (correct) log.correctCount = (log.correctCount || 0) + 1;
  await putDailyLog(log);
}

async function cbDone() {
  const t = CBRun;
  t.active = false;
  const total = t.items.length;
  const result = await saveTestResult({
    profileId: State.profile.id, type: 'book', name: t.book.name,
    total, correct: t.correct, wrong: t.wrong,
  });
  const prev = await previousResult(State.profile.id, 'book', result.id, t.book.name);
  let cmp = '<p class="hint-area">這本單字本的第一次紀錄，加油！📓</p>';
  if (prev) {
    const d = result.scorePct - prev.scorePct;
    const arrow = d > 0 ? `📈 進步 ${d} 分` : d < 0 ? `📉 退步 ${-d} 分` : '➖ 與上次持平';
    cmp = `<p class="hint-area">上次（${prettyDate(prev.date)}）：${prev.scorePct} 分　→　這次 ${result.scorePct} 分　<b>${arrow}</b></p>`;
  }
  const wrongRows = result.wrong.length ? result.wrong.map((w) => testWrongRow(w)).join('') : '<p class="hint-area">全部答對，太強了！🎉</p>';
  $main().innerHTML = `
    <div class="card center">
      <h2>📓 ${esc(t.book.name)} 完成 🎉</h2>
      <p class="big">${result.scorePct} 分</p>
      <p>${result.correct} / ${total} 題答對</p>
      ${t.useSrs ? '<p class="hint-area">已套用間隔重複：這些字進了「我的單字」與每日複習。</p>' : ''}
      ${cmp}
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" id="cb-retest">再測一次</button>
        <button class="btn" id="cb-back2">回單字本</button>
      </div>
    </div>
    <div class="card"><h3>❌ 答錯的（${result.wrong.length}）</h3><div class="detail-list">${wrongRows}</div></div>`;
  document.getElementById('cb-retest').onclick = () => openBookTestSetup(t.book);
  document.getElementById('cb-back2').onclick = () => renderCustomBooks();
}
export { cbNewId, renderCustomBooks, openBookEditor, CBRun, cbNorm, cbMatch, openBookTestSetup, cbShow, cbTestSubmit, cbLogAnswer, cbDone };
