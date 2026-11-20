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
      <img class="pc-img" style="display:block;width:100%;max-width:100%;height:auto" src="${esc(c.img)}" alt="${esc(e.word)} 記憶卡" loading="lazy" data-zoom="${esc(c.img)}" />
      <div class="pc-cap"><b>${esc(e.word)}</b>　${esc(e.zh)}<button class="btn" data-id="${esc(id)}">看單字卡 ›</button></div>
    </div>`;
  }).join('') : '<p class="hint-area">還沒有圖卡資料</p>';

  const weekDays = days.filter((d) => d.day >= 1 && d.day <= 7);

  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="pc-back">‹ 首頁</button><b>🖼️ 圖解記憶卡</b></div>
      <p class="hint-area">學測 Level 5–6 難字，用諧音或字根拆解畫成圖卡。一天 3 張；點圖片可全螢幕放大（雙指縮放、點兩下放大），長按圖片可以存到手機。</p>
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
  $main().querySelectorAll('.pc-cap .btn[data-id]').forEach((el) => {
    el.onclick = () => openWordDetail(el.dataset.id);
  });
  $main().querySelectorAll('[data-zoom]').forEach((el) => {
    el.onclick = () => openZoom(el.dataset.zoom);
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

// ---------- 全螢幕檢視：自動縮到符合螢幕，雙指縮放／拖曳／點兩下放大 ----------
// App 的 viewport 關閉了整頁縮放（避免作答時誤觸），所以圖卡的縮放在這個檢視器裡自己處理。
// 全部用 inline style，不依賴 styles.css（避免手機上舊版 CSS 快取造成跑版）。
function openZoom(src) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);touch-action:none;overflow:hidden;display:flex;align-items:center;justify-content:center';
  const img = document.createElement('img');
  img.src = src;
  img.alt = '圖解記憶卡';
  img.draggable = false;
  img.style.cssText = 'max-width:100vw;max-height:100vh;width:auto;height:auto;object-fit:contain;transform-origin:0 0;user-select:none;-webkit-user-select:none;will-change:transform';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', '關閉');
  close.style.cssText = 'position:fixed;top:max(12px, env(safe-area-inset-top));right:12px;z-index:10000;width:48px;height:48px;border-radius:24px;border:none;background:rgba(255,255,255,.9);font-size:24px;font-weight:700;color:#222';
  const hint = document.createElement('div');
  hint.textContent = '雙指縮放・點兩下放大／還原・拖曳移動';
  hint.style.cssText = 'position:fixed;bottom:max(16px, env(safe-area-inset-bottom));left:0;right:0;text-align:center;color:#ddd;font-size:14px;pointer-events:none';
  ov.append(img, close, hint);
  document.body.appendChild(ov);

  let scale = 1, tx = 0, ty = 0;
  const MIN = 1, MAX = 5;
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  // 以圖片左上角為原點計算；圖片置中後的原始位置
  const base = () => { const r = img.getBoundingClientRect(); return { x: r.left - tx, y: r.top - ty, w: r.width / scale, h: r.height / scale }; };
  const clamp = () => {
    const b = base();
    const W = window.innerWidth, H = window.innerHeight;
    const w = b.w * scale, h = b.h * scale;
    // 放大後不能拖到露出大片黑邊；比螢幕小時置中
    const minX = w > W ? W - w - b.x : (W - w) / 2 - b.x;
    const maxX = w > W ? -b.x : (W - w) / 2 - b.x;
    const minY = h > H ? H - h - b.y : (H - h) / 2 - b.y;
    const maxY = h > H ? -b.y : (H - h) / 2 - b.y;
    tx = Math.min(maxX, Math.max(minX, tx));
    ty = Math.min(maxY, Math.max(minY, ty));
  };
  // 以螢幕上某點 (cx,cy) 為中心縮放到 ns
  const zoomAt = (ns, cx, cy) => {
    ns = Math.min(MAX, Math.max(MIN, ns));
    const b = base();
    const px = (cx - b.x - tx) / scale, py = (cy - b.y - ty) / scale; // 該點在圖上的座標
    scale = ns;
    tx = cx - b.x - px * scale;
    ty = cy - b.y - py * scale;
    if (scale === 1) { tx = 0; ty = 0; }
    clamp(); apply();
  };

  const pts = new Map();
  let startDist = 0, startScale = 1, mid = null, last = null, moved = false, lastTap = 0;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const center = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

  ov.addEventListener('pointerdown', (e) => {
    if (e.target === close) return;
    try { ov.setPointerCapture(e.pointerId); } catch (err) { /* 部分瀏覽器不支援，忽略 */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pts.size === 2) { startDist = dist(); startScale = scale; mid = center(); }
    last = { x: e.clientX, y: e.clientY };
  });
  ov.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && startDist) {
      const c = center();
      tx += c.x - mid.x; ty += c.y - mid.y; mid = c;   // 雙指同時平移
      zoomAt(startScale * dist() / startDist, c.x, c.y);
      moved = true;
    } else if (pts.size === 1 && scale > 1) {
      tx += e.clientX - last.x; ty += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      clamp(); apply();
      moved = true;
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) startDist = 0;
    if (pts.size === 1) last = [...pts.values()][0];
    if (pts.size === 0 && !moved && e.type === 'pointerup') {
      const now = Date.now();
      if (now - lastTap < 300) { zoomAt(scale > 1 ? 1 : 2.5, e.clientX, e.clientY); lastTap = 0; }
      else lastTap = now;
    }
  };
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', up);
  // 電腦：滾輪縮放
  ov.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });

  const done = () => { ov.remove(); window.removeEventListener('popstate', onBack); };
  // Android 返回鍵關閉檢視器而不是離開頁面
  const onBack = () => done();
  history.pushState({ picZoom: true }, '');
  window.addEventListener('popstate', onBack);
  close.onclick = () => { history.back(); };
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
      img.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;margin-top:6px';
      img.src = b.dataset.pic;
      img.alt = '圖解記憶卡（點一下全螢幕放大）';
      img.onclick = () => openZoom(img.src);
      b.replaceWith(img);
    };
  });
}

export { loadPicCards, picCardOf, renderPicCards, picCardBlockHTML, attachPicHandlers, openZoom };
