'use strict';
// Win32 access through halka-helper.exe (native/halka-helper.c), a tiny
// companion process that stays running and answers one request per line.
// No native Node modules are needed, and every call degrades to a harmless
// default on other platforms so the UI can be developed anywhere.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const isWin = process.platform === 'win32';
const EXPLORER_CLASSES = new Set(['CabinetWClass', 'ExploreWClass']);
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);

let child = null;
let buffer = '';
let nextId = 1;
const pending = new Map();
let failures = 0;
let altDragWanted = false;

function helperPath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'halka-helper.exe') : null,
    path.join(__dirname, '..', 'native', 'halka-helper.exe')
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function start() {
  if (!isWin || child || failures > 5) return Boolean(child);
  const file = helperPath();
  if (!file) { console.error('[halka] halka-helper.exe not found'); failures = 99; return false; }
  child = spawn(file, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      const space = line.indexOf(' ');
      if (space < 0) continue;
      const id = Number(line.slice(0, space));
      const entry = pending.get(id);
      if (!entry) continue;
      pending.delete(id);
      clearTimeout(entry.timer);
      try { entry.resolve(JSON.parse(line.slice(space + 1))); } catch { entry.resolve(null); }
    }
  });
  const reset = () => {
    child = null;
    buffer = '';
    failures++;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(null); }
    pending.clear();
  };
  child.on('exit', reset);
  child.on('error', (error) => { console.error('[halka] helper failed', error.message); reset(); });
  child.stdin.on('error', () => {});
  // A restarted helper must get the Alt+drag state again.
  if (altDragWanted) child.stdin.write(`0 altdrag on\n`);
  return true;
}

function call(command, argument = '', timeout = 2000) {
  if (!isWin || !start()) return Promise.resolve(null);
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeout);
    pending.set(id, { resolve, timer });
    child.stdin.write(`${id} ${command}${argument !== '' ? ` ${argument}` : ''}\n`);
  });
}

async function foreground() {
  const result = await call('fg');
  return result ? { hwnd: Number(result.hwnd) || 0, className: result.cls || '', title: result.title || '' } : { hwnd: 0, className: '', title: '' };
}

async function focusWindow(hwnd) {
  if (!hwnd) return false;
  const result = await call('focus', String(hwnd));
  return Boolean(result && result.ok);
}

async function waitForModifiersUp(timeout = 1200) {
  await call('waitmods', String(timeout), timeout + 1000);
}

const sendPaste = () => call('paste');
const sendCopy = () => call('copy');

async function clipboardSequence() {
  const result = await call('seq');
  return result ? result.seq : -1;
}

async function clipboardPrivate() {
  const result = await call('private');
  return Boolean(result && result.private);
}

async function explorerSelection(hwnd) {
  const result = await call('explorer', String(hwnd), 4000);
  return result && Array.isArray(result.paths) ? result.paths : [];
}

async function desktopSelection() {
  const result = await call('desktop', '', 4000);
  return result && Array.isArray(result.paths) ? result.paths : [];
}

async function clipboardHasImage() {
  const result = await call('hasimage');
  return Boolean(result && result.image);
}

/** Saves the clipboard image to `file` through the helper. Returns 'png', 'bmp' or null. */
async function saveClipboardImage(file) {
  const result = await call('clipimage', file, 4000);
  return result && result.ok ? result.format : null;
}

/** Hold Alt and drag inside any window to move it. */
async function setAltDrag(on) {
  altDragWanted = Boolean(on);
  const result = await call('altdrag', on ? 'on' : 'off');
  return Boolean(result && result.altdrag);
}

function stop() {
  if (child) { child.stdin.end(); child.kill(); }
  child = null;
}

module.exports = {
  isWin,
  start,
  available: () => isWin && Boolean(child),
  foreground,
  focusWindow,
  waitForModifiersUp,
  sendPaste,
  sendCopy,
  clipboardSequence,
  clipboardPrivate,
  explorerSelection,
  desktopSelection,
  saveClipboardImage,
  clipboardHasImage,
  setAltDrag,
  stop,
  isExplorer: (cls) => EXPLORER_CLASSES.has(cls),
  isDesktop: (cls) => DESKTOP_CLASSES.has(cls)
};
