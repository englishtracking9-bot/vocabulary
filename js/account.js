// account.js — 雲端同步「階段 B」：家庭帳號登入 ＋ 這台裝置的身分對應
//
// 帳號模型：一個「家庭帳號」＝ Supabase Auth 的一個使用者（email＋密碼，家長在 Supabase 後台建立）。
// 雲端身分固定用英文小寫 key（justin / sonya / lc），本機身分用既有 profileId（senior1 / junior3 / 自訂）。
// 兩者的對應存在這台裝置的 meta 'cloudLinks'（裝置專屬、不同步）：
//   因為每台裝置上「誰是 Justin」不一定一樣（可能改過名、或另外新增過身分），第一次登入時讓家長確認一次。
//
// 鐵則：雲端連不上（離線、Supabase 暫停、vendor 沒載到）時，絕不能擋住孩子學習 → 提供「先離線使用」。
// 本階段只做登入與對應，不上傳、不下載任何學習紀錄（那是階段 C／D）。

import { getSupabase } from './cloud.js';
import { getAllProfiles, getMeta, getRecordsByProfile, setMeta } from './db.js';
import { $main } from './state.js';
import { esc } from './util.js';

export const CLOUD_IDENTITIES = [
  { key: 'justin', label: 'Justin', guessId: 'senior1' },
  { key: 'sonya', label: 'Sonya', guessId: 'junior3' },
  { key: 'lc', label: 'LC', guessName: 'lc' },
];

let _session = null;
let _offline = false;

export function currentSession() { return _session; }
export function isOfflineMode() { return _offline; }
export async function getCloudLinks() { return (await getMeta('cloudLinks')) || null; }

// 啟動時呼叫：確保已登入＋已設定裝置對應。回傳 { mode: 'cloud' | 'offline' }
export async function ensureAccount() {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data } = await sb.auth.getSession(); // 讀本機保存的登入狀態，離線也能用
      _session = data && data.session;
    } catch (e) { _session = null; }
  }
  if (!_session) {
    const r = await loginScreen(!sb);
    if (r === 'offline') { _offline = true; return { mode: 'offline' }; }
  }
  if (!(await getCloudLinks())) await linkScreen();
  return { mode: 'cloud' };
}

function gateOn(on) { document.body.classList.toggle('gate', on); }

// ---------- 登入畫面 ----------
function loginScreen(cloudUnavailable) {
  gateOn(true);
  return new Promise((resolve) => {
    $main().innerHTML = `
      <div class="card acct-card">
        <h2>☁️ 家庭帳號登入</h2>
        <p class="hint-area">登入一次後，這台裝置會記住，之後不用再登入。登入後，學習紀錄之後就能在手機、平板、電腦之間同步。</p>
        <label>Email
          <input id="ac-email" class="answer-input" type="email" autocomplete="username" autocapitalize="off" spellcheck="false" inputmode="email" />
        </label>
        <label>密碼
          <input id="ac-pw" class="answer-input" type="password" autocomplete="current-password" />
        </label>
        <div class="btn-row"><button class="btn primary" id="ac-login">登入</button></div>
        <div id="ac-msg"></div>
        <div id="ac-offline" style="display:${cloudUnavailable ? '' : 'none'}">
          <p class="hint-area">目前連不上雲端（可能沒有網路）。可以先在這台裝置照常學習，紀錄會留在這台裝置，下次連網再登入。</p>
          <div class="btn-row"><button class="btn" id="ac-skip">📴 先離線使用</button></div>
        </div>
      </div>`;
    const email = document.getElementById('ac-email');
    const pw = document.getElementById('ac-pw');
    const msg = document.getElementById('ac-msg');
    const btn = document.getElementById('ac-login');
    const showOffline = () => { document.getElementById('ac-offline').style.display = ''; };
    email.focus();
    pw.onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };
    document.getElementById('ac-skip').onclick = () => { gateOn(false); resolve('offline'); };
    btn.onclick = async () => {
      const sb = getSupabase();
      if (!sb) { msg.innerHTML = '<p class="pq-fb ng">雲端功能沒有載入（可能離線）。</p>'; showOffline(); return; }
      if (!email.value.trim() || !pw.value) { msg.innerHTML = '<p class="pq-fb ng">請輸入 Email 和密碼</p>'; return; }
      btn.disabled = true; btn.textContent = '登入中…'; msg.innerHTML = '';
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
        if (error) throw error;
        _session = data.session;
        resolve('ok');
      } catch (e) {
        const m = String((e && e.message) || e);
        let text;
        if (/invalid login credentials/i.test(m)) text = 'Email 或密碼不對，請再確認一次。';
        else if (/email not confirmed/i.test(m)) text = '這個帳號還沒完成 Email 驗證（請在 Supabase 後台把使用者設為已確認）。';
        else if (/fetch|network|failed to|load failed/i.test(m)) { text = '連不上雲端，請確認網路。'; showOffline(); }
        else text = `登入失敗：${m}`;
        msg.innerHTML = `<p class="pq-fb ng">${esc(text)}</p>`;
        btn.disabled = false; btn.textContent = '登入';
      }
    };
  });
}

// ---------- 裝置身分對應 ----------
// 列出這台裝置上的每個身分（含紀錄筆數），讓家長指定「誰是 Justin／Sonya／LC」
export async function linkScreen({ fromSettings = false } = {}) {
  gateOn(!fromSettings);
  const profiles = await getAllProfiles();
  const counts = {};
  for (const p of profiles) {
    try { counts[p.id] = (await getRecordsByProfile(p.id)).length; } catch (e) { counts[p.id] = 0; }
  }
  const old = (await getCloudLinks()) || {};
  const guess = (idt) => {
    if (idt.key in old) return old[idt.key] || '';
    if (idt.guessId && profiles.some((p) => p.id === idt.guessId)) return idt.guessId;
    const byName = profiles.find((p) => String(p.name).trim().toLowerCase() === (idt.guessName || idt.label.toLowerCase()));
    return byName ? byName.id : '';
  };
  const opts = (sel) => `<option value="">（這台裝置沒有）</option>` + profiles.map((p) =>
    `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}（${counts[p.id]} 筆紀錄）</option>`).join('');

  return new Promise((resolve) => {
    $main().innerHTML = `
      <div class="card acct-card">
        <h2>📱 這台裝置是誰的紀錄？</h2>
        <p class="hint-area">每台裝置只要設定一次。請對照名稱和紀錄筆數，選出這台裝置上「誰是誰」。名稱不一樣沒關係，選對就好；這台裝置沒有那個人的紀錄，就選「這台裝置沒有」。</p>
        ${CLOUD_IDENTITIES.map((idt) => `
          <label class="acct-link"><b>${esc(idt.label)}</b>
            <select class="answer-input" data-idt="${idt.key}">${opts(guess(idt))}</select>
          </label>`).join('')}
        <div id="lk-msg"></div>
        <div class="btn-row">
          ${fromSettings ? '<button class="btn" id="lk-cancel">取消</button>' : ''}
          <button class="btn primary" id="lk-save">儲存</button>
        </div>
        <p class="hint-area">之後可在「設定 → ☁️ 家庭帳號」修改。</p>
      </div>`;
    const c = document.getElementById('lk-cancel');
    if (c) c.onclick = () => resolve(false);
    document.getElementById('lk-save').onclick = async () => {
      const links = {};
      const used = new Map();
      for (const sel of document.querySelectorAll('select[data-idt]')) {
        const v = sel.value || null;
        const label = CLOUD_IDENTITIES.find((i) => i.key === sel.dataset.idt).label;
        if (v && used.has(v)) {
          document.getElementById('lk-msg').innerHTML = `<p class="pq-fb ng">「${esc(label)}」和「${esc(used.get(v))}」選到同一個身分了，請改一下。</p>`;
          return;
        }
        if (v) used.set(v, label);
        links[sel.dataset.idt] = v;
      }
      await setMeta('cloudLinks', links);
      gateOn(false);
      resolve(true);
    };
  });
}

// ---------- 設定頁的「家庭帳號」區塊 ----------
export async function accountCardHTML() {
  const links = (await getCloudLinks()) || {};
  const profiles = await getAllProfiles();
  const nameOf = (id) => { const p = profiles.find((x) => x.id === id); return p ? p.name : '（找不到）'; };
  if (!_session) {
    return `<div class="card">
      <h2>☁️ 家庭帳號</h2>
      <p class="hint-area">${_offline ? '目前是「離線使用」，紀錄只存在這台裝置。' : '尚未登入。'}</p>
      <div class="btn-row"><button class="btn primary" id="acct-login">登入家庭帳號</button></div>
    </div>`;
  }
  const email = (_session.user && _session.user.email) || '';
  return `<div class="card">
    <h2>☁️ 家庭帳號</h2>
    <p>已登入：<b>${esc(email)}</b></p>
    <div class="detail-list">
      ${CLOUD_IDENTITIES.map((i) => `<div class="row"><div class="row-main"><span class="row-word">${esc(i.label)}</span>
        <span class="row-zh">${links[i.key] ? `這台裝置的「${esc(nameOf(links[i.key]))}」` : '這台裝置沒有'}</span></div></div>`).join('')}
    </div>
    <div class="btn-row"><button class="btn" id="acct-link">修改這台裝置的對應</button><button class="btn danger" id="acct-logout">登出</button></div>
    <p class="hint-area">目前只完成登入（階段 B），學習紀錄還不會同步；同步會在下一階段加上。</p>
  </div>`;
}

export function wireAccountCard(rerender) {
  const login = document.getElementById('acct-login');
  if (login) login.onclick = async () => {
    _offline = false;
    const r = await loginScreen(!getSupabase());
    if (r === 'ok' && !(await getCloudLinks())) await linkScreen();
    gateOn(false);
    rerender();
  };
  const link = document.getElementById('acct-link');
  if (link) link.onclick = async () => { await linkScreen({ fromSettings: true }); rerender(); };
  const out = document.getElementById('acct-logout');
  if (out) out.onclick = async () => {
    if (!confirm('確定要登出家庭帳號？這台裝置的學習紀錄不會被刪除。')) return;
    try { await getSupabase().auth.signOut(); } catch (e) { /* 離線登出也照樣清本機狀態 */ }
    _session = null;
    location.reload();
  };
}
