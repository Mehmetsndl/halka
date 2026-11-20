'use strict';
// Pure text transforms used by the "Metin" ring. Turkish-aware casing so that
// "istanbul" becomes "İSTANBUL" and "IŞIK" becomes "ışık" when the UI is Turkish.

function locale(language) {
  return language === 'tr' ? 'tr-TR' : undefined;
}

function titleCase(text, language) {
  const loc = locale(language);
  return text.toLocaleLowerCase(loc).replace(/(^|[\s\-_/("'“‘])(\p{L})/gu, (_, gap, letter) => gap + letter.toLocaleUpperCase(loc));
}

function slug(text) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u', ß: 'ss' };
  return text
    .replace(/[çğıİöşüÇĞÖŞÜß]/g, (c) => map[c])
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tidyWhitespace(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatJson(text) {
  const value = JSON.parse(text.trim());
  return JSON.stringify(value, null, 2);
}

function base64Toggle(text) {
  const trimmed = text.trim();
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.replace(/\s/g, '').length % 4 === 0 && trimmed.length >= 4) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      // Only accept a decode that round-trips and is printable text.
      if (Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '') === trimmed.replace(/\s/g, '').replace(/=+$/, '') && !/[\u0000-\u0008\u000e-\u001f�]/.test(decoded)) {
        return decoded;
      }
    } catch { /* fall through to encode */ }
  }
  return Buffer.from(text, 'utf8').toString('base64');
}

function count(text) {
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return { chars: [...text].length, words, lines: text ? text.split(/\r?\n/).length : 0 };
}

function transform(kind, text, language = 'en') {
  const loc = locale(language);
  switch (kind) {
    case 'upper': return text.toLocaleUpperCase(loc);
    case 'lower': return text.toLocaleLowerCase(loc);
    case 'titleCase': return titleCase(text, language);
    case 'trim': return tidyWhitespace(text);
    case 'json': return formatJson(text);
    case 'slug': return slug(text);
    case 'base64': return base64Toggle(text);
    default: throw new Error(`Unknown transform: ${kind}`);
  }
}

module.exports = { transform, count, slug, titleCase, tidyWhitespace, base64Toggle };
