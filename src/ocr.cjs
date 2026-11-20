'use strict';
// Offline OCR with tesseract.js (WebAssembly). Turkish + English models ship with
// the app, so reading text from images never needs the network.

const path = require('node:path');
const fs = require('node:fs');

let workerPromise = null;
let idleTimer = null;

function tessdataPath(root) {
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'tessdata') : null;
  return packaged && fs.existsSync(packaged) ? packaged : path.join(root, 'assets', 'tessdata');
}

function getWorker(root, cacheDir) {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    fs.mkdirSync(cacheDir, { recursive: true });
    workerPromise = createWorker(['tur', 'eng'], 1, {
      langPath: tessdataPath(root),
      cachePath: cacheDir,
      gzip: true,
      logger: () => {},
      errorHandler: (error) => console.error('[halka] ocr', error)
    }).catch((error) => { workerPromise = null; throw error; });
  }
  return workerPromise;
}

/** Returns the text found in a PNG/JPEG/BMP image buffer. */
async function recognize(image, { root, cacheDir }) {
  clearTimeout(idleTimer);
  const worker = await getWorker(root, cacheDir);
  const { data } = await worker.recognize(Buffer.from(image));
  // Free the ~100 MB engine after a few idle minutes.
  idleTimer = setTimeout(() => stop(), 180_000);
  return (data.text || '').trim();
}

async function stop() {
  clearTimeout(idleTimer);
  const pending = workerPromise;
  workerPromise = null;
  if (pending) { try { await (await pending).terminate(); } catch { /* already gone */ } }
}

module.exports = { recognize, stop };
