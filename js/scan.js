// scan.js — 掃 QR／貼出題碼載入家長出的題（自 app.js 原樣搬出，G1 拆分）

import { createManualGroup, enterGroupStudy, go } from './app.js';
import { decodeCode } from './paircode.js';
import { $main } from './state.js';
import { todayStr } from './util.js';


// ============================================================
// L-3d 孩子手機：掃 QR / 貼出題碼載入「家長出的題」
// ============================================================
let _scanStream = null;
function renderScan() {
  $main().innerHTML = `
    <div class="card">
      <div class="daily-top"><button class="btn" id="sc-back">‹ 測驗</button><b>📷 家長出的題</b></div>
      <p class="hint-area">用家長電腦上的「出題碼／QR」載入今天要考的字。載入後就地作答，記錄存這支手機。</p>
    </div>
    <div class="card">
      <button class="btn primary big-copy" id="sc-cam">📷 開相機掃 QR</button>
      <div id="sc-video-wrap" class="hidden"><video id="sc-video" playsinline class="sc-video"></video><p class="hint-area">把 QR 對準框內…</p></div>
      <p id="sc-cam-status" class="hint-area"></p>
    </div>
    <div class="card">
      <p class="hint-area">或直接貼上出題碼：</p>
      <textarea id="sc-code" class="answer-input code-box" rows="2" placeholder="貼上 V1... 出題碼"></textarea>
      <button class="btn primary" id="sc-load">載入這批字</button>
      <p id="sc-status" class="hint-area"></p>
    </div>`;
  document.getElementById('sc-back').onclick = () => { stopScan(); go('#quiz'); };
  document.getElementById('sc-load').onclick = () => scanLoadCode(document.getElementById('sc-code').value);
  document.getElementById('sc-cam').onclick = startScan;
}

async function startScan() {
  const status = document.getElementById('sc-cam-status');
  if (!window.jsQR) { status.textContent = '⚠️ 掃描元件未載入，請用貼出題碼。'; return; }
  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) { status.textContent = '⚠️ 無法開啟相機（權限或裝置不支援），請改用貼出題碼。'; return; }
  document.getElementById('sc-video-wrap').classList.remove('hidden');
  const video = document.getElementById('sc-video');
  video.srcObject = _scanStream;
  await video.play();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!_scanStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(img.data, img.width, img.height);
      if (found && found.data) { stopScan(); return scanLoadCode(found.data); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopScan() {
  if (_scanStream) { _scanStream.getTracks().forEach((t) => t.stop()); _scanStream = null; }
  const w = document.getElementById('sc-video-wrap'); if (w) w.classList.add('hidden');
}

async function scanLoadCode(code) {
  const status = document.getElementById('sc-status');
  let decoded;
  try { decoded = decodeCode(code); } catch (e) { if (status) status.textContent = '⚠️ ' + e.message; else alert(e.message); return; }
  const { ids, types } = decoded;
  if (!ids.length) { if (status) status.textContent = '⚠️ 這個碼沒有可載入的字。'; return; }
  const g = await createManualGroup(todayStr(), '家長出的題', ids, types);
  enterGroupStudy(g);
}
export { _scanStream, renderScan, startScan, stopScan, scanLoadCode };
