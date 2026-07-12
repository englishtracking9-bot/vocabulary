// wordcard.js — 單字卡渲染（例句、多義、字根拆解、發音）（自 app.js 原樣搬出，G1 拆分）

import { rootFamilyOf } from './grouping.js';
import { fetchDict, speak } from './lookup.js';
import { lookupTermNavigate } from './lookupui.js';
import { openWordDetail } from './mywords.js';
import { State } from './state.js';
import { esc } from './util.js';
import { getById } from './vocab.js';


// ============================================================
// 單字卡（共用）
// ============================================================
// 把英文句子拆成「可點的單字 + 原樣標點空白」。點字會去掉標點與大小寫再查。
function exampleHTML(sentence) {
  const s = sentence || '';
  let out = '';
  let last = 0;
  const re = /[A-Za-z][A-Za-z'’-]*/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out += esc(s.slice(last, m.index)); // 中間的標點／空白原樣保留
    const word = m[0];
    const clean = word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
    out += clean
      ? `<span class="ex-word" data-look="${esc(clean)}">${esc(word)}</span>`
      : esc(word);
    last = m.index + word.length;
  }
  out += esc(s.slice(last));
  return out;
}

// 一個義項的顯示：詞性＋中文＋例句（可點字）＋中文翻譯＋🔊
function senseBlockHTML(s, idx, multi) {
  const head = `<div class="sense-head">${multi ? `<span class="sense-no">${idx + 1}</span>` : ''}${s.pos ? `<span class="pos">${esc(s.pos)}</span>` : ''}<span class="sense-zh">${esc(s.zh || '')}</span></div>`;
  const ex = s.example
    ? `<div class="ex-en">${exampleHTML(s.example)} <button class="btn icon" data-say="${esc(s.example)}">🔊</button></div>${s.example_zh ? `<div class="ex-zh">${esc(s.example_zh)}</div>` : ''}`
    : '';
  return `<div class="sense">${head}${ex}</div>`;
}

function cardHTML(entry, dict) {
  const phon = (dict && dict.phonetic) ? `<span class="phon">${esc(dict.phonetic)}</span>` : '';
  // J-2：多義顯示。本機字用已存的 senses；自訂字/無 senses 退回單一中文＋例句
  const senses = Array.isArray(entry.senses) ? entry.senses.filter((s) => s && (s.zh || s.example)) : [];
  let meaningsHTML;
  if (senses.length) {
    const multi = senses.length > 1;
    meaningsHTML = `<div class="senses">${senses.slice(0, 3).map((s, i) => senseBlockHTML(s, i, multi)).join('')}</div>`;
  } else {
    let examples = '';
    if (entry.example && entry.example.trim()) {
      examples = `<div class="examples"><b>例句</b>
        <div class="ex-en">${exampleHTML(entry.example)} <button class="btn icon" data-say="${esc(entry.example)}">🔊</button></div>
        ${entry.example_zh ? `<div class="ex-zh">${esc(entry.example_zh)}</div>` : ''}</div>`;
    } else if (dict && dict.examples && dict.examples.length) {
      examples = `<div class="examples"><b>例句</b><ul>${dict.examples.map((x) => `<li>${exampleHTML(x)}</li>`).join('')}</ul></div>`;
    }
    meaningsHTML = `<div class="zh">${esc(entry.zh) || '（尚無中文，可在下方補上）'}</div>${examples}`;
  }
  const note = entry.note ? `<div class="note">補充（相關詞）：${esc(entry.note)}</div>` : '';
  const customTag = entry.custom ? `<span class="tag-custom">🔖 我查的字</span>` : '';
  const definition = (entry.custom && entry.definition)
    ? `<div class="def">釋義：${esc(entry.definition)}</div>` : '';
  let root = '';
  if (Array.isArray(entry.root) && entry.root.length) {
    const seg = entry.root.map((p) => `<b>${esc(p.part)}</b>(${esc(p.mean)})`).join(' + ');
    const eq = `<b>${esc(entry.word)}</b>${entry.zh ? '（' + esc(entry.zh) + '）' : ''}`;
    root = `<div class="root">🔧 字根拆解：${seg} = ${eq}</div>`;
  } else if (typeof entry.root === 'string' && entry.root) {
    root = `<div class="root">🔧 字根拆解：${esc(entry.root)}</div>`;
  }
  // F-3：可念音節（僅當各部位剛好拼回單字才顯示）
  const syllable = entry.syllable
    ? `<div class="syllable">🔡 照音節拼：<b>${esc(entry.syllable)}</b></div>` : '';
  // F-1：記憶聯想
  const mnemonic = entry.mnemonic
    ? `<div class="mnemonic">🧠 記憶聯想：${esc(entry.mnemonic)}</div>` : '';
  // 同字根家族（最多 8 個，可點）；F-2：已學會的字標成錨點
  let family = '';
  const fam = rootFamilyOf(entry.id).slice(0, 8);
  if (fam.length) {
    let anyLearned = false;
    const chips = fam.map((id) => {
      const fe = getById(id);
      if (!fe) return '';
      const learned = State.masteredIds && State.masteredIds.has(id);
      if (learned) anyLearned = true;
      return `<span class="fam-chip ${learned ? 'learned' : ''}" data-fam="${id}">${learned ? '✓ ' : ''}${esc(fe.word)}</span>`;
    }).join('');
    const hint = anyLearned ? '<div class="fam-hint">✓ 是你已學會的字，用它來記住同字根的新字</div>' : '';
    family = `<div class="family"><b>同字根家族</b><div class="fam-chips">${chips}</div>${hint}</div>`;
  }
  const levelLabel = entry.level === 0 ? '我查的字' : `Level ${entry.level}`;
  // 多義時上方只顯示級別（詞性已在各義項標出）；單義則沿用「詞性・級別」
  const posLine = senses.length
    ? levelLabel
    : `${esc(entry.pos) || ''}${entry.pos ? '・' : ''}${levelLabel}`;
  const moreBtn = `<div class="btn-row"><button class="btn" data-more="${esc(entry.word)}">📖 其他意思（上網查）</button></div>`;
  return `
    <div class="card word-card">
      <div class="word-head">
        <span class="word-en">${esc(entry.word)}</span>
        <button class="btn icon" data-say="${esc(entry.answerKeys[0])}">🔊</button>
        ${customTag}
      </div>
      ${phon}
      <div class="pos">${posLine}</div>
      ${definition}
      ${note}
      ${meaningsHTML}
      ${root}
      ${syllable}
      ${mnemonic}
      ${family}
      ${moreBtn}
    </div>`;
}

function attachCardHandlers(entry) {
  document.querySelectorAll('[data-say]').forEach((b) => {
    b.onclick = () => speak(b.dataset.say);
  });
  // 同字根家族：點一個字 → 開該字卡
  document.querySelectorAll('[data-fam]').forEach((c) => {
    c.onclick = () => openWordDetail(c.dataset.fam);
  });
  // 例句裡的單字：點 → 走查單字流程
  document.querySelectorAll('[data-look]').forEach((w) => {
    w.onclick = () => lookupTermNavigate(w.dataset.look);
  });
  // 📖 其他意思（上網查）
  document.querySelectorAll('[data-more]').forEach((b) => {
    b.onclick = () => showMoreSenses(b.dataset.more, b);
  });
}

// J-2：點「其他意思」→ 上網查 dictionaryapi.dev 顯示更多義項（不寫進檔案；離線友善提示）
async function showMoreSenses(word, btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '查詢中…';
  const dict = await fetchDict(word.replace(/\(.*?\)/g, '').trim());
  const box = document.createElement('div');
  box.className = 'more-senses';
  if (!dict || (!(dict.defs && dict.defs.length) && !(dict.examples && dict.examples.length))) {
    box.innerHTML = navigator.onLine
      ? '<p class="hint-area">線上字典沒有更多義項。</p>'
      : '<p class="hint-area">目前離線，無法查更多義項。</p>';
  } else {
    const defs = (dict.defs || []).map((d) =>
      `<div class="sense"><div class="sense-head">${d.pos ? `<span class="pos">${esc(d.pos)}</span>` : ''}<span class="sense-zh">${esc(d.def)}</span></div></div>`).join('');
    const exs = (dict.examples && dict.examples.length)
      ? `<div class="hint-area">例句：</div>${dict.examples.map((x) => `<div class="ex-en">${exampleHTML(x)}</div>`).join('')}`
      : '';
    box.innerHTML = `<div class="more-title">📖 更多義項（線上字典，英文釋義）</div>${defs}${exs}`;
  }
  btn.replaceWith(box);
  box.querySelectorAll('[data-look]').forEach((w) => { w.onclick = () => lookupTermNavigate(w.dataset.look); });
}
export { exampleHTML, senseBlockHTML, cardHTML, attachCardHandlers, showMoreSenses };
