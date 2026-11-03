// cloud.js — Supabase 雲端同步「地基」（階段 A）
//
// 設計原則（鐵則級，後續階段都要守）：
//   1. 離線、或 vendor 腳本沒載到、或建 client 失敗，都「回 null / false」，絕不丟例外、絕不讓 App 崩潰。
//   2. 連不上雲端時一律靜默退回純本機（IndexedDB 仍是唯一主存）。
//   3. 本階段只建立 client 與連線探測能力，尚未改任何學習流程——
//      登入／角色選擇在階段 B、db.js 同步層在階段 C、搬遷在 D、家長儀表板在 E。
//
// publishable key 是公開 anon key：可安全放前端，資料由 Row Level Security（family_id = auth.uid()）保護。

const SUPABASE_URL = 'https://ajwzwgeoymadekrxlfzz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_66ajHG_S0ldHnasTSvoE6Q_fFsUWY53';

let _client = null;
let _tried = false;

// 取得 Supabase client（lazy、只建一次）。任何情況失敗都回 null，不丟例外。
export function getSupabase() {
  if (_tried) return _client;
  _tried = true;
  try {
    const lib = (typeof window !== 'undefined') && window.supabase;
    if (!lib || typeof lib.createClient !== 'function') {
      // vendor/supabase.js 沒載到（離線首開、檔案缺、被擋）→ 純本機
      return (_client = null);
    }
    _client = lib.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  } catch (e) {
    console.warn('[cloud] 建立 Supabase client 失敗，改用純本機', e);
    _client = null;
  }
  return _client;
}

// 「函式庫已載入且 client 可建」——不代表現在連得上網。
export function cloudConfigured() {
  return !!getSupabase();
}

// 盡力而為的連線探測：回 true/false，永不丟例外（給後續階段決定要不要同步用）。
export async function cloudReachable(timeoutMs = 4000) {
  if (!getSupabase()) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // GoTrue health：帶 apikey、不需登入，確認雲端在線且 key 被接受（health 端點要求 apikey，否則回 401）。
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: ctrl.signal,
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    clearTimeout(timer);
    return !!(res && res.ok);
  } catch (e) {
    return false; // 離線 / 逾時 / 任何錯 → 當作連不上，靜默退回本機
  }
}

// 啟動時呼叫一次：只做安全探測與 log，不改任何 UI、不阻塞。供自測時在 console 確認地基就緒。
export function initCloud() {
  try {
    const ok = cloudConfigured();
    console.log(`[cloud] 地基載入：Supabase client ${ok ? '就緒' : '不可用（純本機模式）'}`);
  } catch (e) {
    console.warn('[cloud] initCloud 探測失敗（可忽略，純本機）', e);
  }
}
