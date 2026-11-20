'use strict';
const api = window.halka;
const ICONS = window.ICONS;
let ui = null;
let current = 'general';
const t = (key, values = {}) => String(ui.strings[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (k in values ? values[k] : `{${k}}`));
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child.nodeType ? child : document.createTextNode(child));
  return node;
};

const SECTIONS = [
  { id: 'general', label: 'settings.general', icon: 'settings', color: '#8e8e93' },
  { id: 'shortcut', label: 'settings.shortcut', icon: 'halka', color: '#007aff' },
  { id: 'clipboard', label: 'settings.clipboard', icon: 'clipboard', color: '#ff9500' },
  { id: 'translate', label: 'settings.translate', icon: 'scanText', color: '#5856d6' },
  { id: 'appearance', label: 'settings.appearance', icon: 'image', color: '#af52de' },
  { id: 'about', label: 'settings.about', icon: 'info', color: '#34c759' }
];
const ACCENT_SWATCH = { blue: '#007aff', purple: '#a550dc', pink: '#f7346b', red: '#ff3b30', orange: '#f58a00', yellow: '#e8b400', green: '#28b83c', graphite: '#808086' };

async function save(partial) {
  const result = await api.setSettings(partial);
  ui = { ...ui, ...result };
  apply();
  return result;
}

function toggle(key) {
  return el('label', { class: 'switch' },
    el('input', { type: 'checkbox', checked: ui.settings[key], onchange: (e) => save({ [key]: e.target.checked }) }),
    el('span'));
}

function row(label, control, hint) {
  return el('div', { class: 'row' }, el('div', {}, el('div', { class: 'label' }, label), hint ? el('div', { class: 'hint' }, hint) : null), control);
}

function select(key, options) {
  const node = el('select', { onchange: (e) => save({ [key]: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) }) },
    options.map(([value, label]) => el('option', { value, selected: String(ui.settings[key]) === String(value) }, label)));
  return node;
}

function segmented(key, options) {
  return el('div', { class: 'seg' }, options.map(([value, label]) => el('button', { class: ui.settings[key] === value ? 'on' : '', onclick: () => save({ [key]: value }) }, label)));
}

/* ------------------------------------------------------- hotkey recorder */

const CODE_NAMES = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };

function keyFromEvent(event) {
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return CODE_NAMES[code] || null;
}

function prettyKeys(accelerator) {
  if (!accelerator || accelerator === 'off') return [t('settings.off')];
  return accelerator.split('+').map((part) => ({ Control: 'Ctrl', Super: 'Win', Space: 'Space' }[part] || part));
}

function recorder(key) {
  const wrap = el('div', { class: 'recorder-wrap' });
  const button = el('button', { class: 'recorder' });
  const error = el('div', { class: 'toast-error' });
  const paint = (keys) => { button.innerHTML = ''; keys.forEach((k) => button.append(el('kbd', {}, k))); };
  paint(prettyKeys(ui.settings[key]));
  let recording = false;
  const stop = async (value) => {
    recording = false;
    button.classList.remove('recording');
    window.removeEventListener('keydown', onKey, true);
    if (value) {
      const result = await save({ [key]: value });
      if (result.rejected && result.rejected.includes(key)) {
        button.classList.add('error');
        error.textContent = t('toast.hotkeyFailed', { key: prettyKeys(value).join('+') });
        setTimeout(() => button.classList.remove('error'), 1800);
      } else error.textContent = '';
    }
    await api.recording(false);
    paint(prettyKeys(ui.settings[key]));
  };
  const onKey = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') return stop(null);
    const main = keyFromEvent(event);
    const mods = [];
    if (event.ctrlKey) mods.push('Control');
    if (event.altKey) mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    if (event.metaKey) mods.push('Super');
    paint(mods.length ? mods.map((m) => prettyKeys(m)[0]).concat(main ? [main] : ['…']) : [t('settings.record')]);
    if (!main) return;
    if (!mods.length && !/^F\d+$/.test(main)) return; // a bare letter would break normal typing
    stop([...mods, main].join('+'));
  };
  button.addEventListener('click', async () => {
    if (recording) return stop(null);
    recording = true;
    button.classList.add('recording');
    paint([t('settings.record')]);
    await api.recording(true);
    window.addEventListener('keydown', onKey, true);
  });
  wrap.append(button);
  if (key !== 'hotkey') wrap.append(el('button', { class: 'clear-key', title: t('settings.off'), html: ICONS.close, onclick: () => save({ [key]: 'off' }) }));
  else wrap.append(el('span', { class: 'clear-key', style: 'visibility:hidden' }));
  return el('div', {}, wrap, error);
}

/* --------------------------------------------------------------- sections */

function build() {
  const sections = document.getElementById('sections');
  sections.innerHTML = '';
  const s = ui.settings;

  sections.append(el('section', { id: 'sec-general' },
    el('div', { class: 'group' },
      row(t('settings.launch'), toggle('launchAtLogin')),
      row(t('settings.release'), toggle('releaseToSelect'), t('settings.releaseHint')),
      row(t('settings.sounds'), toggle('sounds')),
      row(t('settings.language'), select('language', [['auto', t('settings.languageAuto')], ['tr', 'Türkçe'], ['en', 'English']])))));

  const cheats = [
    [prettyKeys(s.hotkey).join(' + '), ui.language === 'tr' ? 'Halkayı imlecin etrafında aç' : 'Open the ring around the cursor'],
    ['← → ↑ ↓ / Tab', ui.language === 'tr' ? 'Dilimler arasında gez' : 'Move between slices'],
    ['1 – 9', ui.language === 'tr' ? 'Dilimi doğrudan çalıştır' : 'Run a slice directly'],
    ['Enter', ui.language === 'tr' ? 'Seçili dilimi çalıştır' : 'Run the highlighted slice'],
    ['A – Z', ui.language === 'tr' ? 'Yazmaya başla: panoda ara' : 'Start typing to search the clipboard'],
    ['Esc', ui.language === 'tr' ? 'Geri / kapat' : 'Back / close']
  ];
  sections.append(el('section', { id: 'sec-shortcut' },
    el('div', { class: 'group' },
      row(t('settings.hotkey'), recorder('hotkey'), t('settings.hotkeyHint')),
      row(t('settings.clipboardHotkey'), recorder('clipboardHotkey'))),
    el('div', { class: 'group-title' }, ui.language === 'tr' ? 'Halka içinde' : 'Inside Halka'),
    el('div', { class: 'group' }, el('div', { class: 'cheats' }, cheats.flatMap(([k, d]) => [el('kbd', {}, k), el('span', {}, d)])))));

  sections.append(el('section', { id: 'sec-clipboard' },
    el('div', { class: 'group' },
      row(t('settings.captureText'), toggle('captureText')),
      row(t('settings.captureImages'), toggle('captureImages')),
      row(t('settings.captureLinks'), toggle('captureLinks')),
      row(t('settings.retention'), select('retentionDays', [1, 3, 7, 15, 30, 90].map((n) => [n, t('settings.days', { n })])))),
    el('div', { class: 'note' }, t('settings.privacy')),
    el('div', { class: 'group' },
      row(t('settings.clear'), el('button', { class: 'btn danger', onclick: async (e) => { await api.clearHistory(); e.target.textContent = '✓'; } }, t('settings.clear')), t('settings.clearHint')))));

  const langs = Object.entries(ui.languages || {});
  const keyInput = el('input', { class: 'text-input', type: 'password', placeholder: 'xxxxxxxx-xxxx-…:fx', value: s.deeplKey || '', spellcheck: 'false',
    onchange: (e) => save({ deeplKey: e.target.value.trim() }) });
  sections.append(el('section', { id: 'sec-translate' },
    el('div', { class: 'group' },
      row(t('settings.translateTarget'), select('translateTarget', [['auto', t('settings.targetAuto')], ...langs])),
      row(t('settings.translateFallback'), select('translateFallback', langs), t('settings.translateFallbackHint')),
      row(t('settings.translateProvider'), segmented('translateProvider', [['google', 'Google'], ['deepl', 'DeepL']])),
      s.translateProvider === 'deepl' ? row(t('settings.deeplKey'), keyInput, t('settings.deeplKeyHint')) : null),
    el('div', { class: 'note' }, t('settings.translatePrivacy'))));

  sections.append(el('section', { id: 'sec-appearance' },
    el('div', { class: 'group' },
      row(t('settings.theme'), segmented('theme', [['system', t('settings.themeSystem')], ['light', t('settings.themeLight')], ['dark', t('settings.themeDark')]])),
      row(t('settings.accent'), el('div', { class: 'accents' }, Object.entries(ACCENT_SWATCH).map(([name, color]) => {
        const b = el('button', { class: s.accent === name ? 'on' : '', title: name, onclick: () => save({ accent: name }) });
        b.style.background = color;
        return b;
      }))),
      row(t('settings.size'), segmented('ringSize', [['small', 'S'], ['medium', 'M'], ['large', 'L']])))));

  sections.append(el('section', { id: 'sec-about' },
    el('div', { class: 'about' },
      el('img', { src: '../assets/icon.png', alt: '' }),
      el('h2', {}, 'Halka'),
      el('div', { class: 'ver' }, t('settings.version', { v: ui.version })),
      el('p', {}, t('settings.aboutText')),
      el('button', { class: 'btn', onclick: () => api.openData() }, t('settings.data')))));

  show(current);
}

function show(id) {
  current = SECTIONS.some((s) => s.id === id) ? id : 'general';
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === `sec-${current}`));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.id === current));
  document.getElementById('section-title').textContent = t(SECTIONS.find((s) => s.id === current).label);
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  for (const section of SECTIONS) {
    const icon = el('span', { class: 'nav-icon', html: ICONS[section.icon] });
    icon.style.background = section.color;
    nav.append(el('button', { 'data-id': section.id, onclick: () => show(section.id) }, icon, t(section.label)));
  }
}

function apply() {
  document.documentElement.dataset.theme = ui.theme;
  document.documentElement.dataset.accent = ui.settings.accent;
  document.documentElement.lang = ui.language;
  document.title = `Halka — ${t('settings.title')}`;
  buildNav();
  build();
}

document.getElementById('btn-close').addEventListener('click', () => api.closeWindow());
document.getElementById('btn-min').addEventListener('click', () => api.minimizeWindow());
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.recorder.recording')) api.closeWindow(); });
api.onSection((id) => show(id));
api.onSettings((payload) => { ui = { ...ui, ...payload }; apply(); });

api.getSettings().then((payload) => {
  ui = payload;
  current = location.hash.replace('#', '') || 'general';
  apply();
});
