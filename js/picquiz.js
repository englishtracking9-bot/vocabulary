// picquiz.js — 🖼️ 圖解記憶卡的「當天測驗」與「🎤 口說測驗」
// 成績存進既有的 testResults（測驗中心的「成績紀錄」看得到），不改 SM-2 熟練度紀錄。

import { go } from './app.js';
import { speak } from './lookup.js';
import { $main, State } from './state.js';
import { saveTestResult } from './tests.js';
import { esc, shuffle } from './util.js';
import { getById } from './vocab.js';
import { scoreComment, scoreSpeech, scoreTips } from './speakscore.js';

const card = (h) => `<div class="card">${h}</div>`;
const backTo = () => go('#pics');

// ---------- 題目產生 ----------
function sentenceTokens(s) { return String(s).trim().split(/\s+/); }
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z'\- ]/g, '').trim();

// 在例句中找到目標字（含字尾變化，例如 pedestrians）
function findWordInSentence(sentence, word) {
  const toks = sentenceTokens(sentence);
  const w = word.toLowerCase();
  for (let i = 0; i < toks.length; i++) {
    const t = norm(toks[i]);
    if (t === w || (t.startsWith(w.slice(0, Math.max(4, w.length - 2))) && Math.abs(t.length - w.length) <= 3)) {
      const m = toks[i].match(/^([^A-Za-z]*)([A-Za-z'\-]+)(.*)$/);
      return m ? { index: i, form: m[2], pre: m[1], post: m[3] } : null;
    }
  }
  return null;
}

function buildQuestions(day, cards) {
  const spell = [], cloze = [], order = [];
  for (const id of day.wordIds) {
    const e = getById(id), c = cards[id];
    if (!e || !c) continue;
    spell.push({ kind: 'spell', id, word: e.word, zh: e.zh, pos: e.pos, answer: e.word });
    const f = findWordInSentence(c.example, e.word);
    if (f) cloze.push({ kind: 'cloze', id, word: e.word, sentence: c.example, zh: c.example_zh, found: f, answer: f.form });
    order.push({ kind: 'order', id, word: e.word, sentence: c.example, zh: c.example_zh, answer: c.example });
  }
  return [...shuffle(spell), ...shuffle(cloze), ...shuffle(order)];
}

const PART = { spell: '① 單字拼寫', cloze: '② 例句填空', order: '③ 句子重組' };

// ---------- 當天測驗 ----------
export function startPicTest(day, cards) {
  const qs = buildQuestions(day, cards);
  const t = { day, cards, qs, idx: 0, correct: 0, wrong: [], answered: false };
  renderQ(t);
}

function hintPattern(w) { return w[0] + ' ' + w.slice(1).replace(/[a-z]/gi, '_ ').trim(); }

function renderQ(t) {
  const q = t.qs[t.idx];
  if (!q) return renderTestResult(t);
  t.answered = false;
  const progress = `<div class="daily-top"><button class="btn" id="pq-quit">‹ 離開</button><b>${PART[q.kind]}</b><span>${t.idx + 1} / ${t.qs.length}</span></div>`;
  let body = '';
  if (q.kind === 'spell') {
    body = `<p class="pq-zh">${esc(q.pos)} ${esc(q.zh)}</p>
      <p class="hint-area">提示：${esc(hintPattern(q.word))}（${q.word.length} 個字母）</p>
      <input id="pq-in" class="answer-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="拼出英文單字" />`;
  } else if (q.kind === 'cloze') {
    const toks = sentenceTokens(q.sentence);
    toks[q.found.index] = `${esc(q.found.pre)}<span class="pq-blank">______</span>${esc(q.found.post)}`;
    const varied = q.found.form.toLowerCase() !== q.word.toLowerCase();
    body = `<p class="pq-sent">${toks.map((x, i) => (i === q.found.index ? x : esc(x))).join(' ')}</p>
      <p class="hint-area">${esc(q.zh)}</p>
      ${varied ? '<p class="hint-area">提示：注意字尾變化（例如加 s）</p>' : ''}
      <input id="pq-in" class="answer-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="填入空格的單字" />`;
  } else {
    const chips = shuffle(sentenceTokens(q.sentence).map((w, i) => ({ w, i })));
    // 避免剛好洗成原句
    if (chips.map((c) => c.i).join() === chips.map((_, i) => i).join() && chips.length > 1) chips.reverse();
    t.chips = chips; t.picked = [];
    body = `<p class="hint-area">${esc(q.zh)}</p>
      <div class="pq-built" id="pq-built"><span class="hint-area">依序點下面的字，組成正確的句子</span></div>
      <div class="pq-chips" id="pq-chips">${chips.map((c, k) => `<button class="pq-chip" data-k="${k}">${esc(c.w)}</button>`).join('')}</div>
      <div class="btn-row"><button class="btn" id="pq-undo">↩ 退一個</button><button class="btn" id="pq-clear">清除</button></div>`;
  }
  $main().innerHTML = card(`${progress}${body}
    <div id="pq-fb"></div>
    <div class="btn-row"><button class="btn primary" id="pq-go">確定</button></div>`);
  document.getElementById('pq-quit').onclick = () => { if (confirm('離開測驗？這次的作答不會存。')) backTo(); };
  const goBtn = document.getElementById('pq-go');
  goBtn.onclick = () => (t.answered ? next(t) : check(t));
  const inp = document.getElementById('pq-in');
  if (inp) { inp.focus(); inp.onkeydown = (e) => { if (e.key === 'Enter') goBtn.click(); }; }
  if (q.kind === 'order') wireChips(t);
}

function wireChips(t) {
  const draw = () => {
    const built = document.getElementById('pq-built');
    built.innerHTML = t.picked.length
      ? t.picked.map((k) => `<span class="pq-word">${esc(t.chips[k].w)}</span>`).join(' ')
      : '<span class="hint-area">依序點下面的字，組成正確的句子</span>';
    document.querySelectorAll('.pq-chip').forEach((b) => { b.disabled = t.picked.includes(Number(b.dataset.k)); });
  };
  document.querySelectorAll('.pq-chip').forEach((b) => {
    b.onclick = () => { if (t.answered) return; t.picked.push(Number(b.dataset.k)); draw(); };
  });
  document.getElementById('pq-undo').onclick = () => { if (!t.answered) { t.picked.pop(); draw(); } };
  document.getElementById('pq-clear').onclick = () => { if (!t.answered) { t.picked = []; draw(); } };
}

function check(t) {
  const q = t.qs[t.idx];
  let input, ok;
  if (q.kind === 'order') {
    if (t.picked.length < t.chips.length) { alert('還有字沒排完喔'); return; }
    input = t.picked.map((k) => t.chips[k].w).join(' ');
    ok = norm(input) === norm(q.answer);
  } else {
    input = document.getElementById('pq-in').value.trim();
    if (!input) { alert('請先作答'); return; }
    ok = input.toLowerCase() === q.answer.toLowerCase();
  }
  t.answered = true;
  if (ok) t.correct++;
  else t.wrong.push({ wordId: q.id, kind: q.kind === 'spell' ? 'spell' : 'sentence', input, answer: q.answer });
  const fb = document.getElementById('pq-fb');
  fb.innerHTML = `<div class="pq-fb ${ok ? 'ok' : 'ng'}">${ok ? '✅ 答對了！' : '❌ 正確答案：'}${ok ? '' : `<b>${esc(q.answer)}</b>`}
    <button class="btn" id="pq-say">🔊</button></div>`;
  document.getElementById('pq-say').onclick = () => speak(q.kind === 'spell' ? q.word : q.sentence);
  const inp = document.getElementById('pq-in');
  if (inp) inp.disabled = true;
  document.getElementById('pq-go').textContent = t.idx + 1 < t.qs.length ? '下一題 ›' : '看成績';
}

function next(t) { t.idx++; renderQ(t); window.scrollTo(0, 0); }

async function renderTestResult(t) {
  const total = t.qs.length;
  let saved = null;
  try {
    saved = await saveTestResult({
      profileId: State.profile.id, type: 'pics', name: `圖解記憶卡 ${t.day.label}`,
      total, correct: t.correct, wrong: t.wrong,
    });
  } catch (e) { console.warn('成績存檔失敗', e); }
  const pct = total ? Math.round((t.correct / total) * 100) : 0;
  const rows = t.wrong.length ? t.wrong.map((w) => {
    const e = getById(w.wordId);
    return `<div class="row"><div class="row-main"><span class="row-word">${esc(e ? e.word : w.wordId)}</span>
      <span class="row-zh">${w.kind === 'spell' ? '拼字' : '句子'}</span></div>
      <div class="row-meta"><span>你寫：${esc(w.input)}</span><span>正解：${esc(w.answer)}</span></div></div>`;
  }).join('') : '<p class="hint-area">全部答對 🎉</p>';
  $main().innerHTML = card(`
    <h2>${esc(t.day.label)} 測驗完成</h2>
    <p class="pq-big">${pct} 分</p>
    <p class="hint-area">答對 ${t.correct} / ${total} 題${saved ? '・已存到測驗中心的「成績紀錄」' : ''}</p>
    <div class="detail-list">${rows}</div>
    <div class="btn-row"><button class="btn primary" id="pr-speak">🎤 接著口說測驗</button></div>
    <div class="btn-row"><button class="btn" id="pr-again">🔁 再測一次</button><button class="btn" id="pr-back">回圖解記憶卡</button></div>`);
  document.getElementById('pr-again').onclick = () => startPicTest(t.day, t.cards);
  document.getElementById('pr-speak').onclick = () => startSpeakTest(t.day, t.cards);
  document.getElementById('pr-back').onclick = backTo;
}

// ---------- 🎤 口說測驗 ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let pitchDisabled = false; // 若同時開麥克風分析會干擾辨識，之後就不再開

export function startSpeakTest(day, cards) {
  const items = day.wordIds.map((id) => ({ id, e: getById(id), c: cards[id] })).filter((x) => x.e && x.c);
  const s = { day, cards, items, idx: 0, scores: [], wrong: [] };
  renderSpeak(s);
}

function renderSpeak(s) {
  const it = s.items[s.idx];
  if (!it) return renderSpeakResult(s);
  const supported = !!SR;
  $main().innerHTML = card(`
    <div class="daily-top"><button class="btn" id="sp-quit">‹ 離開</button><b>🎤 口說測驗</b><span>${s.idx + 1} / ${s.items.length}</span></div>
    <p class="hint-area">把下面這句話完整唸出來，系統會依發音、語調、完整度打分數（滿分 100）。</p>
    <p class="pq-sent sp-target">${esc(it.c.example)}</p>
    <p class="hint-area">${esc(it.c.example_zh)}</p>
    <div class="btn-row"><button class="btn" id="sp-demo">🔊 聽示範</button><button class="btn" id="sp-slow">🐢 慢速示範</button></div>
    ${supported ? `<button class="sp-mic" id="sp-mic"><span class="sp-mic-ico">🎤</span><span id="sp-mic-txt">按一下開始唸</span></button>
      <p class="sp-live" id="sp-live"></p>` :
      `<p class="pq-fb ng">這個瀏覽器不支援語音辨識。請用 Android 的 Chrome，或 iPhone 的 Safari 打開本網站再試。</p>`}
    <div id="sp-result"></div>
    <div class="btn-row" id="sp-nav" style="display:none">
      <button class="btn" id="sp-retry">🔁 再唸一次</button>
      <button class="btn primary" id="sp-next">${s.idx + 1 < s.items.length ? '下一句 ›' : '看總成績'}</button>
    </div>`);
  document.getElementById('sp-quit').onclick = () => { stopAll(); backTo(); };
  document.getElementById('sp-demo').onclick = () => speak(it.c.example);
  document.getElementById('sp-slow').onclick = () => speakSlow(it.c.example);
  if (!supported) return;
  document.getElementById('sp-mic').onclick = () => (active ? active.stop() : listen(s, it));
  document.getElementById('sp-retry').onclick = () => { s.pending = null; renderSpeak(s); };
  document.getElementById('sp-next').onclick = () => {
    if (s.pending) { s.scores.push(s.pending); if (s.pending.total < 80) s.wrong.push({ wordId: it.id, kind: 'sentence', input: s.pending.transcript || '(沒有聽到)', answer: it.c.example }); }
    s.pending = null; s.idx++; renderSpeak(s); window.scrollTo(0, 0);
  };
}

function speakSlow(text) {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.6;
    const v = window.speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('en'));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch (e) { speak(text); }
}

let active = null;
function stopAll() { try { active && active.abort(); } catch (e) { /* */ } active = null; }

// 麥克風音高追蹤（自相關法）；失敗就回傳 null
async function startPitch() {
  if (pitchDisabled || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const pitches = [];
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      pitches.push(detectPitch(buf, ctx.sampleRate));
    }, 40);
    return {
      pitches,
      stop() { clearInterval(timer); stream.getTracks().forEach((tr) => tr.stop()); ctx.close().catch(() => {}); },
    };
  } catch (e) { return null; }
}

function detectPitch(buf, rate) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.012) return 0; // 太小聲＝無聲
  const minLag = Math.floor(rate / 450), maxLag = Math.floor(rate / 70);
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < buf.length - lag; i++) c += buf[i] * buf[i + lag];
    if (c > best) { best = c; bestLag = lag; }
  }
  let e0 = 0;
  for (let i = 0; i < buf.length; i++) e0 += buf[i] * buf[i];
  if (!bestLag || best / e0 < 0.35) return 0; // 不夠週期性＝不是母音
  return rate / bestLag;
}

async function listen(s, it) {
  speechSynthesis.cancel();
  const btn = document.getElementById('sp-mic');
  const txt = document.getElementById('sp-mic-txt');
  const live = document.getElementById('sp-live');
  document.getElementById('sp-result').innerHTML = '';
  document.getElementById('sp-nav').style.display = 'none';

  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 5;
  active = rec;

  const pitch = await startPitch();
  let t0 = 0, t1 = 0, finalAlts = null, errored = null;
  btn.classList.add('on'); txt.textContent = '正在聽…唸完會自動停止（再按一下也能停）';

  rec.onspeechstart = () => { t0 = performance.now(); };
  rec.onspeechend = () => { t1 = performance.now(); };
  rec.onresult = (ev) => {
    const r = ev.results[ev.results.length - 1];
    live.textContent = Array.from(ev.results).map((x) => x[0].transcript).join(' ');
    if (r.isFinal) {
      finalAlts = Array.from(r).map((a) => ({ transcript: a.transcript, confidence: a.confidence }));
      if (!t1) t1 = performance.now();
    }
  };
  rec.onerror = (ev) => { errored = ev.error; };
  rec.onend = () => {
    active = null;
    if (pitch) pitch.stop();
    btn.classList.remove('on'); txt.textContent = '按一下重新唸';
    if (errored === 'not-allowed' || errored === 'service-not-allowed') {
      live.textContent = '';
      document.getElementById('sp-result').innerHTML = '<p class="pq-fb ng">麥克風沒有權限。請到瀏覽器的網站設定允許使用麥克風，再重新整理。</p>';
      return;
    }
    if (errored === 'audio-capture' && pitch) {
      // 同時開兩個麥克風可能互相干擾：之後只用辨識，請孩子再唸一次
      pitchDisabled = true;
      document.getElementById('sp-result').innerHTML = '<p class="pq-fb ng">麥克風被占用，已自動調整，請再按一次重唸。</p>';
      return;
    }
    if (errored === 'network') {
      document.getElementById('sp-result').innerHTML = '<p class="pq-fb ng">語音辨識需要連網，請確認網路後再試。</p>';
      return;
    }
    const alts = finalAlts || (live.textContent ? [{ transcript: live.textContent, confidence: 0 }] : []);
    const seconds = t0 && t1 && t1 > t0 ? (t1 - t0) / 1000 : 0;
    const res = scoreSpeech(it.c.example, alts, { seconds, pitches: pitch ? pitch.pitches : null });
    s.pending = res;
    showSpeakScore(res);
    document.getElementById('sp-nav').style.display = '';
  };
  try { rec.start(); } catch (e) { if (pitch) pitch.stop(); active = null; btn.classList.remove('on'); }
}

function bar(label, v, note = '') {
  const col = v >= 85 ? '#16a34a' : v >= 65 ? '#f59e0b' : '#dc2626';
  return `<div class="sp-bar"><span>${label}</span><div class="sp-track"><div style="width:${Math.max(2, v)}%;background:${col}"></div></div><b>${v}</b></div>${note ? `<p class="hint-area" style="margin:0 0 6px">${note}</p>` : ''}`;
}

function showSpeakScore(r) {
  const words = r.marks.map((m) => `<span class="sp-w ${m.mark}">${esc(m.word)}</span>`).join(' ');
  const tips = scoreTips(r);
  const prosNote = r.prosodySource === 'pitch' ? '' : r.prosodySource === 'rate' ? '（此裝置無法分析音高，以語速估計）' : '（以完整度估計）';
  document.getElementById('sp-result').innerHTML = `
    <div class="sp-score"><span class="sp-total">${r.total}</span><span class="hint-area">/ 100</span></div>
    <p class="sp-comment">${scoreComment(r)}</p>
    ${bar('發音', r.pronunciation)}
    ${bar('完整度', r.completeness)}
    ${bar('語調流暢', r.prosody, prosNote)}
    <p class="hint-area">系統聽到：「${esc(r.transcript) || '（沒有聽到）'}」</p>
    <p class="sp-words">${words}</p>
    <p class="hint-area"><span class="sp-w ok">綠</span>＝唸對　<span class="sp-w near">橘</span>＝有點像　<span class="sp-w miss">紅</span>＝沒唸到／不清楚</p>
    ${tips.length ? `<ul class="sp-tips">${tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}

async function renderSpeakResult(s) {
  const n = s.scores.length;
  const avg = n ? Math.round(s.scores.reduce((a, r) => a + r.total, 0) / n) : 0;
  let saved = null;
  if (n) {
    try {
      saved = await saveTestResult({
        profileId: State.profile.id, type: 'speak', name: `口說・${s.day.label}`,
        total: 100, correct: avg, wrong: s.wrong,
      });
    } catch (e) { console.warn('成績存檔失敗', e); }
  }
  const rows = s.items.map((it, i) => {
    const r = s.scores[i];
    return `<div class="row"><div class="row-main"><span class="row-word">${esc(it.e.word)}</span>
      <span class="row-zh">${esc(it.c.example)}</span></div>
      <div class="row-meta"><span>發音 ${r ? r.pronunciation : '-'}</span><span>完整 ${r ? r.completeness : '-'}</span><span>語調 ${r ? r.prosody : '-'}</span><span><b>${r ? r.total : '-'} 分</b></span></div></div>`;
  }).join('');
  $main().innerHTML = card(`
    <h2>🎤 口說測驗完成</h2>
    <p class="pq-big">${avg} 分</p>
    <p class="hint-area">${esc(s.day.label)}・${n} 句平均${saved ? '・已存到測驗中心的「成績紀錄」' : ''}</p>
    <div class="detail-list">${rows}</div>
    <p class="hint-area">分數由手機的語音辨識與音高分析估算，適合拿來練習與比較進步；不是正式考試的發音評分。</p>
    <div class="btn-row"><button class="btn" id="sr-again">🔁 再練一次</button><button class="btn primary" id="sr-back">回圖解記憶卡</button></div>`);
  document.getElementById('sr-again').onclick = () => startSpeakTest(s.day, s.cards);
  document.getElementById('sr-back').onclick = backTo;
}
