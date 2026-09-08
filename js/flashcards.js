// flashcards.js — 🎴 閃卡記憶（被動瀏覽、混臉熟；完全不碰 SM-2／熟練度／排程）
// 任何「能選一批字」的地方都可帶一批 entries 進來看。

import { go } from './app.js';
import { getMeta, setMeta } from './db.js';
import { speak } from './lookup.js';
import { $main } from './state.js';
import { esc, shuffle } from './util.js';
import { findByWord } from './vocab.js';

const Flash = { cards: [], order: [], pos: 0, playing: false, timer: null, backTo: '#home', title: '', started: false };
const DEFAULT_OPTS = { secs: 3, random: false, showExample: true, readExample: false, showRoot: true };
let _opts = null;
async function loadOpts() { _opts = { ...DEFAULT_OPTS, ...((await getMeta('flashOpts')) || {}) }; return _opts; }
async function saveOpts() { await setMeta('flashOpts', _opts); }

// 把各種來源的 entry 正規化成一張卡（YP books 條目走 senses；6000/我查的走頂層欄位）
function normCard(entry) {
  if (entry.senses && (entry.pos == null || entry.zh == null)) {
    const pos = [...new Set(entry.senses.map((s) => s.pos).filter(Boolean))].join(' / ');
    const zh = entry.senses.map((s) => s.zh).filter(Boolean).join('；');
    const ex = entry.senses.find((s) => s.example) || {};
    const m = findByWord(entry.word);
    return { word: entry.word, pos, zh, example: ex.example || '', example_zh: ex.example_zh || '', root: (m && m.root) || entry.root || null };
  }
  return { word: entry.word, pos: entry.pos || '', zh: entry.zh || '', example: entry.example || '', example_zh: entry.example_zh || '', root: entry.root || null };
}

// 外部入口：帶一批 entries 進閃卡（backTo＝回哪個 hash；title＝進度列標題）
function startFlashcards(entries, backTo, title) {
  const cards = (entries || []).map(normCard).filter((c) => c.word);
  if (!cards.length) { alert('沒有可看的字'); return; }
  stopTimer();
  Object.assign(Flash, { cards, backTo: backTo || '#home', title: title || '閃卡', started: false, pos: 0, playing: false });
  if (location.hash !== '#flash') location.hash = '#flash'; else renderFlash();
}

function stopTimer() { if (Flash.timer) { clearTimeout(Flash.timer); Flash.timer = null; } }

async function renderFlash() {
  if (!Flash.cards.length) {
    $main().innerHTML = `<div class="card center"><p>沒有字可看</p><button class="btn" id="fl-back">‹ 返回</button></div>`;
    document.getElementById('fl-back').onclick = () => go('#home');
    return;
  }
  await loadOpts();
  if (!Flash.started) return renderFlashSetup();
  if (Flash.pos >= Flash.order.length) return renderFlashDone();
  renderFlashCard();
}

function renderFlashSetup() {
  const o = _opts;
  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="fl-back">‹ 返回</button><b>🎴 閃卡記憶（${Flash.cards.length} 字）</b></div>
      <p class="hint-area">被動瀏覽、混臉熟——只看不考，<b>完全不影響熟練度</b>。</p>
      <div>每張秒數（自動播放）：</div>
      <div class="btn-row fl-secs">${[2, 3, 5, 8].map((s) => `<button class="btn ${o.secs === s ? 'primary' : ''}" data-secs="${s}">${s} 秒</button>`).join('')}</div>
      <div class="src-opts">
        <label class="chk"><input type="checkbox" id="fl-random" ${o.random ? 'checked' : ''}/> 隨機順序（考前掃很好用）</label>
        <label class="chk"><input type="checkbox" id="fl-showex" ${o.showExample ? 'checked' : ''}/> 顯示英文例句＋中文翻譯</label>
        <label class="chk"><input type="checkbox" id="fl-readex" ${o.readExample ? 'checked' : ''}/> 連英文例句也朗讀</label>
        <label class="chk"><input type="checkbox" id="fl-showroot" ${o.showRoot ? 'checked' : ''}/> 顯示字根拆解（有資料才顯示）</label>
      </div>
      <button class="btn primary big-copy" id="fl-start">▶️ 開始閃卡</button>
    </div>`;
  document.getElementById('fl-back').onclick = () => go(Flash.backTo);
  $main().querySelectorAll('[data-secs]').forEach((b) => { b.onclick = async () => { _opts.secs = +b.dataset.secs; await saveOpts(); renderFlashSetup(); }; });
  const bind = (id, key) => { document.getElementById(id).onchange = async (e) => { _opts[key] = e.target.checked; await saveOpts(); }; };
  bind('fl-random', 'random'); bind('fl-showex', 'showExample'); bind('fl-readex', 'readExample'); bind('fl-showroot', 'showRoot');
  document.getElementById('fl-start').onclick = () => {
    Flash.order = _opts.random ? shuffle(Flash.cards.map((_, i) => i)) : Flash.cards.map((_, i) => i);
    Flash.pos = 0; Flash.started = true; Flash.playing = true;
    renderFlashCard();
  };
}

function rootHTML(c) {
  if (!_opts.showRoot) return '';
  if (Array.isArray(c.root) && c.root.length) { const seg = c.root.map((p) => `<b>${esc(p.part)}</b>(${esc(p.mean)})`).join(' + '); return `<div class="root">🔧 字根：${seg}</div>`; }
  if (typeof c.root === 'string' && c.root) return `<div class="root">🔧 字根：${esc(c.root)}</div>`;
  return '';
}

function renderFlashCard() {
  stopTimer();
  const c = Flash.cards[Flash.order[Flash.pos]];
  const n = Flash.order.length;
  $main().innerHTML = `
    <div class="quiz-progress"><span>🎴 ${esc(Flash.title)}</span><span>第 ${Flash.pos + 1} / ${n} 張</span><span>${Flash.playing ? '▶️ 自動' : '⏸ 暫停'}</span></div>
    <div class="card flash-card">
      <div class="word-head center-word"><span class="word-en fl-word">${esc(c.word)}</span><button class="btn icon" id="fl-say">🔊</button></div>
      <div class="pos">${esc(c.pos)}</div>
      <div class="fl-zh">${esc(c.zh) || '（無中文）'}</div>
      ${_opts.showExample && c.example ? `<div class="examples"><div class="ex-en">${esc(c.example)}</div>${c.example_zh ? `<div class="ex-zh">${esc(c.example_zh)}</div>` : ''}</div>` : ''}
      ${rootHTML(c)}
    </div>
    <div class="btn-row fl-ctrl">
      <button class="btn" id="fl-prev">‹ 上一張</button>
      <button class="btn primary" id="fl-play">${Flash.playing ? '⏸ 暫停' : '▶️ 自動'}</button>
      <button class="btn" id="fl-next">下一張 ›</button>
    </div>
    <button class="btn" id="fl-end">結束閃卡</button>`;
  document.getElementById('fl-say').onclick = () => sayCard(c);
  document.getElementById('fl-prev').onclick = () => manualNav(-1);
  document.getElementById('fl-next').onclick = () => manualNav(1);
  document.getElementById('fl-play').onclick = () => { Flash.playing = !Flash.playing; renderFlashCard(); };
  document.getElementById('fl-end').onclick = () => { stopTimer(); Flash.started = false; go(Flash.backTo); };
  sayCard(c);
  if (Flash.playing) {
    Flash.timer = setTimeout(() => {
      if (location.hash !== '#flash') { stopTimer(); return; } // 已離開閃卡頁 → 不要在背景亂改畫面
      advance(1);
    }, (_opts.secs || 3) * 1000);
  }
}

function sayCard(c) {
  const text = (_opts.readExample && c.example) ? `${c.word}. ${c.example}` : c.word;
  try { speak(text); } catch (e) { /* 忽略 */ }
}

function manualNav(dir) { stopTimer(); advance(dir); }
function advance(dir) {
  const next = Flash.pos + dir;
  if (next >= Flash.order.length) { Flash.pos = Flash.order.length; return renderFlashDone(); }
  Flash.pos = next < 0 ? 0 : next;
  renderFlashCard();
}

function renderFlashDone() {
  stopTimer();
  $main().innerHTML = `
    <div class="card center">
      <h2>看完了 🎉</h2>
      <p class="big">已看完 ${Flash.order.length} 張</p>
      <p class="hint-area">閃卡只是瀏覽，沒有動到任何熟練度。</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" id="fl-again">🔁 再看一輪</button>
        <button class="btn" id="fl-back2">回上一頁</button>
      </div>
    </div>`;
  document.getElementById('fl-again').onclick = () => {
    Flash.order = _opts.random ? shuffle(Flash.cards.map((_, i) => i)) : Flash.cards.map((_, i) => i);
    Flash.pos = 0; Flash.playing = true; renderFlashCard();
  };
  document.getElementById('fl-back2').onclick = () => { Flash.started = false; go(Flash.backTo); };
}

export { renderFlash, startFlashcards, Flash };
