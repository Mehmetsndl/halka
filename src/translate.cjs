'use strict';
// Text translation. Default: Google Translate's public web endpoint (no key).
// Optional: DeepL with the user's own API key. Only the text being translated
// is sent, and only when the user runs a translate action.

const LANGUAGES = {
  tr: 'Türkçe', en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano',
  pt: 'Português', nl: 'Nederlands', ru: 'Русский', uk: 'Українська', ar: 'العربية', fa: 'فارسی',
  az: 'Azərbaycanca', ja: '日本語', ko: '한국어', zh: '中文', el: 'Ελληνικά', pl: 'Polski'
};

const DEEPL_TARGET = { en: 'EN-US', pt: 'PT-BR', zh: 'ZH-HANS' };

/** Splits text into chunks below `max` characters, preferring paragraph, then sentence boundaries. */
function chunk(text, max = 1800) {
  const out = [];
  let current = '';
  const push = (piece) => {
    if ((current + piece).length > max && current) { out.push(current); current = ''; }
    if (piece.length > max) {
      for (let i = 0; i < piece.length; i += max) out.push(piece.slice(i, i + max));
      return;
    }
    current += piece;
  };
  for (const paragraph of text.split(/(\n+)/)) {
    if (paragraph.length <= max) { push(paragraph); continue; }
    for (const sentence of paragraph.split(/(?<=[.!?…。])\s+/)) push(sentence + ' ');
  }
  if (current) out.push(current);
  return out.filter((piece) => piece.length);
}

/** OCR output keeps hard line breaks; rejoin lines that belong to the same paragraph. */
function unwrapOcr(text) {
  return text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.replace(/-\n(?=\p{Ll})/gu, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function parseGoogle(body) {
  if (!Array.isArray(body) || !Array.isArray(body[0])) throw new Error('Unexpected response');
  const text = body[0].map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '')).join('');
  const source = typeof body[2] === 'string' ? body[2] : null;
  return { text, source };
}

async function google(text, target, fetch) {
  let source = null;
  let result = '';
  for (const piece of chunk(text)) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(piece)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parseGoogle(await response.json());
    source = source || parsed.source;
    result += parsed.text;
  }
  return { text: result, source: source ? source.split('-')[0].toLowerCase() : null };
}

async function deepl(text, target, key, fetch) {
  if (!key) throw new Error('DeepL key missing');
  const host = key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const body = new URLSearchParams();
  for (const piece of chunk(text, 20000)) body.append('text', piece);
  body.set('target_lang', DEEPL_TARGET[target] || target.toUpperCase());
  const response = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const translations = data.translations || [];
  return { text: translations.map((t) => t.text).join(''), source: translations[0] ? String(translations[0].detected_source_language || '').toLowerCase().split('-')[0] : null };
}

/**
 * Translates `text` into `target`. When the text is already in `target`,
 * it is translated into `fallback` instead (e.g. Turkish text → English).
 */
async function translate(text, { target = 'tr', fallback = 'en', provider = 'google', key = '', fetch }) {
  const run = (to) => (provider === 'deepl' ? deepl(text, to, key, fetch) : google(text, to, fetch));
  let to = target;
  let result = await run(to);
  if (result.source && result.source === target && fallback && fallback !== target) {
    to = fallback;
    result = await run(to);
  }
  return { text: result.text, source: result.source, target: to, provider };
}

module.exports = { translate, chunk, unwrapOcr, parseGoogle, LANGUAGES };
