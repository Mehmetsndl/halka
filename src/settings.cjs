'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  hotkey: 'Control+Alt+Space',
  clipboardHotkey: 'Control+Alt+T',
  releaseToSelect: true,
  launchAtLogin: true,
  sounds: true,
  language: 'auto',
  theme: 'system',
  accent: 'blue',
  ringSize: 'medium',
  captureText: true,
  captureImages: true,
  captureLinks: true,
  retentionDays: 30,
  paused: false,
  translateTarget: 'auto',
  translateFallback: 'en',
  translateProvider: 'google',
  deeplKey: '',
  welcomed: false
});

const ACCENTS = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'];

function sanitize(input) {
  const out = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof DEFAULTS[key] === 'boolean') out[key] = Boolean(value);
    else if (typeof DEFAULTS[key] === 'number') out[key] = Number.isFinite(Number(value)) ? Number(value) : DEFAULTS[key];
    else if (typeof value === 'string') out[key] = value;
  }
  if (!['auto', 'tr', 'en'].includes(out.language)) out.language = 'auto';
  if (!['system', 'light', 'dark'].includes(out.theme)) out.theme = 'system';
  if (!ACCENTS.includes(out.accent)) out.accent = 'blue';
  if (!['small', 'medium', 'large'].includes(out.ringSize)) out.ringSize = 'medium';
  if (![1, 3, 7, 15, 30, 90].includes(out.retentionDays)) out.retentionDays = 30;
  if (!['google', 'deepl'].includes(out.translateProvider)) out.translateProvider = 'google';
  out.deeplKey = out.deeplKey.slice(0, 200);
  return out;
}

class Settings {
  constructor(directory) {
    this.file = path.join(directory, 'settings.json');
    try { this.values = sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { this.values = sanitize(null); }
  }

  get(key) { return this.values[key]; }

  all() { return { ...this.values }; }

  update(partial) {
    this.values = sanitize({ ...this.values, ...partial });
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    } catch (error) { console.error('[halka] settings not saved', error); }
    return this.all();
  }
}

module.exports = { Settings, DEFAULTS, ACCENTS, sanitize };
