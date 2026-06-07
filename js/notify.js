// notify.js — 每日練習提醒
// 兩層作法：
//  第一層（裝置通知，盡力而為）：Notification 權限 + 前景排程(setTimeout) + Periodic Background Sync(SW)。
//  第二層（行事曆 .ics，最可靠）：產生每日重複 RRULE + VALARM 的 .ics，匯入手機行事曆每天準時跳。

import { setMeta } from './db.js';

let _fgTimer = null;

// 是否支援通知
export function notifySupported() {
  return 'Notification' in window;
}

export function notifyPermission() {
  return notifySupported() ? Notification.permission : 'unsupported';
}

// 請求通知權限
export async function requestNotifyPermission() {
  if (!notifySupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (e) {
    return Notification.permission;
  }
}

// 顯示一則通知（優先透過 SW，使點擊可開到測驗畫面）
export async function showReminderNow(title, body) {
  const opts = {
    body: body || '點開練 5 分鐘 💪',
    tag: 'vocab-daily-reminder',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: './index.html#quiz' },
  };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title || '📚 背英文單字時間', opts);
      return true;
    }
  } catch (e) { /* 退回 Notification */ }
  try {
    new Notification(title || '📚 背英文單字時間', opts);
    return true;
  } catch (e) {
    return false;
  }
}

// 解析 "HH:MM" → {h, m}
function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '19:30');
  return m ? { h: +m[1], m: +m[2] } : { h: 19, m: 30 };
}

// 前景排程：App 開著時，到提醒時間就跳通知（最可靠的純前端方式）
export function scheduleForegroundReminder(profile) {
  if (_fgTimer) { clearTimeout(_fgTimer); _fgTimer = null; }
  const s = profile.settings || {};
  if (!s.reminderOn) return;
  if (notifyPermission() !== 'granted') return;

  const { h, m } = parseTime(s.reminderTime);
  const now = new Date();
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) return; // 今天時間已過就不在前景重排（避免一開 App 就跳）
  const delay = next - now;
  _fgTimer = setTimeout(() => {
    showReminderNow('📚 今天的英文單字還沒練喔！', '點開練 5 分鐘 💪');
    scheduleForegroundReminder(profile); // 隔天再排
  }, Math.min(delay, 2147483000));
}

// 嘗試註冊 Periodic Background Sync（Android 安裝版 PWA，盡力而為）
export async function registerPeriodicReminder() {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return false;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return false;
    await reg.periodicSync.register('daily-reminder', { minInterval: 12 * 60 * 60 * 1000 });
    return true;
  } catch (e) {
    return false;
  }
}

// 把提醒設定同步到 meta（供 Service Worker 背景讀取）
export async function syncReminderMeta(profile) {
  const s = profile.settings || {};
  await setMeta('reminder', {
    on: !!s.reminderOn,
    time: s.reminderTime || '19:30',
    name: profile.name,
    profileId: profile.id,
  });
}

// ---------- 第二層：.ics 行事曆 ----------
function pad(n) { return String(n).padStart(2, '0'); }

function icsDateTimeLocal(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
function icsDateTimeUTC(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// 產生每日重複的 .ics 文字
export function buildICS(profile) {
  const s = profile.settings || {};
  const { h, m } = parseTime(s.reminderTime);
  const start = new Date();
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + 5 * 60 * 1000);
  const uid = `vocab-reminder-${profile.id}-${Date.now()}@vocab`;
  const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//vocab-memory//daily-reminder//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDateTimeUTC(new Date())}`,
    `DTSTART:${icsDateTimeLocal(start)}`,
    `DTEND:${icsDateTimeLocal(end)}`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:📚 背英文單字時間（${profile.name}）`,
    `DESCRIPTION:點開 App 練 5 分鐘 💪\\n${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:📚 該背英文單字囉！',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

// 下載 .ics
export function downloadICS(profile) {
  const text = buildICS(profile);
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `背單字提醒-${profile.name}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
