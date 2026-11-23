import { CONFIG } from './config.js';
import { SAMPLES } from './samples.js';
import {
  detectWithRules, sanitizeModelEntities, mergeEntities, buildShield, restore, leakCheck, byteLength, segment,
} from './privacy.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  tab: 'photo',
  image: null, // {base64, mimeType, url}
  text: '',
  entities: [],
  shield: null,
  guide: null, // raw (tokenized) guide from the model
  view: 'you',
  stats: { shielded: 0, rawBytes: 0, sentBytes: 0, device: 0, cloud: 0 },
};

let engine = null;
let engineError = null;

// ---------- boot ----------
init();

async function init() {
  renderSamples();
  wireUI();
  updateNet();
  const mock = new URLSearchParams(location.search).has('mock');
  try {
    if (mock) engine = await (await import('./mock.js')).createMockEngine();
    else {
      if (CONFIG.firebase.apiKey === 'REPLACE_ME') throw new Error('Add your Firebase config in config.js');
      engine = await (await import('./ai.js')).createEngine(CONFIG);
    }
    log('rules', `Firebase AI Logic ready · cloud model: ${engine.cloudModel}`);
  } catch (e) {
    engineError = e;
    log('err', `AI engine not available: ${e.message}`);
  }
  refreshDevice();
}

async function refreshDevice() {
  const pill = $('#devicePill');
  if (!engine) { setPill(pill, 'bad', 'On-device AI: engine offline'); return 'unavailable'; }
  const s = await engine.deviceStatus();
  const map = {
    available: ['ok', '● Gemini Nano ready'],
    downloadable: ['warn', '⬇ Enable on-device AI'],
    downloading: ['warn', '⬇ Gemini Nano downloading…'],
    unavailable: ['bad', 'On-device AI unavailable'],
    unsupported: ['bad', 'On-device AI: needs Chrome 139+'],
  };
  const [cls, label] = map[s] || ['bad', s];
  setPill(pill, cls, label);
  pill.dataset.status = s;
  return s;
}

function setPill(el, cls, text) {
  el.className = `pill ${cls}`;
  el.textContent = text;
}

function updateNet() {
  const online = navigator.onLine;
  setPill($('#netPill'), online ? 'ok' : 'warn', online ? '☁ Cloud: online' : '✈ Offline: device only');
}

// ---------- UI wiring ----------
function wireUI() {
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);

  $('#devicePill').addEventListener('click', async () => {
    const s = $('#devicePill').dataset.status;
    if (s !== 'downloadable' && s !== 'downloading') return;
    try {
      await engine.prepareDevice((p) => setPill($('#devicePill'), 'warn', `⬇ Gemini Nano ${Math.round(p * 100)}%`));
      log('device', 'Gemini Nano downloaded and ready on this device');
    } catch (e) {
      log('err', `Could not prepare on-device model: ${e.message}`);
    }
    refreshDevice();
  });

  $$('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

  const drop = $('#drop');
  $('#fileInput').addEventListener('change', (e) => e.target.files[0] && loadImage(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('drag');
    if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
  });

  $('#decodeBtn').addEventListener('click', startShield);
  $('#explainBtn').addEventListener('click', explain);
  $('#backBtn').addEventListener('click', () => show('input'));
  $('#newBtn').addEventListener('click', resetAll);
  $('#deviceOnly').addEventListener('change', () => {
    const on = $('#deviceOnly').checked;
    log('device', on ? 'Privacy mode ON: every step now runs on this device' : 'Hybrid mode: explanations may use the cloud (redacted only)');
    updateCloudTag();
  });

  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#addInput').value.trim();
    if (!v) return;
    if (!state.text.toLowerCase().includes(v.toLowerCase())) return toast('That text is not in the document.');
    state.entities = mergeEntities(state.entities, [{ text: v, type: 'OTHER', source: 'you' }]);
    $('#addInput').value = '';
    log('device', `You hid "${mask(v)}"`);
    renderShield();
  });

  $$('.seg').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    $$('.seg').forEach((x) => x.classList.toggle('active', x === b));
    renderGuide();
  }));

  $('#copyReply').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('#reply').textContent);
    toast('Reply copied, with your real details filled in on this device.');
  });
  $('#speakBtn').addEventListener('click', speak);
  $('#askForm').addEventListener('submit', ask);
}

function setTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.tabpane').forEach((p) => (p.hidden = p.dataset.pane !== tab));
}

function renderSamples() {
  const list = $('#sampleList');
  for (const s of SAMPLES) {
    const b = document.createElement('button');
    b.className = 'sample';
    b.textContent = `${s.icon} ${s.label}`;
    b.addEventListener('click', () => {
      setTab('text');
      $('#docText').value = s.text;
      state.image = null;
    });
    list.appendChild(b);
  }
}

async function loadImage(file) {
  if (!/image\/(png|jpeg)/.test(file.type)) return toast('Please use a PNG or JPEG image.');
  const { base64, url } = await downscale(file, 1280);
  state.image = { base64, mimeType: 'image/jpeg', url };
  const img = $('#preview');
  img.src = url;
  img.hidden = false;
  $('#dropText').hidden = true;
}

function downscale(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.9);
      resolve({ base64: url.split(',')[1], url });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function show(which) {
  $('#inputCard').hidden = which !== 'input';
  $('#shieldCard').hidden = which !== 'shield';
  $('#resultCard').hidden = which !== 'result';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetAll() {
  state.image = null; state.text = ''; state.entities = []; state.shield = null; state.guide = null;
  $('#docText').value = '';
  $('#preview').hidden = true; $('#dropText').hidden = false; $('#fileInput').value = '';
  $('#qa').innerHTML = '';
  $$('#pipeline li').forEach((li) => { li.className = ''; li.querySelector('em').textContent = ''; });
  show('input');
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="spinner"></span>${label}`; }
  else if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
}

// ---------- pipeline ----------
function step(name, status, source) {
  const li = $(`#pipeline li[data-step="${name}"]`);
  li.className = status;
  const em = li.querySelector('em');
  if (source) {
    em.textContent = source === 'IN_CLOUD' ? '☁ CLOUD' : source === 'ON_DEVICE' ? '● DEVICE' : source;
    em.className = `src-${source}`;
  }
}

async function startShield() {
  const btn = $('#decodeBtn');
  busy(btn, true, 'Shielding on device…');
  try {
    // 1. READ
    if (state.tab === 'photo') {
      if (!state.image) return toast('Add a photo first, or try a sample.');
      if (!engine) throw engineError || new Error('AI engine not ready');
      step('read', 'run');
      try {
        const r = await engine.readImage(state.image.base64, state.image.mimeType);
        state.text = r.text.trim();
        countCall(r.source);
        step('read', 'done', r.source);
        log('device', `Read the image on-device in ${r.ms} ms. Image never uploaded.`, r.source);
      } catch (e) {
        step('read', 'skip');
        log('err', `On-device reading failed: ${e.message}`);
        toast('Reading photos needs Gemini Nano on this device, so your image never leaves it. Paste the text instead, or enable on-device AI.');
        return;
      }
    } else {
      state.text = $('#docText').value.trim();
      if (state.text.length < 20) return toast('Paste a bit more of the document, or try a sample.');
      step('read', 'done', 'TEXT');
    }

    // 2. SHIELD: rules (always) + Gemini Nano (when available)
    step('shield', 'run');
    const t0 = performance.now();
    const ruleHits = detectWithRules(state.text);
    log('rules', `Pattern rules found ${ruleHits.length} identifiers in ${Math.round(performance.now() - t0)} ms`);
    let modelHits = [];
    let shieldSource = 'RULES';
    const deviceReady = engine && (await engine.deviceStatus()) === 'available';
    if (engine && !deviceReady) log('err', 'Gemini Nano not downloaded yet (tap the status pill). Using pattern rules only for now.');
    if (deviceReady) {
      try {
        const r = await engine.detectEntities(state.text);
        modelHits = sanitizeModelEntities(state.text, r.entities);
        countCall(r.source);
        shieldSource = r.source;
        log('device', `Gemini Nano found ${modelHits.length} personal details in ${r.ms} ms`, r.source);
      } catch (e) {
        log('err', `Gemini Nano unavailable (${e.message}). Using pattern rules only.`);
      }
    }
    state.entities = mergeEntities(ruleHits, modelHits).map((e) => ({ ...e, enabled: true }));
    step('shield', 'done', shieldSource);
    renderShield();
    show('shield');
  } catch (e) {
    log('err', e.message);
    toast(e.message);
  } finally {
    busy(btn, false);
  }
}

function renderShield() {
  state.shield = buildShield(state.text, state.entities);
  const active = new Set(state.shield.items.map((i) => i.text.toLowerCase()));
  const chips = $('#chips');
  chips.innerHTML = '';
  const shown = state.entities.filter((e) => e.enabled === false || active.has(e.text.toLowerCase()));
  for (const e of shown) {
    const c = document.createElement('button');
    c.className = `chip ${e.enabled === false ? 'off' : ''}`;
    const src = e.source === 'on-device' ? 'Nano' : e.source === 'both' ? 'Nano + rules' : e.source;
    c.innerHTML = `<span class="ty">${e.type}</span>${esc(e.text)}<span class="src">${esc(src)}</span>`;
    c.title = e.enabled === false ? 'Will be sent as-is. Tap to hide.' : 'Hidden. Tap to keep visible.';
    c.addEventListener('click', () => { e.enabled = e.enabled === false; renderShield(); });
    chips.appendChild(c);
  }
  $('#originalView').innerHTML = highlight(state.text, state.shield.items, false, 'mark');
  $('#redactedView').innerHTML = highlight(state.shield.redacted, state.shield.items, true, 'tok');
  const n = state.shield.items.length;
  $('#shieldMeta').textContent = `${n} detail${n === 1 ? '' : 's'} hidden`;
  updateCloudTag();
}

function updateCloudTag() {
  const local = $('#deviceOnly').checked || !navigator.onLine;
  $('#cloudSeesTag').textContent = local ? 'nothing sent, private mode' : 'only this is sent';
  $('#explainBtn').textContent = local ? 'Explain on this device →' : 'Send redacted text & explain →';
}

async function explain() {
  const btn = $('#explainBtn');
  if (!engine) return toast('AI engine not ready. Check config.js.');
  const { redacted, vault, items } = state.shield;
  const leaks = leakCheck(redacted, vault);
  if (leaks.length) return toast('Safety check failed. A personal detail is still present.'); // should never happen
  busy(btn, true, 'Explaining…');
  step('explain', 'run');
  try {
    const deviceOnly = $('#deviceOnly').checked;
    const r = await engine.explain(redacted, $('#language').value, { deviceOnly });
    state.guide = r.data;
    if (r.fallbackReason) log('err', `Cloud unavailable (${r.fallbackReason.slice(0, 300)}). Fell back to Gemini Nano on-device.`);
    countCall(r.source);
    state.stats.shielded += items.length;
    if (r.source === 'IN_CLOUD') state.stats.sentBytes += r.sentBytes;
    step('explain', 'done', r.source);
    log(r.source === 'IN_CLOUD' ? 'cloud' : 'device',
      r.source === 'IN_CLOUD'
        ? `Gemini (${r.model || 'cloud'}) explained the redacted text in ${r.ms} ms · ${fmtBytes(r.sentBytes)} sent, 0 B personal`
        : `Gemini Nano explained it on-device in ${r.ms} ms · nothing sent`, r.source);
    if (r.language !== $('#language').value) log('device', `On-device mode answers in English. Switch privacy mode off for ${$('#language').value}.`);

    // 4. RESTORE locally
    step('restore', 'run');
    const t0 = performance.now();
    restore(state.guide, vault); // warm path for timing
    step('restore', 'done', 'ON_DEVICE');
    log('device', `Put your real details back into the answer on-device in ${Math.round(performance.now() - t0)} ms`);
    state.view = 'you';
    $$('.seg').forEach((x) => x.classList.toggle('active', x.dataset.view === 'you'));
    renderGuide();
    renderStats();
    show('result');
  } catch (e) {
    step('explain', 'skip');
    log('err', `Explain failed: ${e.message}`);
    toast(`Could not explain: ${e.message}`);
  } finally {
    busy(btn, false);
    updateCloudTag();
  }
}

function renderGuide() {
  const g = state.guide;
  if (!g) return;
  const { vault, items } = state.shield;
  const cloudView = state.view === 'cloud';
  // Text in "your view" is restored locally; restored values get a subtle highlight.
  const R = (s) => (cloudView ? highlight(s || '', items, true, 'tok') : highlight(restore(s || '', vault), items, false, 'restored'));

  $('#docType').innerHTML = R(g.docType || 'Your document');
  const u = (g.urgency || 'medium').toLowerCase();
  $('#urgency').className = `urgency ${u}`;
  $('#urgency').textContent = `${u} urgency`;
  $('#summary').innerHTML = R(g.summary);
  $('#urgencyReason').innerHTML = R(g.urgencyReason);
  $('#actions').innerHTML = (g.actions || []).map((a) =>
    `<li>${R(a.task)}${a.deadline ? ` <span class="when">⏰ ${R(a.deadline)}</span>` : ''}${a.why ? `<span class="why">${R(a.why)}</span>` : ''}</li>`).join('');
  $('#facts').innerHTML = (g.keyFacts || []).map((f) =>
    `<div><dt>${R(f.label)}</dt><dd>${R(f.value)}${f.meaning ? `<small>${R(f.meaning)}</small>` : ''}</dd></div>`).join('');
  const flags = g.redFlags || [];
  $('#flagsWrap').hidden = !flags.length;
  $('#flags').innerHTML = flags.map((f) => `<li>${R(f)}</li>`).join('');
  $('#questions').innerHTML = (g.questions || []).map((q) => `<li>${R(q)}</li>`).join('');
  $('#replyWrap').hidden = !g.replyDraft;
  $('#reply').innerHTML = R(g.replyDraft);
  $('#copyReply').hidden = cloudView;
}

async function ask(e) {
  e.preventDefault();
  const q = $('#askInput').value.trim();
  if (!q || !state.guide) return;
  const { redacted, vault, items } = state.shield;
  // The question itself is shielded too, using the same vault.
  const qShield = buildShield(q, state.entities);
  let qRedacted = qShield.redacted;
  for (const [tok, val] of Object.entries(qShield.vault)) {
    const existing = Object.entries(vault).find(([, v]) => v.toLowerCase() === val.toLowerCase());
    if (existing) qRedacted = qRedacted.split(tok).join(existing[0]);
  }
  const btn = $('#askForm button');
  busy(btn, true, '…');
  try {
    const r = await engine.ask(redacted, state.guide, qRedacted, $('#language').value, { deviceOnly: $('#deviceOnly').checked });
    countCall(r.source);
    if (r.source === 'IN_CLOUD') state.stats.sentBytes += r.sentBytes;
    const div = document.createElement('div');
    div.className = 'qa';
    div.innerHTML = `<div class="q">${esc(q)} <em class="src-${r.source}" style="font-style:normal;font-size:11px">${r.source === 'IN_CLOUD' ? '☁ cloud' : '● device'}</em></div>
      <div class="a">${highlight(restore(r.text, vault), items, false, 'restored')}</div>`;
    $('#qa').appendChild(div);
    $('#askInput').value = '';
    log(r.source === 'IN_CLOUD' ? 'cloud' : 'device', `Answered a follow-up ${r.source === 'IN_CLOUD' ? 'in the cloud (redacted context)' : 'on-device'} in ${r.ms} ms`, r.source);
    renderStats();
  } catch (err) {
    log('err', `Ask failed: ${err.message}`);
    toast(err.message);
  } finally {
    busy(btn, false);
  }
}

function speak() {
  if (!('speechSynthesis' in window)) return toast('Speech is not supported in this browser.');
  speechSynthesis.cancel();
  const text = $('#summary').textContent + ' ' + $$('#actions li').map((li) => li.textContent).join('. ');
  const u = new SpeechSynthesisUtterance(text);
  const codes = { English: 'en-IN', Telugu: 'te-IN', Hindi: 'hi-IN', Tamil: 'ta-IN', Kannada: 'kn-IN', Malayalam: 'ml-IN', Marathi: 'mr-IN', Bengali: 'bn-IN', Spanish: 'es-ES' };
  u.lang = codes[$('#language').value] || 'en-IN';
  speechSynthesis.speak(u);
}

// ---------- ledger ----------
function countCall(source) {
  if (source === 'IN_CLOUD') state.stats.cloud++;
  else if (source === 'ON_DEVICE') state.stats.device++;
  renderStats();
}

function renderStats() {
  const s = state.stats;
  $('#statShielded').textContent = s.shielded;
  $('#statRaw').textContent = fmtBytes(s.rawBytes);
  $('#statSent').textContent = fmtBytes(s.sentBytes);
  $('#statSplit').textContent = `${s.device} / ${s.cloud}`;
}

function log(kind, msg, source) {
  const li = document.createElement('li');
  const cls = source === 'IN_CLOUD' ? 'cloud' : source === 'ON_DEVICE' ? 'device' : kind;
  li.className = cls;
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<time>${t}</time>${esc(msg)}`;
  $('#log').prepend(li);
}

// ---------- helpers ----------
function highlight(text, items, useTokens, cls) {
  return segment(text, items, useTokens)
    .map((s) => {
      if (!s.item) return esc(s.text);
      const tag = cls === 'mark' ? 'mark' : 'span';
      const title = useTokens ? `Placeholder for a ${s.item.type.toLowerCase()} kept on your device` : `${s.item.type}: hidden from the cloud, restored on your device`;
      return `<${tag} class="${cls}" title="${esc(title)}">${esc(s.text)}</${tag}>`;
    })
    .join('');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mask(v) {
  return v.length <= 4 ? '••••' : v.slice(0, 2) + '•'.repeat(Math.min(6, v.length - 2));
}

function fmtBytes(n) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4500);
}
