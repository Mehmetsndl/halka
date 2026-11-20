'use strict';
// Small wrapper over Electron's asynchronous clipboard API (Electron 44+),
// which mirrors the W3C one: readText/writeText/has/read/write.

const fs = require('node:fs');
const { clipboard, ClipboardItem } = require('electron');

const PNG = 'image/png';

const readText = () => clipboard.readText().then((text) => text || '').catch(() => '');
const writeText = (text) => clipboard.writeText(String(text ?? ''));
async function items() {
  try { return await clipboard.read(); } catch { return []; }
}

/** True when the clipboard offers an image (checks both has() and the item types). */
async function hasImage() {
  if (await clipboard.has(PNG).catch(() => false)) return true;
  return (await items()).some((item) => item.types.includes(PNG));
}

/** The clipboard image as PNG bytes, or null. Windows bitmaps are converted to PNG by Chromium. */
async function readImagePng() {
  try {
    for (const item of await items()) {
      if (!item.types.includes(PNG)) continue;
      const blob = await item.getType(PNG);
      const bytes = Buffer.from(await blob.arrayBuffer());
      return bytes.length ? bytes : null;
    }
  } catch { /* clipboard busy or format vanished */ }
  return null;
}

function writeImagePng(bytes) {
  return clipboard.write([new ClipboardItem({ [PNG]: new Blob([bytes], { type: PNG }) })]);
}

const writeImageFile = (file) => writeImagePng(fs.readFileSync(file));

module.exports = { readText, writeText, hasImage, readImagePng, writeImagePng, writeImageFile };
