'use strict';
/* Halka overlay: the radial menu around the cursor and the clipboard shelves. */

const api = window.halka;
const ICONS = window.ICONS;
const $ = (id) => document.getElementById(id);

const state = {
  strings: {},
  settings: {},
  language: 'en',
  view: 'idle', // idle | ring | panel
  ring: 'main',
  ringStack: [],
  hot: -1,
  centerHot: false,
  cursor: { x: 0, y: 0 },
  viewport: { width: 0, height: 0 },
  center: { x: 0, y: 0 },
  clip: { kind: 'empty' },
  files: [],
  filesPending: false,
  history: [],
  held: false,
  travel: 0,
  lastPointer: null,
  openedAt: 0,
  // panel
  fromRing: false,
  filter: 'all',
  pinnedOnly: false,
  query: '',
  rows: [],
  sel: { row: 0, col: 0 },
  preview: null,
  closing: false
};

const t = (key, values = {}) => String(state.strings[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (k in values ? values[k] : `{${k}}`));

/* ------------------------------------------------------------ ring model */

const imageFiles = () => state.files.filter((f) => f.image);
const MAIN = [
  { id: 'clipboard', icon: 'clipboard', label: 'ring.clipboard', run: () => openPanel({ fromRing: true }) },
  { id: 'convert', icon: 'convert', label: 'ring.convert', sub: 'convert', needs: 'files' },
  { id: 'text', icon: 'text', label: 'ring.text', sub: 'text' },
  { id: 'translate', glyph: 'A文', label: 'ring.translate', sub: 'translate' },
  { id: 'plain', icon: 'plain', label: 'ring.plain', needs: 'clipText', action: 'plain' },
  { id: 'screenshot', icon: 'screenshot', label: 'ring.screenshot', action: 'screenshot' },
  { id: 'qr', icon: 'qr', label: 'ring.qr', needs: 'clipImage', action: 'qr' },
  { id: 'pinned', icon: 'pinned', label: 'ring.pinned', run: () => openPanel({ fromRing: true, pinnedOnly: true }) },
  { id: 'settings', icon: 'settings', label: 'ring.settings', action: 'settings' }
];
const fileItem = (kind, extra) => ({ id: kind, label: `convert.${kind}`, action: 'file', payload: { kind }, needs: 'images', ...extra });
const SUBS = {
  convert: [
    fileItem('png', { badge: 'PNG' }),
    fileItem('jpg', { badge: 'JPG' }),
    fileItem('webp', { badge: 'WEBP' }),
    fileItem('pdf', { icon: 'pdf' }),
    fileItem('ico', { badge: 'ICO' }),
    fileItem('half', { icon: 'shrink' }),
    fileItem('compress', { icon: 'compress' }),
    fileItem('zip', { icon: 'zip', needs: 'files' }),
    fileItem('copyPath', { icon: 'copyPath', needs: 'files' })
  ],
  text: [
    ['upper', 'AB'], ['lower', 'ab'], ['titleCase', 'Ab'], ['trim', '⇥'], ['json', '{ }'], ['slug', 'a-b'], ['base64', '64'], ['count', '#']
  ].map(([kind, glyph]) => ({ id: kind, label: `text.${kind}`, glyph, action: 'text', payload: { kind } })),
  translate: [
    { id: 'tText', glyph: 'A文', label: 'translate.text', action: 'translate', payload: { kind: 'text' } },
    { id: 'tImage', icon: 'image', label: 'translate.image', action: 'translate', payload: { kind: 'image' }, needs: 'anyImage' },
    { id: 'tScreen', icon: 'screenshot', label: 'translate.screen', action: 'translate', payload: { kind: 'screen' } },
    { id: 'tOcr', icon: 'scanText', label: 'translate.ocr', action: 'translate', payload: { kind: 'ocr' }, needs: 'anyImage' },
    { id: 'tOcrScreen', icon: 'screenText', label: 'translate.ocrScreen', action: 'translate', payload: { kind: 'ocrScreen' } }
  ]
};
const ringItems = () => (state.ring === 'main' ? MAIN : SUBS[state.ring]);

function unmet(item) {
  switch (item.needs) {
    case 'files': return state.files.length ? null : state.filesPending ? 'center.lookingFiles' : 'needs.files';
    case 'images': return imageFiles().length ? null : state.filesPending ? 'center.lookingFiles' : state.files.length ? 'toast.unsupported' : 'needs.files';
    case 'clipText': return ['text', 'link'].includes(state.clip.kind) ? null : 'needs.text';
    case 'clipImage': return state.clip.kind === 'image' ? null : 'needs.image';
    case 'anyImage': return state.clip.kind === 'image' || imageFiles().length ? null : state.filesPending ? 'center.lookingFiles' : 'needs.image';
    default: return null;
  }
}

/* ------------------------------------------------------------ geometry */

function radius() {
  return { small: 128, medium: 150, large: 174 }[state.settings.ringSize] || 150;
}

function geometry(n) {
  const R = radius();
  const r = Math.round(R * 0.4);
  return { R, r, n, step: (Math.PI * 2) / n, start: -Math.PI / 2 };
}

function petalPath(g, i) {
  const pad = 5; // half the rounded stroke
  const r1 = g.r + 4 + pad;
  const r2 = g.R - 4 - pad;
  const mid = g.start + i * g.step;
  const gap = pad + 2.5;
  const a1o = mid - g.step / 2 + gap / r2;
  const a2o = mid + g.step / 2 - gap / r2;
  const a1i = mid - g.step / 2 + gap / r1;
  const a2i = mid + g.step / 2 - gap / r1;
  const c = g.R;
  const P = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)} ${(c + rad * Math.sin(a)).toFixed(2)}`;
  const large = a2o - a1o > Math.PI ? 1 : 0;
  return `M ${P(r2, a1o)} A ${r2} ${r2} 0 ${large} 1 ${P(r2, a2o)} L ${P(r1, a2i)} A ${r1} ${r1} 0 ${large} 0 ${P(r1, a1i)} Z`;
}

/* -------------------------------------------------------------- sounds */

// Mechanical sounds, synthesized: a short filtered noise burst plus a metallic
// ping makes a "detent" click; activation is a two-stage switch "clack".
let audio = null;
let noise = null;
function noiseBuffer(ctx) {
  if (noise) return noise;
  noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.06), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

function click(ctx, at, { freq, q = 4, gain, decay, ping = 0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = q;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.linearRampToValueAtTime(gain, at + 0.0008);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.connect(band).connect(amp).connect(ctx.destination);
  src.start(at);
  src.stop(at + decay + 0.01);
  if (ping) {
    // A very short resonant ping gives the click its metal "tick".
    const osc = ctx.createOscillator();
    const pg = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = ping;
    pg.gain.setValueAtTime(gain * 0.35, at);
    pg.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
    osc.connect(pg).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.015);
  }
}

function tick(kind = 'tick') {
  if (!state.settings.sounds) return;
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const now = audio.currentTime + 0.002;
    if (kind === 'go') {
      click(audio, now, { freq: 1400, q: 2.5, gain: 0.32, decay: 0.022 });
      click(audio, now + 0.026, { freq: 3200, q: 3, gain: 0.22, decay: 0.016, ping: 4200 });
    } else {
      click(audio, now, { freq: 4200, q: 5, gain: 0.16, decay: 0.012, ping: 5600 });
    }
  } catch { /* audio unavailable */ }
}

/* -------------------------------------------------------------- theme */

function applyTheme(payload) {
  if (payload.strings) state.strings = payload.strings;
  if (payload.settings) state.settings = payload.settings;
  if (payload.language) state.language = payload.language;
  document.documentElement.dataset.theme = payload.theme || 'light';
  document.documentElement.dataset.accent = state.settings.accent || 'blue';
  document.documentElement.lang = state.language;
  $('search').placeholder = t('panel.search');
}

/* ------------------------------------------------------------- ring view */

function renderRing(swap = false) {
  const items = ringItems();
  const g = geometry(items.length);
  const ring = $('ring');
  ring.className = `ring ${state.settings.ringSize || 'medium'}`;
  ring.style.setProperty('--r', `${g.r}px`);
  const svg = $('ring-svg');
  svg.setAttribute('viewBox', `0 0 ${g.R * 2} ${g.R * 2}`);
  let markup = '';
  for (let i = 0; i < items.length; i++) {
    const a = g.start + (i + 0.5) * g.step;
    const x1 = g.R + (g.r + 2) * Math.cos(a);
    const y1 = g.R + (g.r + 2) * Math.sin(a);
    const x2 = g.R + (g.R - 2) * Math.cos(a);
    const y2 = g.R + (g.R - 2) * Math.sin(a);
    markup += `<line class="sep" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }
  markup += `<circle class="inner-edge" cx="${g.R}" cy="${g.R}" r="${g.r}"/>`;
  items.forEach((item, i) => {
    markup += `<path class="petal${unmet(item) ? ' disabled' : ''}" data-i="${i}" d="${petalPath(g, i)}"/>`;
  });
  svg.innerHTML = markup;

  const labels = $('ring-labels');
  labels.classList.toggle('swap', swap);
  const rm = (g.r + g.R) / 2 + 3;
  labels.innerHTML = '';
  items.forEach((item, i) => {
    const a = g.start + i * g.step;
    const el = document.createElement('div');
    el.className = `petal-label${unmet(item) ? ' disabled' : ''}`;
    el.style.left = `${g.R + rm * Math.cos(a)}px`;
    el.style.top = `${g.R + rm * Math.sin(a)}px`;
    el.style.setProperty('--i', i);
    const glyph = document.createElement('div');
    if (item.badge) { glyph.className = 'glyph badge'; glyph.textContent = item.badge; }
    else if (item.glyph) { glyph.className = 'glyph text'; glyph.textContent = item.glyph; }
    else { glyph.className = 'glyph'; glyph.innerHTML = ICONS[item.icon] || ''; }
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = t(item.label);
    el.append(glyph, name);
    labels.append(el);
  });
  if (swap) setTimeout(() => labels.classList.remove('swap'), 400);
  setHot(-1, true);
}

function contextLine() {
  if (state.filesPending) return { icon: 'files', title: t('center.lookingFiles') };
  if (state.files.length) {
    return { icon: state.files.length === 1 ? 'file' : 'files', title: state.files.length === 1 ? state.files[0].name : t('center.files', { n: state.files.length }) };
  }
  const k = state.clip.kind;
  if (k === 'image') return { icon: 'image', title: t('center.clipImage') };
  if (k === 'link') return { icon: 'link', title: t('center.clipLink') };
  if (k === 'text') return { icon: 'clipboard', title: t('center.clipText') };
  return { icon: 'halka', title: t('center.idle') };
}

function hoverDetail(item) {
  switch (item.id) {
    case 'convert': case 'zip': case 'copyPath': return state.files.length === 1 ? state.files[0].name : state.files.length ? t('center.files', { n: state.files.length }) : '';
    case 'plain': return state.clip.preview || '';
    case 'clipboard': return t('center.items', { n: state.history.length });
    case 'pinned': return t('center.items', { n: state.history.filter((h) => h.pinned).length });
    case 'qr': return t('center.clipImage');
    case 'text': return t('center.textHint');
    case 'screenshot': return 'Win + Shift + S';
    case 'translate': return t('center.translateHint');
    case 'tText': return t('center.textHint');
    case 'tImage': case 'tOcr': return imageFiles().length ? imageFiles()[0].name : t('center.clipImage');
    case 'tScreen': case 'tOcrScreen': return t('center.screenHint');
    default:
      if (item.action === 'file') return imageFiles().length === 1 ? imageFiles()[0].name : t('center.files', { n: imageFiles().length });
      return '';
  }
}

function renderCenter() {
  const icon = $('center-icon');
  const title = $('center-title');
  const sub = $('center-sub');
  const items = ringItems();
  sub.classList.remove('warn');
  $('ring-center').classList.toggle('hot', state.centerHot);
  if (state.centerHot) {
    icon.innerHTML = ICONS[state.ring === 'main' ? 'close' : 'back'];
    title.textContent = t(state.ring === 'main' ? 'ring.close' : 'ring.back');
    sub.textContent = 'Esc';
    return;
  }
  if (state.hot >= 0 && items[state.hot]) {
    const item = items[state.hot];
    const reason = unmet(item);
    icon.innerHTML = '';
    title.textContent = item.badge ? `${item.badge} · ${t(item.label)}` : t(item.label);
    if (reason) { sub.textContent = t(reason); sub.classList.add('warn'); }
    else sub.textContent = hoverDetail(item);
    return;
  }
  if (state.ring !== 'main') {
    const ctx = contextLine();
    icon.innerHTML = ICONS[ctx.icon];
    title.textContent = t(`${state.ring}.title`);
    sub.textContent = state.ring === 'convert' ? ctx.title : t('center.hintSub');
    if (state.ring === 'translate') title.textContent = t('ring.translate');
    return;
  }
  const ctx = contextLine();
  icon.innerHTML = ICONS[ctx.icon];
  title.textContent = ctx.title;
  sub.textContent = t('center.hint');
}

function setHot(index, force = false) {
  if (!force && index === state.hot) return;
  const changed = index !== state.hot;
  state.hot = index;
  document.querySelectorAll('.ring-svg .petal').forEach((el, i) => el.classList.toggle('hot', i === index));
  document.querySelectorAll('.petal-label').forEach((el, i) => el.classList.toggle('hot', i === index));
  if (changed && index >= 0) tick();
  renderCenter();
}

function setCenterHot(on) {
  if (state.centerHot === on) return;
  state.centerHot = on;
  renderCenter();
}

function placeRing() {
  const R = radius();
  const margin = 18;
  state.center = {
    x: Math.min(Math.max(state.cursor.x, R + margin), state.viewport.width - R - margin),
    y: Math.min(Math.max(state.cursor.y, R + margin), state.viewport.height - R - margin)
  };
  const ring = $('ring');
  ring.style.left = `${state.center.x}px`;
  ring.style.top = `${state.center.y}px`;
}

function showRing() {
  state.view = 'ring';
  state.ring = 'main';
  state.ringStack = [];
  $('panel').hidden = true;
  const ring = $('ring');
  ring.hidden = false;
  placeRing();
  renderRing();
  ring.classList.remove('closing');
  ring.classList.add('opening');
}

function enterSub(name) {
  state.ringStack.push(state.ring);
  state.ring = name;
  state.centerHot = false;
  tick('go');
  renderRing(true);
}

function leaveSub() {
  state.ring = state.ringStack.pop() || 'main';
  state.centerHot = false;
  renderRing(true);
}

function activate(index) {
  const item = ringItems()[index];
  if (!item) return;
  const reason = unmet(item);
  if (reason) {
    const label = document.querySelectorAll('.petal-label')[index];
    if (label) label.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 220 });
    return;
  }
  if (item.sub) return enterSub(item.sub);
  if (item.run) return item.run();
  tick('go');
  state.view = 'idle';
  api.run(item.action, item.payload || {});
}

function hitTest(x, y) {
  const dx = x - state.center.x;
  const dy = y - state.center.y;
  const d = Math.hypot(dx, dy);
  const g = geometry(ringItems().length);
  if (d < g.r) return { center: true, index: -1 };
  if (d > g.R + 90) return { center: false, index: -1 };
  let a = Math.atan2(dy, dx) - g.start + g.step / 2;
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return { center: false, index: Math.floor(a / g.step) % g.n };
}

/* ------------------------------------------------------------ panel view */

const KIND_ORDER = ['image', 'text', 'link'];
const SHELF_LABEL = { image: 'panel.images', text: 'panel.texts', link: 'panel.links' };

function filteredItems() {
  const query = state.query.trim().toLocaleLowerCase(state.language === 'tr' ? 'tr-TR' : undefined);
  return state.history.filter((item) => {
    if (state.pinnedOnly && !item.pinned) return false;
    if (state.filter !== 'all' && item.kind !== state.filter) return false;
    if (query) {
      if (!item.text) return false;
      return item.text.toLocaleLowerCase(state.language === 'tr' ? 'tr-TR' : undefined).includes(query);
    }
    return true;
  });
}

function relativeTime(ms) {
  const diff = Math.max(0, Date.now() - ms);
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('panel.justNow');
  if (m < 60) return t('panel.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('panel.hours', { n: h });
  return t('panel.days', { n: Math.floor(h / 24) });
}

function domainOf(url) {
  try { return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return url; }
}

function cardFor(item) {
  const card = document.createElement('div');
  card.className = `card ${item.kind}`;
  card.dataset.id = item.id;
  if (item.kind === 'image') {
    const img = document.createElement('img');
    img.src = `halka://thumb/${encodeURIComponent(item.id)}`;
    img.loading = 'lazy';
    img.draggable = false;
    card.append(img);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<span></span><span></span>`;
    meta.children[0].textContent = item.width && item.height ? `${item.width}×${item.height}` : '';
    meta.children[1].textContent = relativeTime(item.created);
    card.append(meta);
  } else if (item.kind === 'link') {
    const domain = domainOf(item.text.trim());
    const top = document.createElement('div');
    top.className = 'link-top';
    const fav = document.createElement('div');
    fav.className = 'favicon';
    fav.textContent = (domain[0] || '?').toUpperCase();
    const name = document.createElement('div');
    name.className = 'domain';
    name.textContent = domain;
    top.append(fav, name);
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = item.text.trim().replace(/^https?:\/\/(www\.)?/i, '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = '<span></span>';
    meta.firstChild.textContent = relativeTime(item.created);
    card.append(top, url, meta);
  } else {
    const body = document.createElement('div');
    body.className = 'text-body';
    body.textContent = item.text.length > 400 ? item.text.slice(0, 400) : item.text;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = '<span></span><span></span>';
    meta.children[0].textContent = t('panel.chars', { n: (item.length || item.text.length).toLocaleString(state.language) });
    meta.children[1].textContent = relativeTime(item.created);
    card.append(body, meta);
  }
  if (item.pinned) {
    const star = document.createElement('div');
    star.className = 'star';
    star.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg>';
    card.append(star);
  }
  card.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const pos = findPosition(item.id);
    if (pos) select(pos.row, pos.col);
  });
  card.addEventListener('dblclick', () => pasteSelected());
  return card;
}

function findPosition(id) {
  for (let row = 0; row < state.rows.length; row++) {
    const col = state.rows[row].items.findIndex((item) => item.id === id);
    if (col >= 0) return { row, col };
  }
  return null;
}

const GRID_COLUMNS = { image: 4, text: 4, link: 4 };

function buildRows() {
  const items = filteredItems();
  if (state.filter === 'all') {
    return KIND_ORDER.map((kind) => ({ kind, items: items.filter((item) => item.kind === kind).slice(0, 80) })).filter((row) => row.items.length);
  }
  const cols = GRID_COLUMNS[state.filter];
  const rows = [];
  for (let i = 0; i < items.length && i < 400; i += cols) rows.push({ kind: state.filter, items: items.slice(i, i + cols), grid: true });
  return rows;
}

function renderSegments() {
  const segments = $('segments');
  segments.innerHTML = '';
  [['all', 'panel.all'], ['image', 'panel.images'], ['text', 'panel.texts'], ['link', 'panel.links']].forEach(([key, label]) => {
    const button = document.createElement('button');
    button.textContent = t(label);
    button.className = state.filter === key ? 'on' : '';
    button.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation(); setFilter(key); });
    segments.append(button);
  });
  $('pin-filter').classList.toggle('on', state.pinnedOnly);
  $('pin-filter').title = `${t('panel.pinned')} (F)`;
}

function renderPanel(keepSelection = true) {
  const previousId = keepSelection ? selectedItem()?.id : null;
  state.rows = buildRows();
  renderSegments();
  const body = $('panel-body');
  body.innerHTML = '';
  if (!state.rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const noHistory = !state.history.length;
    empty.innerHTML = `${ICONS[noHistory ? 'clipboard' : 'search']}<strong></strong><span></span>`;
    empty.querySelector('strong').textContent = noHistory ? t('panel.empty') : t('panel.noResults');
    empty.querySelector('span').textContent = noHistory ? t('panel.emptyHint') : '';
    body.append(empty);
  } else if (state.filter === 'all') {
    state.rows.forEach((row, index) => {
      const shelf = document.createElement('div');
      shelf.className = 'shelf';
      shelf.dataset.row = index;
      const head = document.createElement('div');
      head.className = 'shelf-head';
      head.innerHTML = '<span class="shelf-title"></span><span class="shelf-count"></span>';
      head.children[0].textContent = t(SHELF_LABEL[row.kind]);
      head.children[1].textContent = row.items.length;
      const strip = document.createElement('div');
      strip.className = 'shelf-row';
      row.items.forEach((item) => strip.append(cardFor(item)));
      shelf.append(head, strip);
      body.append(shelf);
    });
  } else {
    const grid = document.createElement('div');
    grid.className = 'grid';
    state.rows.forEach((row) => row.items.forEach((item) => grid.append(cardFor(item))));
    body.append(grid);
  }
  const position = previousId ? findPosition(previousId) : null;
  if (position) state.sel = position;
  else if (!keepSelection) state.sel = { row: 0, col: 0 }; // a removed card leaves the selection where it was
  clampSelection();
  paintSelection(false);
  $('panel-foot').innerHTML = '<span class="hints"></span><span class="status"></span>';
  $('panel-foot').firstChild.textContent = t('panel.footer');
}

function clampSelection() {
  if (!state.rows.length) { state.sel = { row: 0, col: 0 }; return; }
  state.sel.row = Math.min(Math.max(0, state.sel.row), state.rows.length - 1);
  state.sel.col = Math.min(Math.max(0, state.sel.col), state.rows[state.sel.row].items.length - 1);
}

function selectedItem() {
  const row = state.rows[state.sel.row];
  return row ? row.items[state.sel.col] : null;
}

function paintSelection(scroll = true) {
  const current = selectedItem();
  document.querySelectorAll('.card').forEach((card) => card.classList.toggle('sel', current && card.dataset.id === current.id));
  document.querySelectorAll('.shelf').forEach((shelf) => shelf.classList.toggle('active', Number(shelf.dataset.row) === state.sel.row));
  document.querySelectorAll('.card .num').forEach((n) => n.remove());
  document.querySelectorAll('.card.numbered').forEach((c) => c.classList.remove('numbered'));
  // Number badges on the active shelf (1–9), like ClipBoardLine.
  if (state.filter === 'all' && state.rows[state.sel.row]) {
    const strip = document.querySelector(`.shelf[data-row="${state.sel.row}"] .shelf-row`);
    if (strip) [...strip.children].slice(0, 9).forEach((card, i) => {
      const n = document.createElement('div');
      n.className = 'num';
      n.textContent = i + 1;
      card.classList.add('numbered');
      card.append(n);
    });
  }
  if (scroll && current) {
    const el = document.querySelector(`.card[data-id="${CSS.escape(current.id)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (state.preview) openPreview();
}

function select(row, col) {
  state.sel = { row, col };
  clampSelection();
  paintSelection();
}

function moveSelection(dRow, dCol) {
  if (!state.rows.length) return;
  if (dCol) {
    const row = state.rows[state.sel.row];
    let col = state.sel.col + dCol;
    let r = state.sel.row;
    if (state.filter !== 'all') {
      // Grid: wrap across rows.
      if (col >= row.items.length && r < state.rows.length - 1) { r++; col = 0; }
      if (col < 0 && r > 0) { r--; col = state.rows[r].items.length - 1; }
    }
    return select(r, col);
  }
  select(state.sel.row + dRow, state.sel.col);
}

function setFilter(filter) {
  state.filter = filter;
  renderPanel(true);
}

function flashStatus(text) {
  const status = document.querySelector('.panel-foot .status');
  if (!status) return;
  status.textContent = text;
  clearTimeout(flashStatus.timer);
  flashStatus.timer = setTimeout(() => { status.textContent = ''; }, 1400);
}

function placePanel(origin) {
  const panel = $('panel');
  const width = 760;
  const height = 500;
  const margin = 14;
  const anchor = origin || state.cursor;
  let left = anchor.x - width / 2;
  let top = anchor.y + 18;
  if (top + height > state.viewport.height - margin) top = anchor.y - height - 18;
  if (top < margin) top = Math.max(margin, (state.viewport.height - height) / 2);
  left = Math.min(Math.max(left, margin), state.viewport.width - width - margin);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.setProperty('--ox', `${anchor.x - left}px`);
  panel.style.setProperty('--oy', `${anchor.y - top}px`);
}

function openPanel({ fromRing = false, pinnedOnly = false, query = '' } = {}) {
  state.view = 'panel';
  state.fromRing = fromRing;
  state.pinnedOnly = pinnedOnly;
  state.filter = 'all';
  state.query = query;
  state.preview = null;
  $('preview').hidden = true;
  $('panel').classList.remove('previewing');
  const ring = $('ring');
  const origin = fromRing ? { ...state.center } : null;
  ring.hidden = true;
  const panel = $('panel');
  panel.hidden = false;
  placePanel(origin);
  panel.classList.remove('closing', 'opening');
  void panel.offsetWidth;
  panel.classList.add('opening');
  const search = $('search');
  search.value = query;
  renderPanel(false);
  if (query) { search.focus(); search.setSelectionRange(query.length, query.length); }
  else search.blur();
  tick('go');
}

function backToRing() {
  $('panel').hidden = true;
  $('ring').hidden = false;
  state.view = 'ring';
  state.preview = null;
  state.held = false;
  renderRing(true);
}

async function pasteSelected(plain = false) {
  const item = selectedItem();
  if (!item) return;
  state.view = 'idle';
  await api.item(plain ? 'pastePlain' : 'paste', item.id);
}

async function copySelected() {
  const item = selectedItem();
  if (!item) return;
  await api.item('copy', item.id);
  const card = document.querySelector(`.card[data-id="${CSS.escape(item.id)}"]`);
  if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
  flashStatus('✓');
}

async function openPreview() {
  const item = selectedItem();
  const preview = $('preview');
  if (!item) { closePreview(); return; }
  state.preview = item.id;
  preview.hidden = false;
  $('panel').classList.add('previewing');
  preview.innerHTML = '';
  if (item.kind === 'image') {
    const img = document.createElement('img');
    img.src = `halka://full/${encodeURIComponent(item.id)}`;
    preview.append(img);
  } else {
    const pre = document.createElement('pre');
    pre.textContent = item.text;
    preview.append(pre);
    if ((item.length || 0) > item.text.length) {
      const full = await api.item('full', item.id);
      if (full && state.preview === item.id) pre.textContent = full;
    }
  }
}

function closePreview() {
  state.preview = null;
  $('preview').hidden = true;
  $('panel').classList.remove('previewing');
}

/* ----------------------------------------------------------- result view */

function fillLanguages() {
  const select = $('result-lang');
  const languages = state.languages || {};
  const current = state.result && state.result.target ? state.result.target : (state.settings.translateTarget === 'auto' ? state.language : state.settings.translateTarget);
  select.innerHTML = '';
  for (const [code, name] of Object.entries(languages)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    option.selected = code === current;
    select.append(option);
  }
}

function langName(code) {
  return (state.languages && state.languages[code]) || (code ? code.toUpperCase() : '');
}

function renderResult() {
  const r = state.result || {};
  const ocrOnly = Boolean(r.ocrOnly);
  $('result-title').textContent = t(ocrOnly ? 'result.ocrTitle' : 'result.title');
  $('result-from').textContent = ocrOnly ? '' : r.detected ? langName(r.detected) : '';
  $('result-lang').parentElement.hidden = ocrOnly;
  if (!ocrOnly) {
    fillLanguages();
    if (r.target) $('result-lang').value = r.target;
  }
  $('result-source').textContent = !ocrOnly && r.source ? r.source : '';
  const body = $('result-text');
  body.innerHTML = '';
  if (r.stage === 'ocr' || r.stage === 'translate') {
    const status = document.createElement('div');
    status.className = 'status';
    status.innerHTML = '<div class="spinner"></div><span></span>';
    status.lastChild.textContent = t(r.stage === 'ocr' ? 'result.reading' : 'result.translating');
    body.append(status);
    for (const width of ['92%', '78%', '60%']) { const bar = document.createElement('div'); bar.className = 'shimmer'; bar.style.width = width; body.append(bar); }
  } else if (r.stage === 'error') {
    const error = document.createElement('div');
    error.className = 'error';
    error.textContent = r.message || t('toast.failed');
    body.append(error);
  } else {
    body.textContent = r.text || '';
  }
  const done = r.stage === 'done';
  $('result-copy').disabled = !done;
  $('result-paste').disabled = !done;
  $('result-copy').innerHTML = '<span></span><kbd>Ctrl C</kbd>';
  $('result-copy').firstChild.textContent = t(ocrOnly ? 'result.copied' : 'result.copy');
  $('result-paste').innerHTML = '<span></span><kbd>↵</kbd>';
  $('result-paste').firstChild.textContent = t(r.fromSelection ? 'result.replace' : 'result.paste');
  $('result-meta').textContent = done && !ocrOnly ? (r.provider === 'deepl' ? 'DeepL' : 'Google Translate') : done && ocrOnly ? t('result.copiedHint') : '';
}

function placeResult() {
  const card = $('result');
  const width = 500;
  const height = Math.min(440, card.offsetHeight || 300);
  const margin = 14;
  let left = state.cursor.x - width / 2;
  let top = state.cursor.y + 18;
  if (top + height > state.viewport.height - margin) top = Math.max(margin, state.cursor.y - height - 18);
  left = Math.min(Math.max(left, margin), state.viewport.width - width - margin);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.style.setProperty('--ox', `${state.cursor.x - left}px`);
  card.style.setProperty('--oy', `${state.cursor.y - top}px`);
}

function openResult(result) {
  state.view = 'result';
  state.result = result || {};
  $('ring').hidden = true;
  $('panel').hidden = true;
  const card = $('result');
  card.hidden = false;
  renderResult();
  placeResult();
  card.classList.remove('closing', 'opening');
  void card.offsetWidth;
  card.classList.add('opening');
  $('result-text').focus();
}

function resultKeys(event) {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === 'Escape') { event.preventDefault(); return close(); }
  if (event.target === $('result-lang')) return;
  if (state.result.stage !== 'done') return;
  if (event.key === 'Enter') { event.preventDefault(); state.view = 'idle'; return api.run('resultPaste', {}); }
  if (ctrl && event.key.toLowerCase() === 'c' && !String(window.getSelection())) {
    event.preventDefault();
    api.run('resultCopy', {});
    $('result-meta').textContent = '✓ ' + t('toast.copied');
  }
}

$('result-copy').addEventListener('click', () => { api.run('resultCopy', {}); $('result-meta').textContent = '✓ ' + t('toast.copied'); });
$('result-paste').addEventListener('click', () => { state.view = 'idle'; api.run('resultPaste', {}); });
$('result-lang').addEventListener('change', (event) => api.run('retranslate', { target: event.target.value }));
api.onResult((result) => {
  if (state.view !== 'result') return;
  state.result = { ...state.result, ...result };
  renderResult();
  placeResult();
});

/* ------------------------------------------------------------ open/close */

function close() {
  if (state.view === 'idle' && $('ring').hidden && $('panel').hidden && $('result').hidden) { api.hidden(); return; }
  state.view = 'idle';
  const target = !$('result').hidden ? $('result') : !$('panel').hidden ? $('panel') : $('ring');
  target.classList.remove('opening');
  target.classList.add('closing');
  setTimeout(() => {
    $('ring').hidden = true;
    $('panel').hidden = true;
    $('result').hidden = true;
    api.hidden();
  }, 105);
}

api.onOpen((payload) => {
  applyTheme(payload);
  state.cursor = payload.cursor;
  state.viewport = payload.viewport;
  state.clip = payload.clipboard || { kind: 'empty' };
  state.files = [];
  state.filesPending = Boolean(payload.filesPending);
  state.history = payload.history || [];
  state.hot = -1;
  state.centerHot = false;
  state.held = payload.mode === 'ring';
  state.travel = 0;
  state.lastPointer = null;
  state.openedAt = performance.now();
  state.languages = payload.languages || state.languages;
  $('result').hidden = true;
  if (payload.mode === 'result') {
    openResult(payload.result);
  } else if (payload.mode === 'clipboard') {
    $('ring').hidden = true;
    openPanel({ fromRing: false });
  } else {
    showRing();
  }
});

api.onFiles(({ files }) => {
  state.files = files || [];
  state.filesPending = false;
  if (state.view === 'ring') {
    const hot = state.hot;
    // Refresh enabled/disabled states without replaying the entrance animation.
    document.querySelectorAll('.ring-svg .petal').forEach((el, i) => el.classList.toggle('disabled', Boolean(unmet(ringItems()[i]))));
    document.querySelectorAll('.petal-label').forEach((el, i) => el.classList.toggle('disabled', Boolean(unmet(ringItems()[i]))));
    setHot(hot, true);
  }
});

api.onHistory((history) => {
  state.history = history;
  if (state.view === 'panel') renderPanel(true);
});

api.onDismiss(() => close());
api.onSettings((payload) => { applyTheme(payload); if (state.view === 'ring') renderRing(); if (state.view === 'panel') renderPanel(true); });

/* ---------------------------------------------------------------- input */

window.addEventListener('mousemove', (event) => {
  if (state.view !== 'ring') return;
  if (state.lastPointer) state.travel += Math.hypot(event.clientX - state.lastPointer.x, event.clientY - state.lastPointer.y);
  state.lastPointer = { x: event.clientX, y: event.clientY };
  const hit = hitTest(event.clientX, event.clientY);
  setCenterHot(hit.center);
  setHot(hit.index);
});

window.addEventListener('mousedown', (event) => {
  if (state.view === 'ring') {
    event.preventDefault();
    if (event.button === 2) { state.ring === 'main' ? close() : leaveSub(); return; }
    const hit = hitTest(event.clientX, event.clientY);
    if (hit.center) { state.ring === 'main' ? close() : leaveSub(); return; }
    if (hit.index >= 0) activate(hit.index); else close();
    return;
  }
  // composedPath() is fixed when the click starts, so a button re-rendered by its own handler still counts as inside.
  if (state.view === 'panel' && !event.composedPath().includes($('panel'))) close();
  if (state.view === 'result' && !event.composedPath().includes($('result'))) close();
});
window.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('keyup', (event) => {
  if (state.view !== 'ring' || !state.held) return;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
  state.held = false;
  // Hold the shortcut, point at a slice, let go: run it (only after a real mouse gesture).
  if (state.settings.releaseToSelect && state.hot >= 0 && state.travel > 24 && performance.now() - state.openedAt > 120) activate(state.hot);
});

function ringKeys(event) {
  const items = ringItems();
  const key = event.key;
  if (key === 'Escape' || key === 'Backspace') { event.preventDefault(); return state.ring === 'main' ? close() : leaveSub(); }
  if (key === 'Enter' || key === ' ') { event.preventDefault(); if (state.hot >= 0) activate(state.hot); return; }
  const digit = /^Digit([1-9])$/.exec(event.code);
  if (digit) { const i = Number(digit[1]) - 1; if (i < items.length) { setHot(i); activate(i); } return; }
  const dirs = { ArrowUp: -90, ArrowRight: 0, ArrowDown: 90, ArrowLeft: 180 };
  if (key in dirs || key === 'Tab') {
    event.preventDefault();
    setCenterHot(false);
    if (key === 'Tab') return setHot(((state.hot < 0 ? -1 : state.hot) + (event.shiftKey ? -1 : 1) + items.length) % items.length);
    if (state.hot < 0) {
      const target = (dirs[key] * Math.PI) / 180;
      const g = geometry(items.length);
      let best = 0;
      let bestDiff = Infinity;
      items.forEach((_, i) => {
        const a = g.start + i * g.step;
        const diff = Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target)));
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      });
      return setHot(best);
    }
    const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
    return setHot((state.hot + step + items.length) % items.length);
  }
  // Typing a letter jumps straight into clipboard search.
  if (state.ring === 'main' && key.length === 1 && /\p{L}|\p{N}/u.test(key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    openPanel({ fromRing: true, query: key });
  }
}

function panelKeys(event) {
  const search = $('search');
  const inSearch = document.activeElement === search;
  const key = event.key;
  const ctrl = event.ctrlKey || event.metaKey;

  if (key === 'Escape') {
    event.preventDefault();
    if (state.preview) return closePreview();
    if (state.query) { state.query = ''; search.value = ''; search.blur(); return renderPanel(true); }
    if (inSearch) return search.blur();
    return state.fromRing ? backToRing() : close();
  }
  if (key === 'Enter') { event.preventDefault(); return pasteSelected(event.shiftKey); }
  if (key === 'ArrowDown' || key === 'ArrowUp') { event.preventDefault(); if (inSearch) search.blur(); return moveSelection(key === 'ArrowDown' ? 1 : -1, 0); }
  if (key === 'Tab') {
    event.preventDefault();
    const order = ['all', 'image', 'text', 'link'];
    return setFilter(order[(order.indexOf(state.filter) + (event.shiftKey ? 3 : 1)) % 4]);
  }
  if (inSearch) {
    if ((key === 'ArrowRight' || key === 'ArrowLeft') && !search.value) { event.preventDefault(); return moveSelection(0, key === 'ArrowRight' ? 1 : -1); }
    return; // normal typing
  }
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    event.preventDefault();
    if (ctrl) { const row = state.rows[state.sel.row]; return select(state.sel.row, key === 'ArrowRight' ? (row ? row.items.length - 1 : 0) : 0); }
    return moveSelection(0, key === 'ArrowRight' ? 1 : -1);
  }
  if (ctrl && key.toLowerCase() === 'c') { event.preventDefault(); return copySelected(); }
  if (ctrl && key.toLowerCase() === 'f') { event.preventDefault(); return search.focus(); }
  if (ctrl && key === ',') { event.preventDefault(); return api.run('settings', {}); }
  if (key === ' ') { event.preventDefault(); return state.preview ? closePreview() : openPreview(); }
  if (key === 'Delete' || (!ctrl && key.toLowerCase() === 's')) {
    event.preventDefault();
    const item = selectedItem();
    if (item) api.item('remove', item.id);
    return;
  }
  if (key.toLowerCase() === 'p' && !event.altKey) { event.preventDefault(); const item = selectedItem(); if (item) api.item('pin', item.id); return; }
  if (key.toLowerCase() === 'f' && !ctrl) { event.preventDefault(); state.pinnedOnly = !state.pinnedOnly; return renderPanel(true); }
  const digit = /^Digit([1-9])$/.exec(event.code);
  if (digit && !ctrl && state.filter === 'all') { event.preventDefault(); return select(state.sel.row, Number(digit[1]) - 1); }
  if (key.length === 1 && !ctrl && !event.altKey && /\S/.test(key)) {
    // Any other printable key starts a search.
    search.focus();
  }
}

window.addEventListener('keydown', (event) => {
  if (state.view === 'ring') return ringKeys(event);
  if (state.view === 'panel') return panelKeys(event);
  if (state.view === 'result') return resultKeys(event);
});

$('search').addEventListener('input', (event) => {
  state.query = event.target.value;
  renderPanel(false);
});
$('pin-filter').addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation(); state.pinnedOnly = !state.pinnedOnly; renderPanel(true); });

api.bootstrap().then((payload) => {
  applyTheme(payload);
  state.history = payload.history || [];
});

// Exposed for the screenshot harness only.
window.__halka = { state, openPanel, showRing, setHot, enterSub, renderRing, select, openPreview, openResult };
