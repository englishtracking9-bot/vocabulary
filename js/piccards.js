// piccards.js — 🖼️ 圖解記憶卡：每天 3 字的諧音／拆解記憶圖卡（資料：data/picture_cards.json）
// 只用「字的 id」對應 vocab.json，不依賴位置編號；不改 vocab.json、不直接寫學習紀錄。
// 排進日曆一律走既有 createManualGroup（與「手動出題」同一條路）。

import { go } from './app.js';
import { openWordDetail } from './mywords.js';
import { createManualGroup, openScheduleModal } from './parent.js';
import { $main } from './state.js';
import { esc, prettyDate, todayStr } from './util.js';
import { getById } from './vocab.js';

let _data = null;
let _day = null; // 目前選的天

async function loadPicCards() {
  if (_data) return _data;
  try {
    const res = await fetch('./data/picture_cards.json', { cache: 'no-cache' });
    _data = res.ok ? await res.json() : { days: [], cards: {} };
  } catch (e) {
    _data = { days: [], cards: {} };
  }
  // 只保留 vocab.json 裡真的有的字
  for (const d of _data.days || []) d.wordIds = (d.wordIds || []).filter((id) => getById(id));
  return _data;
}

function picCardOf(wordId) {
  return (_data && _data.cards && _data.cards[wordId]) || null;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function renderPicCards() {
  const data = await loadPicCards();
  const days = data.days || [];
  if (_day == null && days.length) _day = days[0].day;
  const cur = days.find((d) => d.day === _day) || days[0];

  const tabs = days.map((d) =>
    `<button class="pc-tab ${cur && d.day === cur.day ? 'on' : ''}" data-day="${d.day}">${esc(d.label)}</button>`).join('');

  const cards = cur ? cur.wordIds.map((id) => {
    const e = getById(id);
    const c = picCardOf(id);
    return `<div class="pc-item">
      <img class="pc-img" src="${esc(c.img)}" alt="${esc(e.word)} 記憶卡" loading="lazy" data-id="${esc(id)}" />
      <div class="pc-cap"><b>${esc(e.word)}</b>　${esc(e.zh)}<button class="btn" data-id="${esc(id)}">看單字卡 ›</button></div>
    </div>`;
  }).join('') : '<p class="hint-area">還沒有圖卡資料</p>';

  const weekDays = days.filter((d) => d.day >= 1 && d.day <= 7);

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="pc-back">‹ 首頁</button><b>🖼️ 圖解記憶卡</b></div>
      <p class="hint-area">學測 Level 5–6 難字，用諧音或字根拆解畫成圖卡。一天 3 張，點圖看單字卡；長按圖片可以存到手機。</p>
      <div class="pc-tabs">${tabs}</div>
    </div>
    <div class="pc-list">${cards}</div>
    <div class="card">
      <div class="btn-row">
        <button class="btn primary" id="pc-sched-day">📅 把這 ${cur ? cur.wordIds.length : 0} 個字排到某天</button>
      </div>
      ${weekDays.length ? `<div class="btn-row">
        <button class="btn" id="pc-sched-week">🗓 一次排好 ${weekDays.length} 天（每天 3 字）</button>
      </div>` : ''}
      <p class="hint-area">排進去後，當天的「今天要學」會多一組，照平常「先讀 → 拼字＋造句」練習。</p>
    </div>`;

  document.getElementById('pc-back').onclick = () => go('#home');
  $main().querySelectorAll('.pc-tab').forEach((b) => {
    b.onclick = () => { _day = Number(b.dataset.day); renderPicCards(); window.scrollTo(0, 0); };
  });
  $main().querySelectorAll('.pc-img[data-id], .pc-cap .btn[data-id]').forEach((el) => {
    el.onclick = () => openWordDetail(el.dataset.id);
  });
  const sd = document.getElementById('pc-sched-day');
  if (sd && cur) sd.onclick = () => openScheduleModal(cur.wordIds);
  const sw = document.getElementById('pc-sched-week');
  if (sw) sw.onclick = () => openWeekModal(weekDays);
}

// 一次排好一週：從選定的日期起，第 1 天、第 2 天…各排一組
function openWeekModal(weekDays) {
  const today = todayStr();
  const m = document.getElementById('modal');
  m.innerHTML = `
    <div class="modal-box">
      <h3>一次排好 ${weekDays.length} 天</h3>
      <p class="hint-area">從這天開始，每天排一組圖解記憶卡（每組 3 字）。</p>
      <label>從哪一天開始
        <input type="date" id="pw-date" class="answer-input" value="${today}" min="${today}" />
      </label>
      <div class="btn-row">
        <button class="btn primary" id="pw-ok">排進日曆</button>
        <button class="btn" id="pw-cancel">取消</button>
      </div>
    </div>`;
  m.classList.add('show');
  document.getElementById('pw-cancel').onclick = () => m.classList.remove('show');
  document.getElementById('pw-ok').onclick = async () => {
    const start = document.getElementById('pw-date').value;
    if (!start) { alert('請選日期'); return; }
    for (let i = 0; i < weekDays.length; i++) {
      await createManualGroup(addDays(start, i), `圖解記憶卡 ${weekDays[i].label}`, weekDays[i].wordIds);
    }
    m.classList.remove('show');
    alert(`✅ 已從 ${prettyDate(start)} 起排好 ${weekDays.length} 天`);
  };
}

// 單字卡裡的「看圖解記憶卡」區塊（收合，點開才載入圖片）
function picCardBlockHTML(entry) {
  const c = picCardOf(entry.id);
  if (!c) return '';
  return `<div class="pc-in-card">
    <button class="btn" data-pic="${esc(c.img)}">🖼️ 看圖解記憶卡（${esc(c.method)}）</button>
    <div class="pc-tip">${esc(c.tip)}</div>
  </div>`;
}

function attachPicHandlers() {
  document.querySelectorAll('[data-pic]').forEach((b) => {
    b.onclick = () => {
      const img = document.createElement('img');
      img.className = 'pc-img';
      img.src = b.dataset.pic;
      img.alt = '圖解記憶卡';
      b.replaceWith(img);
    };
  });
}

export { loadPicCards, picCardOf, renderPicCards, picCardBlockHTML, attachPicHandlers };
