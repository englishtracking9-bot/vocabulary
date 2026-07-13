// more.js — 更多頁與設定頁（自 app.js 原樣搬出，G1 拆分）

import { go, renderHeader } from './app.js';
import { deleteProfileFully, getAllProfiles, getProfile, getRecordsByProfile, putProfile, setMeta } from './db.js';
import { downloadICS, notifyPermission, notifySupported, registerPeriodicReminder, requestNotifyPermission, scheduleForegroundReminder, showReminderNow, syncReminderMeta } from './notify.js';
import { openStatDetail } from './home.js';
import { MyWordsFilter } from './mywords.js';
import { encodeSyncCodes } from './paircode.js';
import { qrSvg } from './parent.js';
import { copyToClipboard } from './report.js';
import { isIntroduced } from './srs.js';
import { $main, APP_UI_VERSION, State } from './state.js';
import { exportProfile, getStats, importProfile } from './stats.js';
import { esc, todayStr } from './util.js';


// ============================================================
// 設定
// ============================================================
// ============================================================
// L-1「更多」頁：把次要／管理／家長功能集中，清楚分區、好找
// ============================================================
// 產生一列可點的功能入口
function moreRow(icon, title, desc, onClick, badge = '') {
  const id = 'mr-' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => { const el = document.getElementById(id); if (el) el.onclick = onClick; }, 0);
  return `<div class="row tap more-row" id="${id}"><div class="row-main">
      <span class="row-word">${icon} ${esc(title)}${badge ? ` <span class="tag-custom sm">${badge}</span>` : ''}</span>
      <span class="row-zh">${esc(desc)}</span></div>
      <div class="row-meta"><span>›</span></div></div>`;
}

function renderMore() {
  $main().innerHTML = `
    <div class="card">
      <h2>⋯ 更多</h2>
      <p class="hint-area">日常學習在下方導覽列（首頁／學習／測驗／我的字）。這裡放工具、管理與家長功能。</p>
    </div>

    <div class="card">
      <h3>🧰 學習工具</h3>
      <div class="detail-list">
        ${moreRow('🔎', '查單字', '查 6000 字或上網查新字／片語，自動加入待學', () => go('#lookup'))}
        ${moreRow('🌱', '字根字首', '用字根字首規律成組記憶', () => go('#roots'))}
      </div>
    </div>

    <div class="card">
      <h3>🗂 我的內容</h3>
      <div class="detail-list">
        ${moreRow('🏷', '群組管理', '把 6000 字貼標籤分組（如「二次段考」），可整組測', () => go('#groups'))}
        ${moreRow('📓', '自訂單字本', '完全自己打的內容（片語、成語、講義），可轉測驗', () => go('#custombook'))}
      </div>
    </div>

    <div class="card">
      <h3>📊 記錄</h3>
      <div class="detail-list">
        ${moreRow('📊', '每日報告', '複製當天學習成果傳給家長（LINE）', () => go('#report'))}
      </div>
    </div>

    <div class="card parent-entry">
      <h3>👨‍👩‍👧 家長專區</h3>
      <p class="hint-area">在「家長電腦」排整月進度、出題、列印講義與出題碼／QR。</p>
      <div class="detail-list">
        ${moreRow('🖨️', '家長出題／列印', '月排程、出題碼（QR）、背誦版／考卷版列印', () => go('#parent'))}
      </div>
    </div>

    <div class="card">
      <h3>⚙️ 系統</h3>
      <div class="detail-list">
        ${moreRow('👤', '身分與設定', '切換／新增使用者、每日字數、級別、外觀', () => go('#settings'))}
        ${moreRow('💾', '匯出／匯入備份', '換手機或保險用（在設定頁底部）', () => go('#settings'))}
        ${moreRow('⏰', '每日練習提醒', '設定提醒時間、加入手機行事曆（在設定頁底部）', () => go('#settings'))}
      </div>
    </div>
    <p class="ver-tag">版本 ${APP_UI_VERSION}</p>`;
}

// 裝置分工白話說明（家長專區與相關頁共用）
function deviceRoleNoteHTML() {
  return `<div class="card role-note">
      <h3>📱💻 這套系統怎麼分工？</h3>
      <p>這是純本機 App、<b>沒有雲端</b>。兩台裝置各做各的：</p>
      <ul class="role-list">
        <li><b>家長電腦</b>：排整月進度、出題、列印，產生每天的<b>出題碼／QR</b>。這些排程與題目<b>只存在這台電腦</b>。</li>
        <li><b>孩子手機</b>：掃 QR／貼出題碼載入「要考哪些字」，作答、記錄、複習、週月測都存在手機。</li>
      </ul>
      <p class="hint-area">兩邊只用出題碼單向傳「要考哪些字」，<b>不會傳成績</b>。要看成績，請用孩子手機「每日報告 → 複製」傳給家長。</p>
    </div>`;
}

async function renderSettings() {
  const p = State.profile;
  const s = p.settings;
  const stats = await getStats(p.id);
  const profiles = await getAllProfiles();
  $main().innerHTML = `
    <div class="card">
      <h2>使用者管理</h2>
      <div id="user-list">
        ${profiles.map((u) => `
          <div class="row" data-uid="${u.id}">
            <div class="row-main">
              <span class="row-word">${esc(u.name)} ${u.id === p.id ? '（使用中）' : ''}</span>
            </div>
            <div class="btn-row">
              <button class="btn" data-act="switch" data-uid="${u.id}">切換</button>
              <button class="btn" data-act="rename" data-uid="${u.id}">改名</button>
              <button class="btn danger" data-act="delete" data-uid="${u.id}" ${profiles.length <= 1 ? 'disabled' : ''}>刪除</button>
            </div>
          </div>`).join('')}
      </div>
      <button class="btn primary" id="add-user">＋ 新增使用者</button>
      <p class="hint-area">每個使用者各自獨立的進度、設定、單字佇列與學習日曆。</p>
    </div>

    <div class="card">
      <h2>外觀</h2>
      <p class="hint-area">預設白底淺色。深色為手動開啟，不會自動跟隨系統。</p>
      <div class="btn-row">
        <button class="btn theme-opt" data-theme="light">☀️ 淺色（白底）</button>
        <button class="btn theme-opt" data-theme="dark">🌙 深色</button>
      </div>
    </div>

    <div class="card">
      <h2>目前使用者設定（${esc(p.name)}）</h2>
      <label>每日單字數（10–20）
        <input id="set-limit" class="answer-input" type="number" min="10" max="20" value="${s.dailyNewLimit}" />
      </label>
      <div>出題級別（新字來源）：</div>
      <div class="level-checks">
        ${[1, 2, 3, 4, 5, 6].map((l) =>
          `<label class="chk"><input type="checkbox" class="lv" value="${l}" ${s.levels.includes(l) ? 'checked' : ''}/> Lv${l}</label>`).join('')}
      </div>
      <div>每日單字來源：</div>
      <div class="src-opts">
        <label class="chk"><input type="radio" name="dsrc" value="auto" ${(s.dailySource || 'auto') === 'auto' ? 'checked' : ''}/> ① 系統自動排（預設）</label>
        <label class="chk"><input type="radio" name="dsrc" value="parent" ${s.dailySource === 'parent' ? 'checked' : ''}/> ② 家長排程（掃碼／家長出題為準）</label>
      </div>
      <p class="hint-area">選「家長排程」後，手機不再自動排每日新字，改以家長排定或掃入的為準，避免兩套打架。</p>
      <button class="btn primary" id="set-save">儲存設定</button>
      <p id="set-status" class="hint-area"></p>
    </div>

    <div class="card">
      <h2>學習統計</h2>
      <div class="stat-grid">
        <div class="stat-cell tap" data-mw="mastered"><b>${stats.masteredCore}</b><span>🌳 已熟記</span></div>
        <div class="stat-cell tap" data-mw="proficient"><b>${stats.proficient}</b><span>🌲 穩固</span></div>
        <div class="stat-cell tap" data-mw="weak"><b>${stats.weak}</b><span>🌿 學習中</span></div>
        <div class="stat-cell tap" data-mw="new"><b>${stats.newCount}</b><span>🌱 未測驗</span></div>
        <div class="stat-cell tap" data-mw="all"><b>${stats.tracked}</b><span>已納入學習</span></div>
        <div class="stat-cell tap" data-strk="1"><b>🔥 ${stats.streak}</b><span>連續天數</span></div>
        <div class="stat-cell tap" data-rep="1"><b>${stats.recentAccuracy}%</b><span>近7日答對率</span></div>
        <div><b>${stats.totalVocab}</b><span>全六級總字數</span></div>
      </div>
      <p class="hint-area">🌳 已熟記＝連續多天答對；🌲 穩固＝隔很多天仍答對。已熟記比例＝🌳＋🌲＝${stats.masteredPct}%。點任一格看明細。</p>
    </div>

    <div class="card">
      <h2>備份（換手機 / 保險）</h2>
      <div class="btn-row">
        <button class="btn" id="exp">匯出進度(JSON)</button>
        <label class="btn">匯入進度(JSON)<input id="imp" type="file" accept="application/json" hidden /></label>
      </div>
      <p class="hint-area">匯入會「覆蓋」目前身分的進度，請小心。</p>
    </div>

    <div class="card">
      <h2>📤 進度同步碼（給家長，一次性）</h2>
      <p class="hint-area">把 <b>${esc(State.profile.name)} 目前為止做過的所有字</b>做成一串碼，傳給家長貼進電腦
      「家長專區 → 輸入完成碼」，家長排程就會跳過這些字。<b>第一次使用時同步一次即可</b>；
      之後每天的進度由「每日報告」末尾的完成碼自動累加，不用再產生這個。</p>
      <button class="btn primary" id="sync-gen">產生進度同步碼</button>
      <p id="sync-status" class="hint-area"></p>
    </div>

    <div class="card">
      <h2>每日練習提醒</h2>
      <label class="chk"><input type="checkbox" id="rm-on" ${s.reminderOn ? 'checked' : ''}/> 開啟每日提醒</label>
      <label>提醒時間
        <input type="time" id="rm-time" class="answer-input" value="${s.reminderTime || '19:30'}" />
      </label>
      <div class="btn-row">
        <button class="btn primary" id="rm-cal">📅 加入到手機行事曆（最穩定）</button>
      </div>
      <p class="hint-area">行事曆最可靠：匯入後每天到點一定跳，跨 iPhone／Android、不靠 App 開著。</p>
      <div class="btn-row">
        <button class="btn" id="rm-notify">🔔 開啟裝置通知</button>
        <button class="btn" id="rm-test">測試通知</button>
      </div>
      <p id="rm-status" class="hint-area"></p>
    </div>`;

  // 外觀（淺色／深色）— 全裝置共用，存 localStorage
  const curTheme = (() => { try { return localStorage.getItem('vocabTheme') === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; } })();
  document.querySelectorAll('.theme-opt').forEach((b) => {
    if (b.dataset.theme === curTheme) b.classList.add('primary');
    b.onclick = () => {
      const t = b.dataset.theme;
      try { localStorage.setItem('vocabTheme', t); } catch (e) { /* ignore */ }
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
      document.querySelectorAll('.theme-opt').forEach((x) => x.classList.toggle('primary', x.dataset.theme === t));
    };
  });

  // K：學習統計格可點看明細
  document.querySelectorAll('[data-mw]').forEach((c) => {
    c.onclick = () => { MyWordsFilter.status = c.dataset.mw; go('#mywords'); };
  });
  const strk = document.querySelector('[data-strk]');
  if (strk) strk.onclick = () => openStatDetail('streak');
  const rep = document.querySelector('[data-rep]');
  if (rep) rep.onclick = () => go('#report');

  // P：進度同步碼（全量、一次性；「做過」的定義＝srs.js isIntroduced）
  document.getElementById('sync-gen').onclick = async () => {
    const st = document.getElementById('sync-status');
    const recs = await getRecordsByProfile(State.profile.id);
    const doneIds = recs.filter(isIntroduced).map((r) => r.wordId);
    if (!doneIds.length) { st.textContent = '目前還沒有做過的字，不需要同步。'; return; }
    const codes = encodeSyncCodes(State.profile.id, doneIds);
    const all = codes.join('\n\n');
    const m = document.getElementById('modal');
    m.innerHTML = `
      <div class="modal-box center">
        <h3>📤 進度同步碼</h3>
        <p class="hint-area">${esc(State.profile.name)} 做過 ${doneIds.length} 字${codes.length > 1 ? `（分 ${codes.length} 段，一起複製、一起貼即可）` : ''}。
        傳給家長貼進電腦「家長專區 → 輸入完成碼」。</p>
        ${codes.length === 1 && codes[0].length <= 800 ? qrSvg(codes[0]) : ''}
        <textarea class="answer-input code-box" readonly rows="4">${esc(all)}</textarea>
        <div class="btn-row">
          <button class="btn primary" id="sy-copy">複製同步碼</button>
          <button class="btn" id="sy-close">關閉</button>
        </div>
      </div>`;
    m.classList.add('show');
    document.getElementById('sy-copy').onclick = async () => {
      const ok = await copyToClipboard(all);
      document.getElementById('sy-copy').textContent = ok ? '✅ 已複製' : '請長按上方文字複製';
    };
    document.getElementById('sy-close').onclick = () => m.classList.remove('show');
  };

  // 每日提醒控制
  const rmStatus = document.getElementById('rm-status');
  const saveReminder = async () => {
    p.settings = { ...p.settings, reminderOn: document.getElementById('rm-on').checked, reminderTime: document.getElementById('rm-time').value || '19:30' };
    await putProfile(p);
    State.profile = p;
    await syncReminderMeta(p);
    scheduleForegroundReminder(p);
  };
  document.getElementById('rm-on').onchange = saveReminder;
  document.getElementById('rm-time').onchange = saveReminder;
  document.getElementById('rm-cal').onclick = async () => {
    await saveReminder();
    downloadICS(p);
    rmStatus.textContent = '✅ 已下載 .ics，請點開檔案匯入手機行事曆（每天會重複提醒）。';
  };
  document.getElementById('rm-notify').onclick = async () => {
    if (!notifySupported()) { rmStatus.textContent = '⚠️ 此瀏覽器不支援通知，請用「加入行事曆」。'; return; }
    const perm = await requestNotifyPermission();
    if (perm === 'granted') {
      await saveReminder();
      const periodic = await registerPeriodicReminder();
      scheduleForegroundReminder(p);
      rmStatus.textContent = '✅ 已開啟裝置通知' + (periodic ? '（含背景提醒）' : '（App 開著時最準；背景提醒不一定支援，建議也加行事曆）');
    } else {
      rmStatus.textContent = '⚠️ 通知權限未開啟，請改用「加入行事曆」最穩定。';
    }
  };
  document.getElementById('rm-test').onclick = async () => {
    if (notifyPermission() !== 'granted') { rmStatus.textContent = '請先按「開啟裝置通知」。'; return; }
    const ok = await showReminderNow('📚 測試通知', '這就是每天會看到的提醒，點我開到測驗。');
    rmStatus.textContent = ok ? '✅ 已送出測試通知' : '⚠️ 無法顯示通知';
  };

  document.getElementById('set-save').onclick = async () => {
    let limit = parseInt(document.getElementById('set-limit').value, 10) || s.dailyNewLimit;
    limit = Math.max(10, Math.min(20, limit)); // 限制 10–20
    const levels = [...document.querySelectorAll('.lv:checked')].map((c) => parseInt(c.value, 10));
    const dailySource = (document.querySelector('input[name="dsrc"]:checked') || {}).value || 'auto';
    p.settings = { ...s, dailyNewLimit: limit, levels: levels.length ? levels : [4, 5, 6], dailySource };
    await putProfile(p);
    State.profile = p;
    State.session = null;
    renderHeader();
    document.getElementById('set-status').textContent = '✅ 已儲存';
  };

  // ---- 使用者管理：切換 / 改名 / 刪除 / 新增 ----
  document.querySelectorAll('#user-list [data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const uid = btn.dataset.uid;
      const act = btn.dataset.act;
      const target = profiles.find((u) => u.id === uid);
      if (!target) return;

      if (act === 'switch') {
        State.profile = await getProfile(uid);
        await setMeta('activeProfile', uid);
        State.session = null;
        renderHeader();
        renderSettings();
      } else if (act === 'rename') {
        const name = prompt('輸入新的使用者名稱：', target.name);
        if (name && name.trim()) {
          target.name = name.trim();
          await putProfile(target);
          if (uid === State.profile.id) State.profile = target;
          renderHeader();
          renderSettings();
        }
      } else if (act === 'delete') {
        if (profiles.length <= 1) { alert('至少要保留一個使用者'); return; }
        if (!confirm(`確定要刪除使用者「${target.name}」？\n他的所有單字進度、統計與學習日曆都會永久消失。`)) return;
        if (!confirm(`再次確認：真的要刪除「${target.name}」嗎？此動作無法復原。`)) return;
        await deleteProfileFully(uid);
        // 若刪到使用中身分，切到其餘第一個
        if (uid === State.profile.id) {
          const rest = (await getAllProfiles())[0];
          State.profile = rest;
          await setMeta('activeProfile', rest.id);
          State.session = null;
        }
        renderHeader();
        renderSettings();
      }
    };
  });

  document.getElementById('add-user').onclick = async () => {
    const name = prompt('輸入新使用者的名稱：', '');
    if (!name || !name.trim()) return;
    const newProfile = {
      id: 'user-' + Date.now(),
      name: name.trim(),
      settings: { dailyNewLimit: 15, levels: [4, 5, 6], priorityLevels: [4, 5, 6], reminderTime: '19:30', reminderOn: false },
    };
    await putProfile(newProfile);
    State.profile = newProfile;
    await setMeta('activeProfile', newProfile.id);
    State.session = null;
    renderHeader();
    renderSettings();
  };

  document.getElementById('exp').onclick = async () => {
    const data = await exportProfile(p.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vocab-${p.id}-${todayStr()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('imp').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const n = await importProfile(data, p.id);
      State.profile = await getProfile(p.id);
      State.session = null;
      renderHeader();
      alert(`✅ 已匯入 ${n} 筆紀錄`);
      renderSettings();
    } catch (err) {
      alert('⚠️ 匯入失敗：' + err.message);
    }
  };
}
export { moreRow, renderMore, deviceRoleNoteHTML, renderSettings };
