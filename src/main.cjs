'use strict';
// Halka — a radial menu that opens around the cursor on a global shortcut.
// Combines ClipBoardLine's clipboard shelves with Nashi's file conversion wheel.

const { app, BrowserWindow, globalShortcut, ipcMain, screen, nativeImage, nativeTheme, Tray, Menu, shell, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const win32 = require('./win32.cjs');
const clip = require('./clip.cjs');
const { HistoryStore, classifyText } = require('./store.cjs');
const { Settings } = require('./settings.cjs');
const locales = require('./locales.cjs');
const textTools = require('./text-tools.cjs');
const fileTools = require('./file-tools.cjs');
const translator = require('./translate.cjs');
const ocr = require('./ocr.cjs');
const { Updater } = require('./updater.cjs');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const ASSETS = path.join(ROOT, 'assets');
const TEXT_CAPTURE_BLOCKLIST = new Set(['ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow']);
const SHELL_SURFACES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow']);
const DEV_CAPTURE = process.argv.includes('--capture'); // screenshot harness

if (DEV_CAPTURE) app.setPath('userData', process.env.HALKA_CAPTURE_DIR || path.join(require('node:os').tmpdir(), 'halka-capture'));
if (!DEV_CAPTURE && !app.requestSingleInstanceLock()) {
  logLine('another instance is running');
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('app.halka.desktop');

// Keep a small log next to the user's data so problems can be diagnosed without a console.
function logLine(message) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'halka.log'), `${new Date().toISOString()} ${message}\n`); } catch { /* ignore */ }
}
process.on('uncaughtException', (error) => { logLine(`uncaught ${error && error.stack || error}`); console.error(error); });
process.on('unhandledRejection', (error) => { logLine(`unhandled ${error && error.stack || error}`); console.error(error); });
process.on('exit', (code) => logLine(`exit ${code}`));
app.on('render-process-gone', (_event, contents, details) => logLine(`renderer gone ${details.reason} ${contents.getURL()}`));
app.on('child-process-gone', (_event, details) => logLine(`child gone ${details.type} ${details.reason}`));
protocol.registerSchemesAsPrivileged([{ scheme: 'halka', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let settings;
let store;
let tray = null;
let overlay = null;
let worker = null;
let toast = null;
let settingsWindow = null;
let language = 'en';
let strings = locales.en;
let context = null; // what was in front when the ring opened
let overlayReady = false;
let quitting = false;
let updater = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const t = (key, values) => locales.format(strings[key] ?? key, values);

/* ------------------------------------------------------------------ setup */

function resolveTheme() {
  const theme = settings.get('theme');
  if (theme === 'light' || theme === 'dark') return theme;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function uiState() {
  return { settings: settings.all(), strings, language, theme: resolveTheme(), platform: process.platform, version: app.getVersion(), languages: translator.LANGUAGES };
}

function broadcast(channel, payload) {
  for (const window of [overlay, toast, settingsWindow, worker]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function applyLanguage() {
  language = locales.resolveLanguage(settings.get('language'), app.getLocale());
  strings = locales.strings(language);
}

function webPreferences(extra = {}) {
  return { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, ...extra };
}

function createOverlay() {
  overlay = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    roundedCorners: false,
    thickFrame: false,
    title: 'Halka',
    webPreferences: webPreferences({ backgroundThrottling: false })
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true);
  overlay.loadFile(path.join(RENDERER, 'overlay.html'));
  overlay.webContents.once('did-finish-load', () => { overlayReady = true; });
  overlay.on('blur', () => { if (overlay.isVisible() && !DEV_CAPTURE) overlay.webContents.send('halka:dismiss'); });
  overlay.on('close', (event) => { if (!quitting) { event.preventDefault(); overlay.hide(); } });
}

function createWorker() {
  worker = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: webPreferences({ backgroundThrottling: false }) });
  worker.loadFile(path.join(RENDERER, 'worker.html'));
  worker.on('close', (event) => { if (!quitting) event.preventDefault(); });
}

function createToast() {
  toast = new BrowserWindow({
    show: false, width: 380, height: 104, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false,
    minimizable: false, maximizable: false, fullscreenable: false, roundedCorners: false, thickFrame: false,
    webPreferences: webPreferences({ backgroundThrottling: false })
  });
  toast.setAlwaysOnTop(true, 'screen-saver');
  toast.loadFile(path.join(RENDERER, 'toast.html'));
  toast.on('close', (event) => { if (!quitting) event.preventDefault(); });
}

function openSettings(section) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    if (section) settingsWindow.webContents.send('settings:section', section);
    return;
  }
  const dark = resolveTheme() === 'dark';
  settingsWindow = new BrowserWindow({
    width: 720, height: 500, minWidth: 640, minHeight: 440, show: false, frame: false,
    backgroundColor: dark ? '#1e1e20' : '#f5f5f7', title: `Halka — ${t('settings.title')}`,
    icon: path.join(ASSETS, 'icon.png'), maximizable: false, fullscreenable: false,
    webPreferences: webPreferences()
  });
  settingsWindow.loadFile(path.join(RENDERER, 'settings.html'), section ? { hash: section } : undefined);
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; registerHotkeys(); });
}

/* ---------------------------------------------------------------- hotkeys */

const hotkeyStatus = { hotkey: true, clipboardHotkey: true };

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const pairs = [['hotkey', () => toggleRing('ring')], ['clipboardHotkey', () => toggleRing('clipboard')]];
  for (const [key, handler] of pairs) {
    const accelerator = settings.get(key);
    if (!accelerator || accelerator === 'off') { hotkeyStatus[key] = true; continue; }
    try { hotkeyStatus[key] = globalShortcut.register(accelerator, handler); } catch { hotkeyStatus[key] = false; }
    if (!hotkeyStatus[key]) console.warn('[halka] could not register', accelerator);
  }
  return hotkeyStatus;
}

function prettyAccelerator(accelerator) {
  return String(accelerator || '').replace(/Control/g, 'Ctrl').replace(/CommandOrControl/g, 'Ctrl').replace(/\+/g, '+');
}

/* ------------------------------------------------------------ ring / overlay */

async function clipboardSummary() {
  const text = await clip.readText();
  if (text.trim()) return { kind: classifyText(text), preview: text.trim().slice(0, 80) };
  if (await clip.hasImage() || (win32.isWin && await win32.clipboardHasImage())) return { kind: 'image' };
  return { kind: 'empty' };
}

/** Clipboard image as PNG. Falls back to the helper (raw PNG or CF_DIB) if Chromium can't read it. */
async function clipboardImagePng() {
  const png = await clip.readImagePng();
  if (png || !win32.isWin) return png;
  const file = path.join(app.getPath('temp'), `halka-clipboard-${process.pid}`);
  const kind = await win32.saveClipboardImage(file);
  if (!kind) return null;
  try {
    const bytes = await fs.promises.readFile(file);
    if (kind === 'png') return bytes;
    return (await convertImage(bytes, { format: 'png', name: 'clipboard.bmp' })).bytes;
  } catch (error) {
    console.error('[halka] clipboard image', error);
    return null;
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

let ringOpening = false;
async function toggleRing(mode = 'ring') {
  if (!overlayReady || ringOpening) return;
  if (overlay.isVisible()) {
    overlay.webContents.send('halka:dismiss');
    return;
  }
  ringOpening = true;
  let front;
  let summary;
  try { [front, summary] = await Promise.all([win32.foreground(), clipboardSummary()]); } finally { ringOpening = false; }
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const bounds = display.bounds;
  const explorerFront = win32.isExplorer(front.className);
  const desktopFront = win32.isDesktop(front.className);
  context = { window: front, files: [], filesPending: explorerFront || desktopFront, display: display.id, point };

  overlay.setBounds(bounds);
  overlay.setBounds(bounds); // second call settles size after a DPI change between monitors
  overlay.webContents.send('halka:open', {
    mode,
    cursor: { x: point.x - bounds.x, y: point.y - bounds.y },
    viewport: { width: bounds.width, height: bounds.height },
    clipboard: summary,
    filesPending: context.filesPending,
    history: store.snapshot(),
    ...uiState()
  });
  overlay.show();
  overlay.focus();
  overlay.moveTop();

  if (context.filesPending) {
    const token = context;
    const paths = desktopFront ? await win32.desktopSelection() : await win32.explorerSelection(front.hwnd);
    if (context !== token) return;
    context.files = paths;
    context.filesPending = false;
    overlay.webContents.send('halka:files', { files: paths.map((file) => ({ path: file, name: path.basename(file), image: fileTools.isImage(file) })) });
  }
}

let hideWaiters = [];
function hideOverlay() {
  return new Promise((resolve) => {
    if (!overlay.isVisible()) return resolve();
    hideWaiters.push(resolve);
    overlay.hide();
  });
}

function settleHide() {
  const waiters = hideWaiters;
  hideWaiters = [];
  setTimeout(() => waiters.forEach((resolve) => resolve()), 30);
}

async function returnToPrevious() {
  // Opened from the tray or a shell surface: there is no app to paste into.
  if (!context || !context.window.hwnd || SHELL_SURFACES.has(context.window.className)) return false;
  const ok = await win32.focusWindow(context.window.hwnd);
  await win32.waitForModifiersUp();
  await delay(35);
  return ok;
}

/* -------------------------------------------------------------- clipboard */

let lastSequence = -1;
let ownSequence = -2;
let lastTextSeen = '';
let lastImageSeen = '';
let watchTimer = null;
let watching = false;

async function markOwnWrite() {
  lastTextSeen = await clip.readText();
  if (win32.isWin) {
    ownSequence = await win32.clipboardSequence();
    lastSequence = ownSequence;
  }
}

async function captureClipboard() {
  if (settings.get('paused')) return;
  if (win32.isWin && await win32.clipboardPrivate()) return;
  const source = win32.isWin ? (await win32.foreground()).className : '';
  const text = await clip.readText();
  if (text.trim()) {
    lastTextSeen = text;
    const kind = classifyText(text);
    if ((kind === 'link' && !settings.get('captureLinks')) || (kind === 'text' && !settings.get('captureText'))) return;
    store.addText(text, source);
    return;
  }
  if (!settings.get('captureImages')) return;
  const png = await clipboardImagePng();
  if (!png) return;
  lastImageSeen = png.length + ':' + png.subarray(-32).toString('hex');
  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) return;
  const size = image.getSize();
  if (size.width * size.height > 60_000_000) return;
  const thumb = image.resize({ width: Math.min(360, size.width), quality: 'good' }).toPNG();
  store.addImage(png, thumb, size, source);
}

async function pollClipboard() {
  if (watching) return;
  watching = true;
  try {
    if (win32.isWin) {
      const sequence = await win32.clipboardSequence();
      if (sequence === -1 || sequence === lastSequence) return;
      lastSequence = sequence;
      if (sequence === ownSequence) return;
      await new Promise((resolve) => setTimeout(resolve, 80)); // let the owner finish writing every format
      await captureClipboard();
    } else {
      // Portable fallback for development on other platforms.
      const text = await clip.readText();
      if (text !== lastTextSeen) { lastTextSeen = text; if (text.trim()) await captureClipboard(); return; }
      if (text.trim()) return;
      const png = await clip.readImagePng();
      if (!png) return;
      const key = png.length + ':' + png.subarray(-32).toString('hex');
      if (key !== lastImageSeen) await captureClipboard();
    }
  } catch (error) {
    console.error('[halka] clipboard', error);
  } finally {
    watching = false;
  }
}

async function startWatcher() {
  if (win32.isWin) lastSequence = await win32.clipboardSequence();
  else lastTextSeen = await clip.readText();
  watchTimer = setInterval(pollClipboard, win32.isWin ? 300 : 1000);
}

async function writeItem(item) {
  if (item.kind === 'image') {
    const file = store.imagePath(item);
    if (fs.existsSync(file)) {
      const png = fs.readFileSync(file);
      await clip.writeImagePng(png);
      lastImageSeen = png.length + ':' + png.subarray(-32).toString('hex');
    }
  } else {
    await clip.writeText(item.text);
  }
  return markOwnWrite();
}

async function pasteItem(id, { plain = false } = {}) {
  const item = store.get(id);
  if (!item) return;
  await hideOverlay();
  if (plain && item.text) { await clip.writeText(item.text); await markOwnWrite(); } else await writeItem(item);
  store.touch(id);
  if (await returnToPrevious()) await win32.sendPaste();
  else showToast({ title: t('toast.copied'), body: item.text ? item.text.slice(0, 120) : '', duration: 2200 });
}

/* ------------------------------------------------------------------ toast */

function showToast({ title, body = '', actions = [], tone = 'info', duration = 3200 }) {
  if (!toast || toast.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  const width = 380;
  const height = 104;
  toast.setBounds({ x: Math.round(area.x + area.width - width - 10), y: Math.round(area.y + 10), width, height });
  toast.webContents.send('toast:show', { title, body, actions, tone, duration, ...uiState() });
  toast.showInactive();
  toast.setAlwaysOnTop(true, 'screen-saver');
}

/* ---------------------------------------------------------------- worker */

let workerSeq = 1;
const workerPending = new Map();
function workerCall(op, payload) {
  return new Promise((resolve, reject) => {
    const id = workerSeq++;
    const timer = setTimeout(() => { workerPending.delete(id); reject(new Error('worker timeout')); }, 60_000);
    workerPending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    worker.webContents.send('worker:call', { id, op, payload });
  });
}

const convertImage = async (bytes, options) => {
  const result = await workerCall('image', { bytes: new Uint8Array(bytes), ...options });
  return { ...result, bytes: Buffer.from(result.bytes) };
};

/* ---------------------------------------------------------------- actions */

async function grabText() {
  const front = context ? context.window : { className: '' };
  const canCopy = win32.isWin && front.hwnd && !win32.isExplorer(front.className) && !win32.isDesktop(front.className) && !TEXT_CAPTURE_BLOCKLIST.has(front.className);
  if (canCopy) {
    await returnToPrevious();
    const before = await win32.clipboardSequence();
    await win32.sendCopy();
    const start = Date.now();
    while (Date.now() - start < 450) {
      await delay(25);
      if (await win32.clipboardSequence() !== before) {
        await delay(30);
        const text = await clip.readText();
        if (text) return { text, fromSelection: true };
        break;
      }
    }
  }
  return { text: await clip.readText(), fromSelection: false };
}

async function runTextTool(kind) {
  await hideOverlay();
  const { text, fromSelection } = await grabText();
  if (!text) return showToast({ title: t('toast.noText'), tone: 'warning' });
  if (kind === 'count') {
    const stats = textTools.count(text);
    return showToast({ title: t('text.count'), body: t('toast.counted', stats) });
  }
  let result;
  try { result = textTools.transform(kind, text, language); } catch {
    return showToast({ title: kind === 'json' ? t('toast.jsonInvalid') : t('toast.failed'), tone: 'warning' });
  }
  await clip.writeText(result);
  if (fromSelection) {
    await returnToPrevious();
    await win32.sendPaste();
  } else {
    showToast({ title: t(`text.${kind}`), body: result.slice(0, 120) });
  }
}

async function runFileAction(action) {
  const files = context ? context.files : [];
  await hideOverlay();
  if (!files.length) return showToast({ title: t('toast.noFiles'), tone: 'warning' });
  if (action === 'copyPath') {
    await clip.writeText(files.join('\r\n'));
    return showToast({ title: t('toast.copiedPath'), body: files.length === 1 ? files[0] : `${files.length} × ${path.dirname(files[0])}` });
  }
  const { outputs, failed, unsupported, skipped } = await fileTools.runFileAction(action, files, { convertImage, suffixes: { half: t('suffix.half'), compressed: t('suffix.compressed') } });
  if (!outputs.length) {
    if (skipped && !failed) return showToast({ title: t('toast.sameFormat'), tone: 'warning' });
    return showToast({ title: unsupported && !failed ? t('toast.unsupported') : t('toast.failed'), tone: 'warning' });
  }
  const bad = failed + unsupported;
  const title = bad ? t('toast.partial', { ok: outputs.length, fail: bad }) : action === 'zip' ? t('toast.zipped') : outputs.length === 1 ? t('toast.convertedOne') : t('toast.converted', { n: outputs.length });
  showToast({
    title,
    body: outputs.length === 1 ? path.basename(outputs[0]) : outputs.map((file) => path.basename(file)).slice(0, 3).join(', '),
    tone: bad ? 'warning' : 'success',
    actions: [{ label: t('toast.reveal'), kind: 'reveal', value: outputs[0] }, ...(outputs.length === 1 ? [{ label: t('toast.open'), kind: 'open', value: outputs[0] }] : [])],
    duration: 5200
  });
}

/* -------------------------------------------------------------- translate */

let lastResult = null; // { source, text, fromSelection, fromImage, ocrOnly }
let translateFetch = (url, options) => net.fetch(url, options);

/** Re-opens the overlay at the cursor with the result card. */
function showResult(result) {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const bounds = display.bounds;
  overlay.setBounds(bounds);
  overlay.setBounds(bounds);
  overlay.webContents.send('halka:open', {
    mode: 'result',
    cursor: { x: point.x - bounds.x, y: point.y - bounds.y },
    viewport: { width: bounds.width, height: bounds.height },
    clipboard: { kind: 'empty' },
    filesPending: false,
    history: [],
    result,
    ...uiState()
  });
  overlay.show();
  overlay.focus();
  overlay.moveTop();
}

const updateResult = (result) => overlay.webContents.send('halka:result', result);

/** Opens Snipping Tool and waits (up to a minute) for the new screenshot on the clipboard. */
async function snipImage() {
  if (!win32.isWin) return clipboardImagePng();
  const before = await win32.clipboardSequence();
  await shell.openExternal('ms-screenclip:');
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    await delay(250);
    const sequence = await win32.clipboardSequence();
    if (sequence !== before && sequence !== -1) {
      await delay(150);
      const png = await clipboardImagePng();
      if (png) return png;
    }
  }
  return null;
}

async function imageForTranslate() {
  const files = context ? context.files.filter(fileTools.isImage) : [];
  if (files.length) {
    const bytes = await fs.promises.readFile(files[0]);
    const lower = files[0].toLowerCase();
    if (/\.(png|jpe?g|bmp)$/.test(lower)) return bytes;
    return (await convertImage(bytes, { format: 'png', name: path.basename(files[0]) })).bytes;
  }
  return clipboardImagePng();
}

async function translateText(text) {
  const target = settings.get('translateTarget') === 'auto' ? language : settings.get('translateTarget');
  let fallback = settings.get('translateFallback');
  if (fallback === target) fallback = target === 'en' ? 'tr' : 'en';
  return translator.translate(text, {
    target,
    fallback,
    provider: settings.get('translateProvider'),
    key: settings.get('deeplKey'),
    fetch: (url, options) => translateFetch(url, options)
  });
}

async function runTranslate(kind) {
  const usesScreen = kind === 'screen' || kind === 'ocrScreen';
  const ocrOnly = kind === 'ocr' || kind === 'ocrScreen';
  await hideOverlay();
  let source = '';
  let fromSelection = false;
  let fromImage = false;
  if (kind === 'text') {
    ({ text: source, fromSelection } = await grabText());
    if (!source.trim()) return showToast({ title: t('toast.noText'), tone: 'warning' });
  } else {
    const png = usesScreen ? await snipImage() : await imageForTranslate();
    if (!png) return usesScreen ? undefined : showToast({ title: t('toast.qrNoImage'), tone: 'warning', duration: 4200 });
    fromImage = true;
    showResult({ stage: 'ocr', ocrOnly });
    try {
      source = translator.unwrapOcr(await ocr.recognize(png, { root: ROOT, cacheDir: path.join(app.getPath('userData'), 'ocr-cache') }));
    } catch (error) {
      console.error('[halka] ocr', error);
      return updateResult({ stage: 'error', message: t('result.ocrFailed'), ocrOnly });
    }
    if (!source) return updateResult({ stage: 'error', message: t('result.noTextInImage'), ocrOnly });
  }
  lastResult = { source, fromSelection, fromImage, ocrOnly };
  if (ocrOnly) {
    await clip.writeText(source);
    return updateResult({ stage: 'done', ocrOnly: true, source, text: source, fromSelection: false });
  }
  if (!fromImage) showResult({ stage: 'translate', source, fromSelection });
  else updateResult({ stage: 'translate', source });
  await doTranslate();
}

async function doTranslate(target) {
  if (!lastResult) return;
  if (target) settings.update({ translateTarget: target });
  updateResult({ stage: 'translate', source: lastResult.source, fromSelection: lastResult.fromSelection });
  try {
    const result = await translateText(lastResult.source);
    lastResult.text = result.text;
    updateResult({ stage: 'done', ...lastResult, detected: result.source, target: result.target, provider: result.provider });
  } catch (error) {
    console.error('[halka] translate', error);
    updateResult({ stage: 'error', source: lastResult.source, message: t(settings.get('translateProvider') === 'deepl' && !settings.get('deeplKey') ? 'result.deeplKey' : 'result.offline') });
  }
}

async function resultOutput(mode) {
  const text = lastResult && lastResult.text;
  if (!text) return;
  await clip.writeText(text);
  if (mode === 'copy') return;
  await hideOverlay();
  if (await returnToPrevious()) await win32.sendPaste();
  else showToast({ title: t('toast.copied'), body: text.slice(0, 120), duration: 2200 });
}

async function runAction(action, payload = {}) {
  switch (action) {
    case 'close': return hideOverlay();
    case 'settings': await hideOverlay(); return openSettings(payload.section);
    case 'screenshot': await hideOverlay(); return shell.openExternal('ms-screenclip:');
    case 'plain': {
      await hideOverlay();
      const text = await clip.readText();
      if (!text) return showToast({ title: t('toast.noText'), tone: 'warning' });
      await clip.writeText(text);
      await markOwnWrite();
      if (await returnToPrevious()) await win32.sendPaste();
      return;
    }
    case 'qr': {
      await hideOverlay();
      const png = await clipboardImagePng();
      if (!png) return showToast({ title: t('toast.qrNoImage'), tone: 'warning', duration: 4200 });
      const result = await workerCall('qr', { bytes: new Uint8Array(png) }).catch(() => ({ text: null }));
      if (!result.text) return showToast({ title: t('toast.qrNone'), tone: 'warning' });
      await clip.writeText(result.text);
      const url = /^https?:\/\//i.test(result.text) ? result.text : null;
      return showToast({ title: t('toast.qrFound'), body: result.text.slice(0, 140), tone: 'success', actions: url ? [{ label: t('toast.open'), kind: 'url', value: url }] : [], duration: 5200 });
    }
    case 'text': return runTextTool(payload.kind);
    case 'translate': return runTranslate(payload.kind);
    case 'retranslate': return doTranslate(payload.target);
    case 'resultCopy': return resultOutput('copy');
    case 'resultPaste': return resultOutput('paste');
    case 'file': return runFileAction(payload.kind);
    default: console.warn('[halka] unknown action', action);
  }
}

/* -------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('halka:bootstrap', () => ({ ...uiState(), history: store.snapshot() }));
  ipcMain.on('halka:hidden', () => { if (overlay.isVisible()) overlay.hide(); });
  ipcMain.handle('halka:run', (_event, action, payload) => runAction(action, payload));
  ipcMain.handle('halka:item', async (_event, op, id) => {
    switch (op) {
      case 'paste': return pasteItem(id);
      case 'pastePlain': return pasteItem(id, { plain: true });
      case 'copy': { const item = store.get(id); if (item) { await writeItem(item); store.touch(id); } return; }
      case 'pin': store.togglePin(id); return;
      case 'remove': store.remove(id); return;
      case 'full': { const item = store.get(id); return item && item.text ? item.text : null; }
      default: return;
    }
  });
  ipcMain.on('toast:action', (_event, action) => {
    if (action.kind === 'reveal') shell.showItemInFolder(action.value);
    else if (action.kind === 'open') shell.openPath(action.value);
    else if (action.kind === 'url' && /^https?:\/\//i.test(action.value)) shell.openExternal(action.value);
    else if (action.kind === 'restart' && updater) updater.install();
    toast.webContents.send('toast:hide');
  });
  ipcMain.on('toast:hidden', () => toast.hide());

  ipcMain.handle('settings:get', () => ({ ...uiState(), hotkeyStatus, dataPath: app.getPath('userData'), update: updater ? updater.state : null }));
  ipcMain.handle('update:check', () => (updater ? updater.check({ silent: false }) : null));
  ipcMain.handle('update:install', () => updater && updater.install());
  ipcMain.handle('open:url', (_event, url) => { if (/^https:\/\//i.test(String(url))) shell.openExternal(url); });
  ipcMain.handle('settings:set', (_event, partial) => applySettings(partial));
  ipcMain.handle('settings:recording', (_event, recording) => { if (recording) globalShortcut.unregisterAll(); else registerHotkeys(); });
  ipcMain.handle('settings:clear-history', () => store.clear(true));
  ipcMain.handle('settings:open-data', () => shell.openPath(app.getPath('userData')));
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());

  ipcMain.on('worker:result', (_event, { id, ok, value, error }) => {
    const pending = workerPending.get(id);
    if (!pending) return;
    workerPending.delete(id);
    if (ok) pending.resolve(value); else pending.reject(new Error(error));
  });
}

function applySettings(partial) {
  const before = settings.all();
  const after = settings.update(partial);
  if (before.language !== after.language) { applyLanguage(); buildTray(); }
  if (before.hotkey !== after.hotkey || before.clipboardHotkey !== after.clipboardHotkey) {
    registerHotkeys();
    if (!hotkeyStatus.hotkey || !hotkeyStatus.clipboardHotkey) {
      // Keep the previous working combination rather than leaving Halka unreachable.
      const revert = {};
      if (!hotkeyStatus.hotkey) revert.hotkey = before.hotkey;
      if (!hotkeyStatus.clipboardHotkey) revert.clipboardHotkey = before.clipboardHotkey;
      const failed = { ...hotkeyStatus };
      settings.update(revert);
      registerHotkeys();
      broadcast('halka:settings', uiState());
      return { ...uiState(), hotkeyStatus: failed, rejected: Object.keys(revert) };
    }
  }
  if (before.retentionDays !== after.retentionDays) store.configure({ retentionDays: after.retentionDays });
  if (before.launchAtLogin !== after.launchAtLogin) applyLoginItem();
  if (before.paused !== after.paused) buildTray();
  if (before.altDrag !== after.altDrag) win32.setAltDrag(after.altDrag);
  if (!before.autoUpdate && after.autoUpdate && updater) updater.check({ silent: true });
  broadcast('halka:settings', uiState());
  return { ...uiState(), hotkeyStatus };
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  // The portable build runs from a temporary folder; register the portable .exe itself instead.
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: settings.get('launchAtLogin'), path: executable, args: ['--hidden'] });
}

/* ------------------------------------------------------------------- tray */

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, process.platform === 'win32' ? 'tray.ico' : 'tray.png'));
  if (!tray) {
    tray = new Tray(icon);
    tray.on('click', () => toggleRing('clipboard'));
  }
  tray.setToolTip(`Halka — ${prettyAccelerator(settings.get('hotkey'))}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${t('tray.open')}    ${prettyAccelerator(settings.get('hotkey'))}`, click: () => toggleRing('ring') },
    { label: t('tray.clipboard'), click: () => toggleRing('clipboard') },
    { type: 'separator' },
    { label: t('tray.pause'), type: 'checkbox', checked: settings.get('paused'), click: (item) => applySettings({ paused: item.checked }) },
    { label: t('tray.settings'), click: () => openSettings() },
    { label: t('update.check'), click: () => { openSettings('about'); if (updater) updater.check({ silent: false }); } },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => { quitting = true; app.quit(); } }
  ]));
}

/* -------------------------------------------------------------- self-test */

// `Halka.exe --self-test` writes a diagnostic report to the data folder and opens the ring once.
async function selfTest() {
  const file = path.join(app.getPath('userData'), 'self-test.json');
  const report = { time: new Date().toISOString(), version: app.getVersion(), platform: process.platform, electron: process.versions.electron, steps: [] };
  const step = async (name, fn) => {
    report.steps.push(`${name}…`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    try { report[name] = await fn(); } catch (error) { report[name] = { error: String(error && error.stack || error) }; }
    report.steps[report.steps.length - 1] = `${name} ✓`;
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
  };
  await step('helper', () => win32.available());
  await step('foreground', () => win32.foreground());
  await step('clipboardSequence', () => win32.clipboardSequence());
  await step('clipboardPrivate', () => win32.clipboardPrivate());
  await step('hotkeys', () => ({ ...hotkeyStatus, hotkey: settings.get('hotkey'), clipboardHotkey: settings.get('clipboardHotkey') }));
  await step('historyItems', () => store.items.length);
  await step('worker', async () => {
    const out = await convertImage(nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).toPNG(), { format: 'webp', quality: 0.8 });
    return { ok: true, webpBytes: out.bytes.length };
  });
  await step('ocr', async () => {
    const started = Date.now();
    const text = await ocr.recognize(fs.readFileSync(path.join(ASSETS, 'ocr-sample.png')), { root: ROOT, cacheDir: path.join(app.getPath('userData'), 'ocr-cache') });
    return { ms: Date.now() - started, text };
  });
  await step('ring', async () => { await toggleRing('ring'); return { visible: overlay.isVisible(), bounds: overlay.getBounds() }; });
  await step('desktopSelection', () => win32.desktopSelection());
  console.log('[halka] self-test', JSON.stringify(report));
}

/* -------------------------------------------------------------- lifecycle */

// `Halka.exe --ring` / `--clipboard` lets mouse-button tools (Logitech Options, AutoHotkey, …) open Halka too.
app.on('second-instance', (_event, argv) => {
  if (argv.includes('--ring')) toggleRing('ring');
  else if (argv.includes('--clipboard')) toggleRing('clipboard');
  else openSettings();
});
app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(watchTimer);
  win32.stop();
  if (updater) updater.stop();
  ocr.stop();
  if (store) store.flush();
});

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  settings = new Settings(userData);
  store = new HistoryStore(userData, { retentionDays: settings.get('retentionDays') });
  win32.start();
  applyLanguage();

  protocol.handle('halka', (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const item = store.get(id);
    if (!item || item.kind !== 'image') return new Response('not found', { status: 404 });
    const file = url.host === 'thumb' && fs.existsSync(store.thumbPath(item)) ? store.thumbPath(item) : store.imagePath(item);
    return net.fetch(pathToFileURL(file).toString());
  });

  registerIpc();
  createOverlay();
  createWorker();
  createToast();
  overlay.on('hide', settleHide);
  store.onChange(() => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('halka:history', store.snapshot()); });
  nativeTheme.on('updated', () => broadcast('halka:settings', uiState()));

  if (DEV_CAPTURE) return require('./capture.cjs').run({ overlay, toast, worker, store, settings, applySettings, uiState, toggleRing, runAction, pasteItem, startWatcher, clip, setTranslateFetch: (fn) => { translateFetch = fn; }, workerCall, showToast, openSettings, getSettingsWindow: () => settingsWindow, ROOT });

  buildTray();
  registerHotkeys();
  applyLoginItem();
  startWatcher();
  win32.setAltDrag(settings.get('altDrag'));
  updater = new Updater({
    app,
    fetch: (url, options) => net.fetch(url, options),
    isEnabled: () => settings.get('autoUpdate'),
    onState: (state) => { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('update:state', state); },
    notify: (kind, info) => {
      if (kind === 'ready') {
        showToast({ title: t('update.ready', { v: info.version }), body: t('update.readyBody'), tone: 'success', actions: [{ label: t('update.restart'), kind: 'restart' }], duration: 15000 });
      } else {
        showToast({ title: t('update.available', { v: info.version }), body: t('update.availableBody'), actions: [{ label: t('update.download'), kind: 'url', value: info.url }], duration: 15000 });
      }
    }
  });
  updater.start();

  if (process.argv.includes('--self-test')) setTimeout(selfTest, 2500);

  const launchedHidden = process.argv.includes('--hidden');
  if (!hotkeyStatus.hotkey) {
    showToast({ title: t('toast.hotkeyFailed', { key: prettyAccelerator(settings.get('hotkey')) }), tone: 'warning', duration: 6000 });
    openSettings('shortcut');
  } else if (!settings.get('welcomed') || !launchedHidden) {
    setTimeout(() => showToast({ title: t('toast.ready', { key: prettyAccelerator(settings.get('hotkey')) }), duration: 4200 }), 600);
    settings.update({ welcomed: true });
  }
});
