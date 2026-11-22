'use strict';
// Version check against GitHub Releases (Mehmetsndl/halka).
// Installed (NSIS) builds use electron-updater: the update downloads in the
// background and installs on restart. The portable build cannot replace itself,
// so it only announces the new version and opens the release page.

const pkg = require('../package.json');

const publish = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
const REPO = `${publish.owner || 'Mehmetsndl'}/${publish.repo || 'halka'}`;
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Compares dotted versions ("v0.10.1" vs "0.9.3"). Pre-release tags sort before the release. */
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ''] = String(v || '0').trim().replace(/^v/i, '').split('-', 2);
    return { parts: core.split('.').map((n) => parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] || 0) - (y.parts[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** Reads the latest GitHub release: { version, url, portableUrl, notes }. */
async function latestRelease(fetch) {
  const response = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Halka' } });
  if (response.status === 404) return null; // no release published yet
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.draft || data.prerelease) return null;
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const portable = assets.find((asset) => /portable.*\.exe$/i.test(asset.name));
  return {
    version: String(data.tag_name || data.name || '').replace(/^v/i, ''),
    url: data.html_url || RELEASES_URL,
    portableUrl: portable ? portable.browser_download_url : null,
    notes: typeof data.body === 'string' ? data.body.slice(0, 600) : ''
  };
}

class Updater {
  constructor({ app, fetch, notify, onState, isEnabled }) {
    this.app = app;
    this.fetch = fetch;
    this.notify = notify; // (kind, info) => void
    this.onState = onState || (() => {});
    this.isEnabled = isEnabled || (() => true);
    this.state = { status: 'idle', current: app.getVersion(), repo: REPO };
    this.timer = null;
    this.autoUpdater = null;
    this.announced = null;
  }

  get installed() {
    return this.app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  setupAutoUpdater() {
    if (this.autoUpdater) return this.autoUpdater;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'latest', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', latest: info.version, progress: 0 }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', latest: info.version, checkedAt: Date.now() });
      if (this.announced !== info.version) { this.announced = info.version; this.notify('ready', { version: info.version }); }
    });
    autoUpdater.on('error', (error) => this.set({ status: 'error', error: String(error && error.message || error).slice(0, 200) }));
    this.autoUpdater = autoUpdater;
    return autoUpdater;
  }

  /** Checks GitHub now. `silent` checks only show a notification when something new exists. */
  async check({ silent = false } = {}) {
    if (['checking', 'downloading'].includes(this.state.status)) return this.state;
    if (!this.app.isPackaged) {
      this.set({ status: 'dev' });
      return this.state;
    }
    if (this.installed) {
      try {
        await this.setupAutoUpdater().checkForUpdates();
      } catch (error) {
        this.set({ status: 'error', error: String(error && error.message || error).slice(0, 200) });
      }
      return this.state;
    }
    this.set({ status: 'checking' });
    try {
      const release = await latestRelease(this.fetch);
      if (release && compareVersions(release.version, this.state.current) > 0) {
        this.set({ status: 'available', latest: release.version, url: release.portableUrl || release.url, page: release.url, checkedAt: Date.now() });
        if (!silent || this.announced !== release.version) {
          this.announced = release.version;
          this.notify('available', { version: release.version, url: release.portableUrl || release.url, page: release.url });
        }
      } else {
        this.set({ status: 'latest', checkedAt: Date.now() });
      }
    } catch (error) {
      this.set({ status: 'error', error: String(error && error.message || error).slice(0, 200) });
    }
    return this.state;
  }

  /** Restarts into the downloaded update (installed builds). */
  install() {
    if (this.autoUpdater && this.state.status === 'ready') this.autoUpdater.quitAndInstall(true, true);
  }

  start() {
    clearInterval(this.timer);
    const tick = () => { if (this.isEnabled()) this.check({ silent: true }); };
    setTimeout(tick, 15_000);
    this.timer = setInterval(tick, 6 * 3600_000);
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { Updater, compareVersions, latestRelease, REPO, RELEASES_URL };
