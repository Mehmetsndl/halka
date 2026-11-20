'use strict';
// Local clipboard history: three shelves (images, texts, links) kept in one
// JSON index plus image files on disk. Nothing leaves the computer.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LINK = /^(https?:\/\/|www\.)[^\s]+$/i;

function classifyText(text) {
  const trimmed = text.trim();
  return LINK.test(trimmed) && !/\s/.test(trimmed) ? 'link' : 'text';
}

function hash(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

class HistoryStore {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.imageDir = path.join(directory, 'images');
    this.file = path.join(directory, 'history.json');
    this.options = { retentionDays: 30, maxItems: 400, ...options };
    this.items = [];
    this.listeners = new Set();
    this.saveTimer = null;
    fs.mkdirSync(this.imageDir, { recursive: true });
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data.items)) this.items = data.items.filter((item) => item && item.id && item.kind);
    } catch { this.items = []; }
    this.prune();
  }

  configure(options) {
    Object.assign(this.options, options);
    if (this.prune()) this.changed();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed() {
    for (const listener of this.listeners) listener();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.saveTimer);
    const temp = this.file + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, items: this.items }));
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.error('[halka] could not save history', error);
    }
  }

  imagePath(item) {
    return path.join(this.imageDir, `${item.id}.png`);
  }

  thumbPath(item) {
    return path.join(this.imageDir, `${item.id}.thumb.png`);
  }

  /** Adds copied text. Re-copying the same text refreshes its card instead of duplicating it. */
  addText(text, source = '') {
    if (typeof text !== 'string' || !text.trim() || text.length > 1_000_000) return null;
    const digest = hash(text);
    const existing = this.items.find((item) => item.hash === digest);
    if (existing) {
      existing.created = Date.now();
      this.moveToFront(existing);
      this.changed();
      return existing;
    }
    const item = { id: crypto.randomUUID(), kind: classifyText(text), text, hash: digest, created: Date.now(), pinned: false, source };
    this.items.unshift(item);
    this.prune();
    this.changed();
    return item;
  }

  /** Adds a copied image. `png` is the full PNG, `thumb` a small PNG preview. */
  addImage(png, thumb, size, source = '') {
    if (!png || !png.length) return null;
    const digest = hash(png);
    const existing = this.items.find((item) => item.hash === digest);
    if (existing) {
      existing.created = Date.now();
      this.moveToFront(existing);
      this.changed();
      return existing;
    }
    const item = { id: crypto.randomUUID(), kind: 'image', hash: digest, created: Date.now(), pinned: false, width: size.width, height: size.height, bytes: png.length, source };
    fs.writeFileSync(this.imagePath(item), png);
    if (thumb && thumb.length) fs.writeFileSync(this.thumbPath(item), thumb);
    this.items.unshift(item);
    this.prune();
    this.changed();
    return item;
  }

  moveToFront(item) {
    const index = this.items.indexOf(item);
    if (index > 0) {
      this.items.splice(index, 1);
      this.items.unshift(item);
    }
  }

  get(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  touch(id) {
    const item = this.get(id);
    if (!item) return;
    item.created = Date.now();
    this.moveToFront(item);
    this.changed();
  }

  togglePin(id) {
    const item = this.get(id);
    if (!item) return null;
    item.pinned = !item.pinned;
    this.changed();
    return item;
  }

  remove(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [item] = this.items.splice(index, 1);
    this.deleteFiles(item);
    this.changed();
    return item;
  }

  clear(keepPinned = true) {
    const removed = this.items.filter((item) => !(keepPinned && item.pinned));
    this.items = this.items.filter((item) => keepPinned && item.pinned);
    removed.forEach((item) => this.deleteFiles(item));
    this.changed();
  }

  deleteFiles(item) {
    if (item.kind !== 'image') return;
    for (const file of [this.imagePath(item), this.thumbPath(item)]) fs.rm(file, { force: true }, () => {});
  }

  /** Drops expired and overflowing items. Pinned items are always kept. */
  prune() {
    const cutoff = Date.now() - this.options.retentionDays * 86_400_000;
    const keep = [];
    const drop = [];
    let unpinned = 0;
    for (const item of this.items) {
      if (item.pinned) keep.push(item);
      else if (item.created >= cutoff && unpinned < this.options.maxItems) { keep.push(item); unpinned++; }
      else drop.push(item);
    }
    if (!drop.length) return false;
    this.items = keep;
    drop.forEach((item) => this.deleteFiles(item));
    return true;
  }

  /** What the renderer receives: no full text bodies beyond a preview-friendly length. */
  snapshot() {
    return this.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      text: item.text ? item.text.slice(0, 4000) : undefined,
      length: item.text ? item.text.length : undefined,
      created: item.created,
      pinned: item.pinned,
      width: item.width,
      height: item.height,
      source: item.source
    }));
  }
}

module.exports = { HistoryStore, classifyText };
