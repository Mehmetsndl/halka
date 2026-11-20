'use strict';
// Development harness: renders every Halka surface off-screen, saves PNG
// captures and exercises the conversion worker. Run with `npm run capture`.

const { nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fileTools = require('./file-tools.cjs');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function snap(window, file, rect) {
  await delay(220);
  const image = await window.webContents.capturePage(rect);
  fs.writeFileSync(file, image.toPNG());
  console.log('[capture] wrote', path.basename(file), image.getSize());
}

function seed(store, ROOT) {
  store.clear(false);
  const texts = [
    'Toplantı notları: Pazartesi 10:00 — tasarım incelemesi, sprint planlaması ve sürüm 0.2 için yapılacaklar listesi.',
    '{"name":"halka","version":"0.1.0","private":true}',
    'Merhaba Mehmet, dosyaları ekte gönderiyorum. Görüşmek üzere!',
    'npm run dist -- --win portable',
    'İstanbul, Kadıköy — Moda Caddesi No: 12',
    'const ring = new Halka({ hotkey: "Ctrl+Alt+Space" });'
  ];
  const links = ['https://github.com/orkunisitmak/nashi-app', 'https://github.com/orkunisitmak/clipboardline', 'https://www.figma.com/file/abc123/Halka-ring', 'https://developer.apple.com/design/human-interface-guidelines'];
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png'));
  const colors = ['#ffcc00', '#34c759', '#ff2d55', '#5856d6'];
  colors.forEach((color, i) => {
    const w = 480; const h = 320;
    const [r, g, b] = [1, 3, 5].map((o) => parseInt(color.slice(o, o + 2), 16));
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (x + y) / (w + h); const o = (y * w + x) * 4;
      const inCircle = (x - 140 - i * 60) ** 2 + (y - 160) ** 2 < 70 ** 2;
      buf[o] = Math.round(b * (1 - k) + 30 * k) + (inCircle ? 40 : 0); buf[o + 1] = Math.round(g * (1 - k) + 30 * k) + (inCircle ? 40 : 0); buf[o + 2] = Math.min(255, Math.round(r * (1 - k) + 34 * k) + (inCircle ? 40 : 0)); buf[o + 3] = 255;
    }
    const pic = nativeImage.createFromBitmap(buf, { width: w, height: h });
    store.addImage(pic.toPNG(), pic.resize({ width: 320 }).toPNG(), pic.getSize());
  });
  store.addImage(icon.toPNG(), icon.resize({ width: 320 }).toPNG(), icon.getSize());
  links.forEach((link) => store.addText(link));
  texts.forEach((text) => store.addText(text));
  store.items[3].pinned = true;
  store.items[7].pinned = true;
}

async function run({ overlay, toast, worker, store, settings, applySettings, uiState, toggleRing, runAction, pasteItem, startWatcher, clip, setTranslateFetch, workerCall, openSettings, getSettingsWindow, ROOT }) {
  const out = process.env.HALKA_CAPTURE_OUT || path.join(ROOT, 'captures');
  fs.mkdirSync(out, { recursive: true });
  await delay(1200);
  seed(store, ROOT);

  const viewport = { width: 1280, height: 800 };
  overlay.setBounds({ x: 0, y: 0, ...viewport });
  overlay.show();
  const exec = (code) => overlay.webContents.executeJavaScript(code);
  const open = async (extra) => {
    overlay.webContents.send('halka:open', {
      mode: 'ring', cursor: { x: 640, y: 400 }, viewport, clipboard: { kind: 'text', preview: 'Merhaba Mehmet, dosyaları ekte…' }, filesPending: false, history: store.snapshot(), ...uiState(), ...extra
    });
    await delay(450);
  };
  const files = (list) => overlay.webContents.send('halka:files', { files: list });

  for (const theme of ['light', 'dark']) {
    applySettings({ theme, language: 'tr' });
    await open();
    await snap(overlay, path.join(out, `ring-${theme}.png`));
    await exec('__halka.setHot(0)');
    await snap(overlay, path.join(out, `ring-${theme}-hover.png`));
    files([{ path: 'C:\\Users\\orkun\\Desktop\\tatil.jpg', name: 'tatil.jpg', image: true }, { path: 'C:\\Users\\orkun\\Desktop\\logo.png', name: 'logo.png', image: true }, { path: 'C:\\Users\\orkun\\Desktop\\rapor.docx', name: 'rapor.docx', image: false }]);
    await delay(100);
    await exec("__halka.enterSub('convert')");
    await delay(450);
    await exec('__halka.setHot(2)');
    await snap(overlay, path.join(out, `convert-${theme}.png`));
    await exec("__halka.state.ring='main'; __halka.enterSub('text')");
    await delay(450);
    await exec('__halka.setHot(0)');
    await snap(overlay, path.join(out, `text-${theme}.png`));
    await exec('__halka.openPanel({ fromRing: true })');
    await delay(450);
    await exec('__halka.select(1, 1)');
    await snap(overlay, path.join(out, `panel-${theme}.png`));
    await exec('__halka.openPreview()');
    await delay(300);
    await snap(overlay, path.join(out, `preview-${theme}.png`));
  }
  applySettings({ theme: 'light', accent: 'orange', ringSize: 'large' });
  await open({ clipboard: { kind: 'image' } });
  await exec('__halka.setHot(5)');
  await snap(overlay, path.join(out, 'ring-orange-large.png'));
  applySettings({ accent: 'blue', ringSize: 'medium', language: 'en' });
  await open({ mode: 'clipboard', cursor: { x: 640, y: 120 } });
  await exec("document.getElementById('search').value='halka'; document.getElementById('search').dispatchEvent(new Event('input'))");
  await delay(200);
  await snap(overlay, path.join(out, 'panel-search-en.png'));

  // Interaction checks: keyboard + pointer drive the ring and panel like a user would.
  const key = async (keyCode, modifiers = []) => {
    overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1) overlay.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
    overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await delay(120);
  };
  const look = () => exec('({ view: __halka.state.view, ring: __halka.state.ring, hot: __halka.state.hot, query: __halka.state.query, sel: __halka.state.sel, filter: __halka.state.filter, pinnedOnly: __halka.state.pinnedOnly })');
  const checks = [];
  const expect = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); };
  overlay.focus();
  await open();
  await key('Up'); let s = await look(); expect('ArrowUp picks the top slice', s.hot === 0, s);
  await key('Right'); await key('Right'); s = await look(); expect('ArrowRight walks clockwise', s.hot === 2, s);
  await key('Return'); await delay(300); s = await look(); expect('Enter opens the Text sub-ring', s.ring === 'text', s);
  await key('Escape'); s = await look(); expect('Esc returns to the main ring', s.ring === 'main' && s.view === 'ring', s);
  overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 640 + 110, y: 400 }); await delay(120);
  s = await look(); expect('Pointer to the right highlights slice 3', s.hot === 2, s);
  overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 640, y: 400 - 110 }); await delay(120);
  s = await look(); expect('Pointer upward highlights slice 1', s.hot === 0, s);
  await key('k'); await delay(300); s = await look(); expect('Typing jumps into clipboard search', s.view === 'panel' && s.query === 'k', s);
  await key('Escape'); s = await look(); expect('Esc clears the search first', s.view === 'panel' && s.query === '', s);
  await key('Tab'); s = await look(); expect('Tab cycles shelf filter', s.filter === 'image', s);
  await key('Tab'); await key('Tab'); await key('Tab'); s = await look(); expect('Tab wraps to All', s.filter === 'all', s);
  await exec('__halka.select(0, 0)'); await key('Down'); await key('Right'); s = await look(); expect('Arrows move the selection', s.sel.row === 1 && s.sel.col === 1, s);
  const segment = await exec(`(() => { const r = document.querySelectorAll('#segments button')[2].getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  for (const type of ['mouseDown', 'mouseUp']) overlay.webContents.sendInputEvent({ type, x: segment.x, y: segment.y, button: 'left', clickCount: 1 });
  await delay(250);
  s = await look(); expect('Clicking a shelf tab switches it and keeps the panel open', s.view === 'panel' && s.filter === 'text', s);
  const segment0 = await exec(`(() => { const r = document.querySelectorAll('#segments button')[0].getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  for (const type of ['mouseDown', 'mouseUp']) overlay.webContents.sendInputEvent({ type, x: segment0.x, y: segment0.y, button: 'left', clickCount: 1 });
  await delay(250);
  s = await look(); expect('Clicking "All" goes back', s.view === 'panel' && s.filter === 'all', s);
  await key('f'); s = await look(); expect('F toggles pinned-only', s.pinnedOnly === true, s);
  await key('f'); await key('Escape'); await delay(150); s = await look(); expect('Esc from a ring-opened panel goes back to the ring', s.view === 'ring', s);
  await key('Escape'); await delay(250); s = await look(); expect('Esc on the main ring closes', s.view === 'idle', s);
  console.log('[capture] interaction checks');
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : '  ' + JSON.stringify(c.detail)}`);
  fs.writeFileSync(path.join(out, 'interaction-report.json'), JSON.stringify(checks, null, 2));
  overlay.hide();

  // Toast
  applySettings({ language: 'tr' });
  toast.setBounds({ x: 0, y: 0, width: 380, height: 104 });
  toast.webContents.send('toast:show', { title: '3 dosya hazır', body: 'tatil.webp, logo.webp, kapak.webp', tone: 'success', duration: 60000, actions: [{ label: 'Klasörde göster', kind: 'reveal', value: '' }], ...uiState() });
  toast.showInactive();
  await delay(500);
  await snap(toast, path.join(out, 'toast.png'));
  toast.hide();

  // Settings window
  for (const theme of ['light', 'dark']) {
    applySettings({ theme });
    openSettings('shortcut');
    await delay(900);
    const win = getSettingsWindow();
    for (const section of ['general', 'shortcut', 'clipboard', 'appearance', 'about']) {
      win.webContents.send('settings:section', section);
      await delay(250);
      await snap(win, path.join(out, `settings-${section}-${theme}.png`));
    }
    win.destroy();
    await delay(200);
  }

  // Conversion worker end-to-end
  const work = path.join(out, 'convert-test');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png'));
  fs.writeFileSync(path.join(work, 'logo.png'), icon.toPNG());
  fs.writeFileSync(path.join(work, 'foto.jpg'), icon.toJPEG(90));
  fs.writeFileSync(path.join(work, 'vektör.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" rx="30" fill="#0a84ff"/></svg>');
  fs.writeFileSync(path.join(work, 'not.txt'), 'hello');
  const convertImage = async (bytes, options) => {
    const result = await workerCall('image', { bytes: new Uint8Array(bytes), ...options });
    return { ...result, bytes: Buffer.from(result.bytes) };
  };
  const inputs = ['logo.png', 'foto.jpg', 'vektör.svg', 'not.txt'].map((f) => path.join(work, f));
  const report = {};
  for (const action of ['png', 'jpg', 'webp', 'half', 'compress', 'ico', 'pdf']) {
    report[action] = await fileTools.runFileAction(action, inputs, { convertImage, suffixes: { half: 'küçük', compressed: 'sıkıştırılmış' } });
  }
  // QR: draw a code with an online-free approach — reuse jsQR's own test via a generated image is not available, so only check "no code" path.
  const qr = await workerCall('qr', { bytes: new Uint8Array(icon.toPNG()) });
  report.qrNone = qr;
  for (const [action, result] of Object.entries(report)) {
    if (result.outputs) result.outputs = result.outputs.map((file) => `${path.basename(file)} (${fs.statSync(file).size} B)`);
  }
  fs.writeFileSync(path.join(out, 'convert-report.json'), JSON.stringify(report, null, 2));
  console.log('[capture] conversion report', JSON.stringify(report, null, 2));
  // End-to-end: the real main-process paths (clipboard watcher, ring, actions) on this platform.
  const e2e = [];
  const check = (name, ok, detail) => e2e.push({ name, ok: Boolean(ok), detail });
  await startWatcher();
  await clip.writeText('e2e metin 1');
  await delay(1600);
  check('Copied text lands on the Texts shelf', store.items[0] && store.items[0].text === 'e2e metin 1', store.items[0] && store.items[0].text);
  await clip.writeText('https://example.com/e2e');
  await delay(1600);
  check('Copied URL lands on the Links shelf', store.items[0] && store.items[0].kind === 'link', store.items[0] && store.items[0].kind);
  const qrPng = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'qr-screenshot.png'));
  await clip.writeImagePng(qrPng);
  await delay(2200);
  check('Copied image lands on the Images shelf', store.items[0] && store.items[0].kind === 'image', store.items[0] && store.items[0].kind);
  await runAction('qr');
  await delay(300);
  check('QR slice decodes the clipboard image', (await clip.readText()) === 'https://github.com/Mehmetsndl/halka', await clip.readText());
  applySettings({ language: 'tr' });
  await clip.writeText('istanbul ışıkları');
  await delay(1300);
  await runAction('text', { kind: 'upper' });
  check('Text slice uses Turkish casing', (await clip.readText()) === 'İSTANBUL IŞIKLARI', await clip.readText());
  const older = store.items.find((item) => item.text === 'e2e metin 1');
  await pasteItem(older.id);
  await delay(200);
  check('Pasting a history card puts it back on the clipboard', (await clip.readText()) === 'e2e metin 1' && store.items[0].id === older.id, await clip.readText());
  const imageItem = store.items.find((item) => item.kind === 'image');
  await pasteItem(imageItem.id);
  await delay(1300);
  check('Re-pasting an image does not duplicate it', store.items.filter((item) => item.kind === 'image' && item.bytes === imageItem.bytes).length === 1, store.items.filter((i) => i.kind === 'image').length);
  await toggleRing('ring');
  await delay(500);
  const view = await overlay.webContents.executeJavaScript('__halka.state.view');
  check('Hotkey handler opens the ring', overlay.isVisible() && view === 'ring', view);
  await toggleRing('ring');
  await delay(400);
  check('Hotkey again closes it', !overlay.isVisible(), overlay.isVisible());
  // Translation + OCR, with the network replaced by a fake translator.
  const asked = [];
  setTranslateFetch(async (url) => {
    const u = new URL(url);
    const q = u.searchParams.get('q');
    const tl = u.searchParams.get('tl');
    asked.push(tl);
    await delay(400);
    const fake = { tr: 'Hızlı kahverengi tilki tembel köpeğin üzerinden atlar. Lütfen uygulama penceresini kapatmadan önce değişikliklerinizi kaydedin.', de: 'Der schnelle braune Fuchs springt über den faulen Hund.' }[tl] || `[${tl}] ${q}`;
    return { ok: true, json: async () => [[[fake, q, null, null, 10]], null, 'en'] };
  });
  applySettings({ language: 'tr', theme: 'light', translateTarget: 'auto' });
  await clip.writeImagePng(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'ocr-english.png')));
  await delay(1300);
  const pending = runAction('translate', { kind: 'image' });
  await delay(150);
  await snap(overlay, path.join(out, 'translate-loading.png'));
  await pending;
  await delay(300);
  let r = await overlay.webContents.executeJavaScript('__halka.state.result');
  check('Image translation reads the text offline', r && /quick brown fox/i.test(r.source || ''), r && r.source);
  check('…and shows the translation', r && r.stage === 'done' && /tilki/.test(r.text) && r.target === 'tr' && r.detected === 'en', r);
  await snap(overlay, path.join(out, 'translate-light.png'));
  await overlay.webContents.executeJavaScript(`(() => { const s = document.getElementById('result-lang'); s.value = 'de'; s.dispatchEvent(new Event('change')); })()`);
  await delay(900);
  r = await overlay.webContents.executeJavaScript('__halka.state.result');
  check('Changing the language re-translates', r.stage === 'done' && /Fuchs/.test(r.text) && asked[asked.length - 1] === 'de', { text: r.text, asked });
  await runAction('resultCopy');
  check('Copy puts the translation on the clipboard', (await clip.readText()).includes('Fuchs'), await clip.readText());
  applySettings({ theme: 'dark', translateTarget: 'auto' });
  await clip.writeText('Please save your changes before closing the application window.');
  await delay(1200);
  await runAction('translate', { kind: 'text' });
  await delay(300);
  r = await overlay.webContents.executeJavaScript('__halka.state.result');
  check('Text translation uses the clipboard when nothing is selected', r.stage === 'done' && r.source.startsWith('Please save') && asked[asked.length - 1] === 'tr', r);
  await snap(overlay, path.join(out, 'translate-dark.png'));
  applySettings({ theme: 'light' });
  await clip.writeImagePng(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'ocr-turkish.png')));
  await delay(1300);
  await runAction('translate', { kind: 'ocr' });
  await delay(300);
  check('Image to text copies Turkish text exactly', (await clip.readText()) === "Değişiklikleri kaydetmeyi unutmayın. Şişli'de güzel bir gün, ılık ve güneşli.", await clip.readText());
  await snap(overlay, path.join(out, 'ocr-light.png'));
  overlay.hide();
  await open();
  await exec("__halka.enterSub('translate')");
  await delay(450);
  await exec('__halka.setHot(1)');
  await snap(overlay, path.join(out, 'translate-ring.png'));
  overlay.hide();
  console.log('[capture] end-to-end checks');
  for (const c of e2e) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : '  ' + JSON.stringify(c.detail)}`);
  fs.writeFileSync(path.join(out, 'e2e-report.json'), JSON.stringify(e2e, null, 2));
  console.log('[capture] done');
  require('electron').app.exit(0);
}

module.exports = { run };
