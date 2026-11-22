'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HistoryStore, classifyText } = require('../src/store.cjs');
const textTools = require('../src/text-tools.cjs');
const fileTools = require('../src/file-tools.cjs');
const { sanitize, DEFAULTS } = require('../src/settings.cjs');
const locales = require('../src/locales.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'halka-test-'));

test('links and text are told apart', () => {
  assert.equal(classifyText('https://github.com/orkunisitmak/nashi-app'), 'link');
  assert.equal(classifyText('  www.example.com/a  '), 'link');
  assert.equal(classifyText('see https://example.com for details'), 'text');
  assert.equal(classifyText('hello'), 'text');
});

test('re-copying text refreshes one card instead of duplicating', () => {
  const store = new HistoryStore(tmp());
  store.addText('alpha');
  store.addText('beta');
  store.addText('alpha');
  assert.deepEqual(store.items.map((i) => i.text), ['alpha', 'beta']);
});

test('pinned items survive retention and clearing', () => {
  const store = new HistoryStore(tmp(), { retentionDays: 1, maxItems: 2 });
  const keep = store.addText('keep me');
  store.togglePin(keep.id);
  store.addText('a'); store.addText('b'); store.addText('c');
  assert.equal(store.items.filter((i) => !i.pinned).length, 2, 'maxItems caps unpinned items');
  store.items.forEach((i) => { if (!i.pinned) i.created = Date.now() - 3 * 86_400_000; });
  store.prune();
  assert.deepEqual(store.items.map((i) => i.text), ['keep me']);
  store.addText('temp');
  store.clear(true);
  assert.deepEqual(store.items.map((i) => i.text), ['keep me']);
});

test('history persists to disk and images are deduplicated', () => {
  const dir = tmp();
  const store = new HistoryStore(dir);
  const png = Buffer.from('fake-png-bytes');
  const a = store.addImage(png, Buffer.from('t'), { width: 2, height: 2 });
  const b = store.addImage(png, Buffer.from('t'), { width: 2, height: 2 });
  assert.equal(a.id, b.id);
  assert.ok(fs.existsSync(store.imagePath(a)));
  store.addText('saved');
  store.flush();
  const again = new HistoryStore(dir);
  assert.equal(again.items.length, 2);
  again.remove(a.id);
  assert.equal(again.get(a.id), null);
});

test('Turkish-aware casing', () => {
  assert.equal(textTools.transform('upper', 'istanbul ışık', 'tr'), 'İSTANBUL IŞIK');
  assert.equal(textTools.transform('lower', 'İSTANBUL IŞIK', 'tr'), 'istanbul ışık');
  assert.equal(textTools.transform('titleCase', 'çok güzel bir gün', 'tr'), 'Çok Güzel Bir Gün');
  assert.equal(textTools.transform('upper', 'istanbul', 'en'), 'ISTANBUL');
});

test('text transforms', () => {
  assert.equal(textTools.transform('slug', 'Şişli’de Güzel Çay & Börek!'), 'sisli-de-guzel-cay-borek');
  assert.equal(textTools.transform('trim', '  a   b \n\n\n\n  c  '), 'a b\n\nc');
  assert.equal(textTools.transform('json', '{"a":1,"b":[1,2]}'), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  assert.throws(() => textTools.transform('json', '{nope'));
  const encoded = textTools.transform('base64', 'merhaba dünya');
  assert.equal(encoded, Buffer.from('merhaba dünya').toString('base64'));
  assert.equal(textTools.transform('base64', encoded), 'merhaba dünya');
  assert.deepEqual(textTools.count('bir iki\nüç'), { chars: 10, words: 3, lines: 2 });
});

test('unique output names never overwrite', () => {
  const existing = new Set([path.join('/x', 'a.png'), path.join('/x', 'a (2).png')]);
  assert.equal(fileTools.uniquePath('/x', 'a', '.png', (p) => existing.has(p)), path.join('/x', 'a (3).png'));
  assert.equal(fileTools.uniquePath('/x', 'b', '.png', () => false), path.join('/x', 'b.png'));
});

test('ICO container layout', () => {
  const entries = [{ size: 16, png: Buffer.alloc(10, 1) }, { size: 256, png: Buffer.alloc(20, 2) }];
  const ico = fileTools.buildIco(entries);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.equal(ico.readUInt8(6), 16);
  assert.equal(ico.readUInt8(22), 0, '256 px is stored as 0');
  assert.equal(ico.readUInt32LE(6 + 12), 6 + 32);
  assert.equal(ico.readUInt32LE(22 + 12), 6 + 32 + 10);
  assert.equal(ico.length, 6 + 32 + 30);
});

test('file actions skip same-format and non-image inputs', async () => {
  const dir = tmp();
  const png = path.join(dir, 'a.png');
  const txt = path.join(dir, 'b.txt');
  fs.writeFileSync(png, 'x');
  fs.writeFileSync(txt, 'x');
  const calls = [];
  const convertImage = async (bytes, options) => { calls.push(options.format); return { bytes: Buffer.from('out') }; };
  const same = await fileTools.runFileAction('png', [png, txt], { convertImage });
  assert.deepEqual({ ...same, outputs: same.outputs.length }, { outputs: 0, failed: 0, unsupported: 1, skipped: 1 });
  const webp = await fileTools.runFileAction('webp', [png], { convertImage });
  assert.equal(path.basename(webp.outputs[0]), 'a.webp');
  const half = await fileTools.runFileAction('half', [png], { convertImage, suffixes: { half: 'küçük' } });
  assert.equal(path.basename(half.outputs[0]), 'a (küçük).png');
  assert.deepEqual(calls, ['webp', 'png']);
});

test('settings are sanitized', () => {
  const s = sanitize({ theme: 'neon', accent: 'blue', retentionDays: '7', releaseToSelect: 0, unknown: 1 });
  assert.equal(s.theme, 'system');
  assert.equal(s.retentionDays, 7);
  assert.equal(s.releaseToSelect, false);
  assert.ok(!('unknown' in s));
  assert.equal(sanitize(null).hotkey, DEFAULTS.hotkey);
});

test('Turkish and English strings cover the same keys', () => {
  assert.deepEqual(Object.keys(locales.tr).sort(), Object.keys(locales.en).sort());
  assert.equal(locales.resolveLanguage('auto', 'tr-TR'), 'tr');
  assert.equal(locales.resolveLanguage('auto', 'de-DE'), 'en');
  assert.equal(locales.format('{n} dosya', { n: 3 }), '3 dosya');
});

test('every string key used by the renderers exists', () => {
  const sources = ['overlay.js', 'settings.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const used = new Set([...sources.matchAll(/\bt\('([a-zA-Z]+\.[a-zA-Z0-9]+)'/g)].map((m) => m[1]));
  for (const key of used) assert.ok(key in locales.tr, `missing key ${key}`);
  // Keys composed at runtime
  for (const kind of ['upper', 'lower', 'titleCase', 'trim', 'json', 'slug', 'base64', 'count']) assert.ok(`text.${kind}` in locales.tr);
  for (const kind of ['png', 'jpg', 'webp', 'pdf', 'ico', 'half', 'compress', 'zip', 'copyPath']) assert.ok(`convert.${kind}` in locales.tr);
});

const translator = require('../src/translate.cjs');

test('OCR line breaks are rejoined into paragraphs', () => {
  assert.equal(translator.unwrapOcr('Please save your changes before closing\nthe applica-\ntion window.\n\nSecond para'), 'Please save your changes before closing the application window.\n\nSecond para');
});

test('long text is chunked under the limit without losing characters', () => {
  const text = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} is here.`).join(' ') + '\n\n' + 'x'.repeat(50);
  const pieces = translator.chunk(text, 200);
  assert.ok(pieces.every((p) => p.length <= 200));
  assert.equal(pieces.join('').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
});

test('Google responses are parsed and same-language text falls back', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(new URL(url).searchParams.get('tl'));
    const tl = new URL(url).searchParams.get('tl');
    const body = tl === 'tr' ? [[['Merhaba dünya', 'Merhaba dünya', null, null, 10]], null, 'tr'] : [[['Hello ', 'Merhaba ', null, null, 10], ['world', 'dünya', null, null, 10]], null, 'tr'];
    return { ok: true, json: async () => body };
  };
  const result = await translator.translate('Merhaba dünya', { target: 'tr', fallback: 'en', fetch });
  assert.deepEqual(calls, ['tr', 'en']);
  assert.equal(result.text, 'Hello world');
  assert.equal(result.target, 'en');
  assert.equal(result.source, 'tr');
});

test('DeepL uses the free endpoint for :fx keys and reports errors', async () => {
  let seen;
  const fetch = async (url, options) => { seen = { url, options }; return { ok: true, json: async () => ({ translations: [{ text: 'Merhaba', detected_source_language: 'EN' }] }) }; };
  const result = await translator.translate('Hello', { target: 'tr', provider: 'deepl', key: 'abc:fx', fetch });
  assert.equal(seen.url, 'https://api-free.deepl.com/v2/translate');
  assert.match(seen.options.body, /target_lang=TR/);
  assert.equal(result.text, 'Merhaba');
  await assert.rejects(translator.translate('Hello', { target: 'tr', provider: 'deepl', key: '', fetch }));
  await assert.rejects(translator.translate('Hello', { target: 'tr', fetch: async () => ({ ok: false, status: 429 }) }), /429/);
});

const updaterModule = require('../src/updater.cjs');

test('version comparison', () => {
  const { compareVersions: c } = updaterModule;
  assert.equal(c('0.3.0', '0.2.0'), 1);
  assert.equal(c('v0.10.0', '0.9.9'), 1);
  assert.equal(c('0.2.0', '0.2.0'), 0);
  assert.equal(c('0.2', '0.2.0'), 0);
  assert.equal(c('0.3.0-beta.1', '0.3.0'), -1);
  assert.equal(c('0.2.1', '0.3.0'), -1);
});

test('latest GitHub release is read from the API', async () => {
  const { latestRelease, REPO } = updaterModule;
  assert.equal(REPO, 'Mehmetsndl/halka');
  let asked;
  const fetch = async (url) => { asked = url; return { ok: true, status: 200, json: async () => ({ tag_name: 'v0.3.0', html_url: 'https://github.com/Mehmetsndl/halka/releases/tag/v0.3.0', body: 'notes', assets: [{ name: 'Halka-Setup-0.3.0-x64.exe', browser_download_url: 'https://x/setup.exe' }, { name: 'Halka-0.3.0-portable-x64.exe', browser_download_url: 'https://x/portable.exe' }] }) }; };
  const release = await latestRelease(fetch);
  assert.equal(asked, 'https://api.github.com/repos/Mehmetsndl/halka/releases/latest');
  assert.deepEqual({ v: release.version, p: release.portableUrl }, { v: '0.3.0', p: 'https://x/portable.exe' });
  assert.equal(await latestRelease(async () => ({ ok: false, status: 404 })), null);
  await assert.rejects(latestRelease(async () => ({ ok: false, status: 403 })), /403/);
});

test('portable builds announce a newer release once', async () => {
  const { Updater } = updaterModule;
  const notes = [];
  const app = { isPackaged: true, getVersion: () => '0.2.0' };
  process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\Halka.exe';
  const u = new Updater({ app, notify: (kind, info) => notes.push([kind, info.version]), fetch: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.3.0', html_url: 'https://h', assets: [] }) }) });
  await u.check({ silent: true });
  await u.check({ silent: true });
  delete process.env.PORTABLE_EXECUTABLE_FILE;
  assert.equal(u.state.status, 'available');
  assert.equal(u.state.latest, '0.3.0');
  assert.deepEqual(notes, [['available', '0.3.0']]);
  const same = new Updater({ app, notify: () => notes.push('x'), fetch: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.2.0', assets: [] }) }) });
  process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\Halka.exe';
  await same.check();
  delete process.env.PORTABLE_EXECUTABLE_FILE;
  assert.equal(same.state.status, 'latest');
});
