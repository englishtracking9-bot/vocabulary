// lookupui.js — 查單字頁（自 app.js 原樣搬出，G1 拆分）

import { go, route } from './app.js';
import { deleteRecord } from './db.js';
import { addToReview, createCustomWord, deleteCustomWord, lookupWord, updateCustomZh } from './lookup.js';
import { openGroupPicker } from './mywords.js';
import { Session } from './quiz.js';
import { showQuestion } from './quizui.js';
import { displayCategory, statusBadge } from './srs.js';
import { $main, State, refreshMastered } from './state.js';
import { esc } from './util.js';
import { attachCardHandlers, cardHTML } from './wordcard.js';


// 點任意文字中的單字 → 導到「查單字」並自動查詢（完全複用查單字流程）
let PendingLookup = null;
function lookupTermNavigate(term) {
  if (!term) return;
  PendingLookup = term;
  const modal = document.getElementById('modal');
  if (modal) modal.classList.remove('show'); // 若從單字卡 modal 點出，先關閉
  if (location.hash === '#lookup') route(); else location.hash = '#lookup';
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
  const isMastered = cat === 'mastered' || cat === 'proficient';
  let banner;
  if (justCreated) {
    banner = `<div class="result ok">✅ 已加入「我查的字」清單${entry.zh ? '' : '（記得補上中文意思）'}</div>`;
  } else if (autoAdded) {
    banner = `<div class="result ok">✅ 已自動加入待學清單</div>`;
  } else if (isMastered) {
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
        ${isMastered
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
  State.quizMode = 'active';
  State.session = new Session([{ wordId: entry.id, level: entry.level, kind: 'review' }]);
  location.hash = '#quiz';
  if (location.hash === '#quiz') route(); else showQuestion();
}
export { PendingLookup, lookupTermNavigate, renderLookup, doLookup, renderNotFound, renderEntryResult, doLookupTerm, quizSingle };
