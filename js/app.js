// app.js — 入口：啟動、路由、身分切換、SW 註冊（G1 拆分後的常駐核心）
import { renderCustomBooks } from './books.js';
import { renderCalendar } from './daily.js';
import { getAllProfiles, getMeta, getProfile, openDB, putProfile, setMeta } from './db.js';
import { loadGroupsIndex, loadRoots } from './grouping.js';
import { renderHome } from './home.js';
import { renderLookup } from './lookupui.js';
import { renderMore, renderSettings } from './more.js';
import { renderGroups, renderMyWords } from './mywords.js';
import { scheduleForegroundReminder, syncReminderMeta } from './notify.js';
import { renderManualBuilder, renderParentZone } from './parent.js';
import { renderQuiz } from './quizui.js';
import { renderReport, resetReportDate } from './reportui.js';
import { renderRoots } from './rootsui.js';
import { renderScan } from './scan.js';
import { $main, DEFAULT_PROFILES, State, refreshMastered } from './state.js';
import { esc } from './util.js';
import { loadVocab, registerCustomWord } from './vocab.js';


// ---------- 啟動 ----------
async function init() {
  try {
    await openDB();
    await loadVocab();
    await loadGroupsIndex();
    await loadRoots();
    await loadCustomWords();
    await ensureProfiles();

    const activeId = (await getMeta('activeProfile')) || DEFAULT_PROFILES[0].id;
    State.profile = (await getProfile(activeId)) || (await getProfile(DEFAULT_PROFILES[0].id));
    await refreshMastered();

    renderHeader();
    window.addEventListener('hashchange', route);
    // 導覽列：即使 hash 沒變也要重繪（例如在日曆子頁點「日曆」要回到月曆）
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.addEventListener('click', () => go(b.dataset.route));
    });
    if (!location.hash) location.hash = '#home';
    route();

    registerServiceWorker();
    // 每日提醒：同步設定到 meta 供 SW 背景讀取，並在前景排程
    syncReminderMeta(State.profile);
    scheduleForegroundReminder(State.profile);
  } catch (e) {
    console.error(e);
    $main().innerHTML = `<div class="card"><p>⚠️ 啟動失敗：${esc(e.message)}</p>
      <p>請確認 data/vocab.json 已產生（執行 scripts/build_vocab.py）。</p></div>`;
  }
}

async function ensureProfiles() {
  const existing = await getAllProfiles();
  if (!existing.length) {
    for (const p of DEFAULT_PROFILES) await putProfile(p);
  }
}

async function loadCustomWords() {
  const custom = (await getMeta('customWords')) || [];
  for (const e of custom) registerCustomWord(e);
}

// ---------- 身分切換 ----------
function renderHeader() {
  const el = document.getElementById('profile-switch');
  el.innerHTML = '';
  // 取得身分清單後渲染按鈕
  getAllProfiles().then((profiles) => {
    el.innerHTML = profiles.map((p) =>
      `<button class="pf-btn ${p.id === State.profile.id ? 'active' : ''}" data-pid="${p.id}">${esc(p.name)}</button>`
    ).join('');
    el.querySelectorAll('.pf-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        State.profile = await getProfile(b.dataset.pid);
        await setMeta('activeProfile', State.profile.id);
        State.session = null;
        resetReportDate(); // 報告日期回到今天
        await refreshMastered();
        syncReminderMeta(State.profile);
        scheduleForegroundReminder(State.profile);
        renderHeader();
        route();
      });
    });
  });
}

// ---------- 路由 ----------
const ROUTES = {
  '#home': renderHome,
  '#quiz': renderQuiz,
  '#calendar': renderCalendar,
  '#lookup': renderLookup,
  '#mywords': renderMyWords,
  '#groups': renderGroups,
  '#manual': renderManualBuilder,
  '#roots': renderRoots,
  '#report': renderReport,
  '#more': renderMore,
  '#parent': renderParentZone,
  '#custombook': renderCustomBooks,
  '#scan': renderScan,
  '#settings': renderSettings,
};

// 不在底部導覽的子頁，歸屬「更多」分頁高亮
const MORE_SUBPAGES = new Set(['#lookup', '#roots', '#groups', '#report', '#settings', '#more', '#parent', '#manual', '#custombook']);

function route() {
  const hash = location.hash || '#home';
  const fn = ROUTES[hash] || renderHome;
  const navHash = hash === '#scan' ? '#quiz' : MORE_SUBPAGES.has(hash) ? '#more' : hash;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.route === navHash);
  });
  fn();
}

// 導覽：設定 hash 並強制重繪（即使 hash 未變）
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---------- Service Worker（含自動更新到新版） ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let firstInstall = !hadController;
  let refreshing = false;

  navigator.serviceWorker.register('./service-worker.js')
    .then((reg) => {
      reg.update();
      // iOS/Android PWA 常從記憶體恢復而不重新載入頁面 → 回到前景時主動檢查更新
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      // 若新版 SW 已下載完在等待（舊版卡住的情況），直接請它接管 → 觸發 controllerchange 重整
      if (reg.waiting) reg.waiting.postMessage('skipWaiting');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage('skipWaiting');
        });
      });
    })
    .catch((e) => console.warn('SW 註冊失敗', e));

  // 當新版 SW 接管時自動重整一次（首次安裝不重整，避免無謂刷新）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (firstInstall) { firstInstall = false; return; }
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}

window.addEventListener('DOMContentLoaded', init);

export { go, renderHeader, route };
