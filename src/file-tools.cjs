'use strict';
// File actions for the "Dönüştür" ring (Nashi's part of Halka). Image decoding
// and encoding happen in a hidden Chromium worker (see renderer/worker.js);
// this module handles naming, PDF/ICO containers and ZIP archives.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.gif', '.bmp', '.ico', '.avif', '.svg']);
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const isImage = (file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
const isJpeg = (file) => ['.jpg', '.jpeg', '.jfif'].includes(path.extname(file).toLowerCase());

/** Returns a path that does not exist yet: "photo.webp", then "photo (2).webp", … */
function uniquePath(directory, base, extension, exists = fs.existsSync) {
  let candidate = path.join(directory, `${base}${extension}`);
  for (let n = 2; exists(candidate); n++) candidate = path.join(directory, `${base} (${n})${extension}`);
  return candidate;
}

function outputFor(file, extension, suffix = '') {
  const parsed = path.parse(file);
  const base = suffix ? `${parsed.name} (${suffix})` : parsed.name;
  return uniquePath(parsed.dir, base, extension);
}

/** Builds a .ico container from square PNG images (PNG-compressed entries, Vista+). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

async function imagesToPdf(files, convertImage) {
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bytes = await fs.promises.readFile(file);
    let image;
    if (isJpeg(file)) {
      try { image = await pdf.embedJpg(bytes); } catch { image = null; }
    }
    if (!image) {
      const png = await convertImage(bytes, { format: 'png', name: path.basename(file) });
      image = await pdf.embedPng(png.bytes);
    }
    const width = image.width * 0.75;
    const height = image.height * 0.75;
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  return Buffer.from(await pdf.save());
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function zip(files, destination) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('ZIP uses Windows PowerShell'));
    const script = `$ErrorActionPreference='Stop'; Compress-Archive -LiteralPath @(${files.map(psQuote).join(',')}) -DestinationPath ${psQuote(destination)} -CompressionLevel Optimal`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(destination) : reject(new Error(`Compress-Archive exited with ${code}`))));
  });
}

/**
 * Runs one convert-ring action over the selected files.
 * Returns { outputs: string[], failed: number, unsupported: number, skipped: number }.
 */
async function runFileAction(action, files, { convertImage, suffixes = {} }) {
  const outputs = [];
  let failed = 0;
  let unsupported = 0;
  let skipped = 0;
  const images = files.filter(isImage);
  unsupported = ['zip', 'copyPath'].includes(action) ? 0 : files.length - images.length;

  const each = async (fn) => {
    for (const file of images) {
      try { outputs.push(await fn(file)); } catch (error) { failed++; console.error('[halka]', action, file, error); }
    }
  };

  const write = async (file, extension, options, suffix) => {
    const bytes = await fs.promises.readFile(file);
    const result = await convertImage(bytes, { ...options, name: path.basename(file) });
    const target = outputFor(file, extension, suffix);
    await fs.promises.writeFile(target, result.bytes);
    return target;
  };

  // Converting a file to the format it already has would only duplicate it.
  const sameFormat = { png: ['.png'], jpg: ['.jpg', '.jpeg', '.jfif'], webp: ['.webp'] }[action];
  const convertEach = async (fn) => {
    for (const file of images) {
      if (sameFormat.includes(path.extname(file).toLowerCase())) { skipped++; continue; }
      try { outputs.push(await fn(file)); } catch (error) { failed++; console.error('[halka]', action, file, error); }
    }
  };

  switch (action) {
    case 'png': await convertEach((file) => write(file, '.png', { format: 'png' })); break;
    case 'jpg': await convertEach((file) => write(file, '.jpg', { format: 'jpeg', quality: 0.92 })); break;
    case 'webp': await convertEach((file) => write(file, '.webp', { format: 'webp', quality: 0.9 })); break;
    case 'half': await each((file) => {
      const extension = isJpeg(file) ? '.jpg' : path.extname(file).toLowerCase() === '.webp' ? '.webp' : '.png';
      const format = extension === '.jpg' ? 'jpeg' : extension === '.webp' ? 'webp' : 'png';
      return write(file, extension, { format, quality: 0.9, scale: 0.5 }, suffixes.half || 'small');
    }); break;
    case 'compress': await each((file) => {
      // Photos compress best as JPEG; anything that may carry transparency becomes WebP.
      const photo = isJpeg(file) || path.extname(file).toLowerCase() === '.bmp';
      return write(file, photo ? '.jpg' : '.webp', { format: photo ? 'jpeg' : 'webp', quality: 0.72, maxSide: 2560 }, suffixes.compressed || 'compressed');
    }); break;
    case 'ico': await each(async (file) => {
      const bytes = await fs.promises.readFile(file);
      const entries = [];
      for (const size of ICO_SIZES) {
        const result = await convertImage(bytes, { format: 'png', square: size, name: path.basename(file) });
        entries.push({ size, png: Buffer.from(result.bytes) });
      }
      const target = outputFor(file, '.ico');
      await fs.promises.writeFile(target, buildIco(entries));
      return target;
    }); break;
    case 'pdf': {
      if (!images.length) break;
      try {
        const target = outputFor(images[0], '.pdf');
        await fs.promises.writeFile(target, await imagesToPdf(images, convertImage));
        outputs.push(target);
      } catch (error) { failed += images.length; console.error('[halka] pdf', error); }
      break;
    }
    case 'zip': {
      if (!files.length) break;
      const directory = path.dirname(files[0]);
      const base = files.length === 1 ? path.parse(files[0]).name : path.basename(directory) || 'Archive';
      try { outputs.push(await zip(files, uniquePath(directory, base, '.zip'))); } catch (error) { failed++; console.error('[halka] zip', error); }
      break;
    }
    default: throw new Error(`Unknown file action: ${action}`);
  }
  return { outputs, failed, unsupported, skipped };
}

module.exports = { runFileAction, buildIco, uniquePath, outputFor, isImage, ICO_SIZES, IMAGE_EXTENSIONS };
