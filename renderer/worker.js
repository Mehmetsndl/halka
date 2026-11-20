'use strict';
// Hidden conversion worker. Chromium decodes PNG, JPEG, WebP, AVIF, GIF, BMP,
// ICO and SVG and encodes PNG, JPEG and WebP, so no native image library is needed.

const SVG_MIME = 'image/svg+xml';

function sniffMime(bytes, name = '') {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01) return 'image/x-icon';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/avif';
  if (/\.svg$/i.test(name)) return SVG_MIME;
  const head = new TextDecoder().decode(b.slice(0, 256)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return SVG_MIME;
  return 'application/octet-stream';
}

function loadElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 0); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

async function decode(bytes, name) {
  const mime = sniffMime(bytes, name);
  const blob = new Blob([bytes], { type: mime });
  if (mime === SVG_MIME) {
    const img = await loadElement(blob);
    // SVGs without intrinsic size fall back to 1024 px.
    const width = img.naturalWidth || 1024;
    const height = img.naturalHeight || 1024;
    return { source: img, width, height };
  }
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    const img = await loadElement(blob);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  }
}

async function image({ bytes, format = 'png', quality = 0.92, scale = 1, maxSide = 0, square = 0, name = '' }) {
  const decoded = await decode(bytes, name);
  let width = decoded.width;
  let height = decoded.height;
  if (!width || !height) throw new Error('empty image');
  let drawW;
  let drawH;
  let canvasW;
  let canvasH;
  if (square) {
    const fit = square / Math.max(width, height);
    drawW = Math.max(1, Math.round(width * fit));
    drawH = Math.max(1, Math.round(height * fit));
    canvasW = canvasH = square;
  } else {
    let factor = scale;
    if (maxSide && Math.max(width, height) * factor > maxSide) factor = maxSide / Math.max(width, height);
    drawW = canvasW = Math.max(1, Math.round(width * factor));
    drawH = canvasH = Math.max(1, Math.round(height * factor));
  }
  const canvas = new OffscreenCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d', { alpha: format !== 'jpeg' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }
  ctx.drawImage(decoded.source, Math.round((canvasW - drawW) / 2), Math.round((canvasH - drawH) / 2), drawW, drawH);
  if (decoded.source.close) decoded.source.close();
  const type = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const blob = await canvas.convertToBlob({ type, quality });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvasW, height: canvasH, type };
}

async function qr({ bytes }) {
  const decoded = await decode(bytes, 'clip.png');
  // Try the full image first, then a downscaled copy which helps with large screenshots.
  for (const factor of [1, 0.5, 2]) {
    const w = Math.max(1, Math.round(decoded.width * factor));
    const h = Math.max(1, Math.round(decoded.height * factor));
    if (w * h > 40_000_000) continue;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(decoded.source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const code = window.jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) return { text: code.data };
  }
  return { text: null };
}

const handlers = { image, qr };

window.halka.onWorkerCall(async ({ id, op, payload }) => {
  try {
    const handler = handlers[op];
    if (!handler) throw new Error(`unknown op ${op}`);
    const value = await handler(payload);
    window.halka.workerResult({ id, ok: true, value });
  } catch (error) {
    window.halka.workerResult({ id, ok: false, error: String(error && error.message || error) });
  }
});
