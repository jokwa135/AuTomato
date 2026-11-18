const { app, BrowserWindow, WebContentsView, Menu, ipcMain, dialog, session, shell, nativeImage, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createBridge, safeUrl, validateUrl } = require('./bridge.cjs');
const { PageAutomation } = require('./automation.cjs');
const { DEFAULT_LAYOUT, DEFAULT_APPEARANCE, normalizeLayout, normalizeAppearance, themeTokens } = require('./preferences.cjs');
const storageTools = require('./storage.cjs');

const ROOT = path.resolve(__dirname, '..');
const storage = storageTools.prepareStorage();
const DATA = storage.dataDir;
const hadWorkspace = ['profile', 'assets', 'layout.json'].some(name => fs.existsSync(path.join(DATA, name)));
for (const name of ['', 'profile', 'cache', 'temp', 'assets', 'downloads', 'previews']) fs.mkdirSync(path.join(DATA, name), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(DATA, 'temp');
if (process.platform !== 'win32') process.env.TMPDIR = path.join(DATA, 'temp') + path.sep;
app.setName('AuTomato');
app.setPath('userData', path.join(DATA, 'profile'));
app.setPath('sessionData', path.join(DATA, 'profile'));
app.setPath('temp', path.join(DATA, 'temp'));
app.setPath('logs', path.join(DATA, 'logs'));
app.commandLine.appendSwitch('disk-cache-dir', path.join(DATA, 'cache'));
// Keep studios rendering while the window is covered or minimized, so agents can work without it on screen.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const STUDIOS = {
  higgsfield: { name: 'Higgsfield', url: 'https://higgsfield.ai/', partition: 'persist:higgsfield' },
  flow: { name: 'Flow', url: 'https://flow.google.com/', partition: 'persist:flow' },
  symphony: { name: 'Symphony', url: 'https://ads.tiktok.com/creative/creativestudio/home/en', partition: 'persist:symphony' },
  tiktok: { name: 'TikTok Studio', url: 'https://www.tiktok.com/tiktokstudio/upload', partition: 'persist:tiktok' },
  capcut: { name: 'CapCut Web', url: 'https://www.capcut.com/my-edit', partition: 'persist:capcut' },
  clipscript: { name: 'ClipScript', url: 'https://clipscript.jsxcreatives.com/', partition: 'persist:clipscript' },
  // v7 (2026-11-16): product pages and their customer reviews, kept in their own session away from TikTok Studio posting.
  shop: { name: 'TikTok Shop', url: 'https://www.tiktok.com/shop', partition: 'persist:shop' }
};
const fixtureMode = process.env.AUTOMATO_TEST_MODE === '1';
const settingsFile = path.join(DATA, 'layout.json');
let layout = { ...DEFAULT_LAYOUT }, appearance = { ...DEFAULT_APPEARANCE };
try { layout = normalizeLayout(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch {}
const appearanceFile = path.join(DATA, 'appearance.json');
try { appearance = normalizeAppearance(JSON.parse(fs.readFileSync(appearanceFile, 'utf8'))); } catch {}
let window, appearanceWindow, setupWindow, bridge, restartPending = false, activeStudio = fixtureMode ? 'test' : 'higgsfield', nextId = 1;
let surface = { x: 280, y: 152, width: 900, height: 580 };
let quitting = false;
let assetsRevision = 0, resizing = false, resizeToken = 0, frontTab = null;
const tabs = new Map(); const selected = new Map(); const sessions = new Set();
const automation = new PageAutomation();

// ---- Multi-agent studios, suspension and download attribution ----
const LEASE_MS = 10 * 60 * 1000;
const leases = new Map();          // studio -> { owner, expires }
const suspended = new Map();       // studio -> { url, title, at, reason }
const activeDownloads = new Map(); // studio -> count of downloads in progress
const downloadIndexFile = path.join(DATA, 'downloads-index.json');
let downloadLog = [];
try { downloadLog = JSON.parse(fs.readFileSync(downloadIndexFile, 'utf8')); if (!Array.isArray(downloadLog)) downloadLog = []; } catch {}
const suspendFile = path.join(DATA, 'suspend.json');
let suspendSettings = { enabled: true, idleMinutes: 15 };
try { suspendSettings = normalizeSuspend(JSON.parse(fs.readFileSync(suspendFile, 'utf8'))); } catch {}

function normalizeSuspend(value = {}, base = { enabled: true, idleMinutes: 15 }) {
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : base.enabled;
  const minutes = Number(value.idleMinutes);
  return { enabled, idleMinutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 720 ? Math.round(minutes) : base.idleMinutes };
}
function codedError(code, message, extra = {}) { const error = new Error(message); error.code = code; Object.assign(error, extra); return error; }
function studioName(id) { return STUDIOS[id]?.name || id; }
function knownStudio(id) { if (!STUDIOS[id] && !(fixtureMode && id === 'test')) throw codedError('BAD_ARGS', 'Unknown studio'); return id; }
function partitionStudio(partition) { return Object.keys(STUDIOS).find(id => STUDIOS[id].partition === partition) || 'test'; }
function lease(studio) {
  const held = leases.get(studio);
  if (held && held.expires <= Date.now()) { leases.delete(studio); return null; }
  return held || null;
}
function checkLease(studio, owner) {
  const held = lease(studio);
  if (held && held.owner !== owner) {
    const seconds = Math.ceil((held.expires - Date.now()) / 1000);
    throw codedError('STUDIO_LEASED', `${studioName(studio)} is in use by agent ${held.owner} (frees in ${seconds}s)`, { retryAfter: seconds, leasedBy: held.owner });
  }
  if (owner) { const fresh = !held; leases.set(studio, { owner: String(owner), expires: Date.now() + LEASE_MS }); if (fresh) publish(); }
}
function touch(tab) { if (tab) tab.lastUsed = Date.now(); }
function studioTabs(studio) { return [...tabs.values()].filter(tab => tab.studio === studio && !tab.view.webContents.isDestroyed()); }
function saveDownloadIndex() {
  if (downloadLog.length > 2000) downloadLog = downloadLog.slice(-2000);
  try { fs.writeFileSync(downloadIndexFile, JSON.stringify(downloadLog)); } catch {}
}
function waitLoaded(tab, ms) {
  const wc = tab.view.webContents;
  if (!wc.isLoading() && wc.getURL()) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = value => { clearTimeout(timer); wc.removeListener('did-stop-loading', stop); resolve(value); };
    const stop = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    wc.on('did-stop-loading', stop);
  });
}
// Create or wake a studio in the background without changing what is on screen.
async function ensureTab(studio) {
  knownStudio(studio);
  const existing = tabs.get(selected.get(studio));
  if (existing && !existing.view.webContents.isDestroyed()) return existing;
  const saved = suspended.get(studio);
  suspended.delete(studio);
  const url = saved?.url || (studio === 'test' ? require('node:url').pathToFileURL(path.join(__dirname, 'fixture.html')).href : STUDIOS[studio].url);
  const tab = createTab(studio, url);
  await waitLoaded(tab, 20000);
  return tab;
}
async function targetTab(args = {}) {
  let tab;
  if (args.tab != null) {
    tab = tabs.get(Number(args.tab));
    if (!tab || tab.view.webContents.isDestroyed()) throw codedError('NO_TAB', 'Tab not found');
    checkLease(tab.studio, args.owner);
  } else if (args.studio) {
    checkLease(knownStudio(args.studio), args.owner);
    tab = await ensureTab(args.studio);
  } else {
    tab = assertTab();
    checkLease(tab.studio, args.owner);
  }
  touch(tab);
  return tab;
}
// Element references remember their tab, so ref-based commands never depend on what is on screen.
function refTab(args = {}) {
  const value = automation.references.get(args.ref);
  if (!value || value.tab.view.webContents.isDestroyed()) throw codedError('STALE_REF', 'Stale element reference. Inspect the current tab again.');
  const tab = value.tab;
  if (args.studio && tab.studio !== args.studio) throw codedError('BAD_ARGS', `That reference belongs to ${studioName(tab.studio)}, not ${studioName(args.studio)}`);
  checkLease(tab.studio, args.owner);
  touch(tab);
  return tab;
}
function suspendStudio(id, reason = 'manual') {
  if (!STUDIOS[id]) throw codedError('BAD_ARGS', 'Unknown studio');
  const held = lease(id);
  if (held) throw codedError('STUDIO_LEASED', `${studioName(id)} is in use by agent ${held.owner}; it cannot be suspended until released`, { retryAfter: Math.ceil((held.expires - Date.now()) / 1000), leasedBy: held.owner });
  if ((activeDownloads.get(id) || 0) > 0) throw codedError('BUSY', `${studioName(id)} is still downloading a file`);
  const own = studioTabs(id);
  if (!own.length) return { suspended: id, already: suspended.has(id) };
  // Only automatic suspension spares a studio that is playing audio; a manual suspend is an explicit request.
  if (reason === 'idle' && own.some(tab => tab.view.webContents.isCurrentlyAudible())) throw codedError('BUSY', `${studioName(id)} is playing audio`);
  const chosen = tabs.get(selected.get(id)) || own.at(-1);
  suspended.set(id, { url: chosen.view.webContents.getURL() || STUDIOS[id].url, title: chosen.view.webContents.getTitle(), at: Date.now(), reason });
  for (const tab of own) {
    try { window.contentView.removeChildView(tab.view); } catch {}
    tab.view.webContents.close();
  }
  publish();
  return { suspended: id, reason };
}
function autoSuspend() {
  if (!suspendSettings.enabled || !window || window.isDestroyed()) return;
  const now = Date.now(), idleMs = suspendSettings.idleMinutes * 60000;
  for (const id of Object.keys(STUDIOS)) {
    if (id === activeStudio) continue;
    const own = studioTabs(id);
    if (!own.length) continue;
    const last = Math.max(...own.map(tab => tab.lastUsed || 0));
    if (now - last < idleMs) continue;
    try { suspendStudio(id, 'idle'); } catch {}
  }
}
function studioInfo(id) {
  const held = lease(id), own = studioTabs(id), now = Date.now();
  const last = own.length ? Math.max(...own.map(tab => tab.lastUsed || 0)) : 0;
  return {
    id, name: STUDIOS[id].name, loaded: own.length > 0, suspended: suspended.has(id),
    leasedBy: held?.owner || null, leaseSeconds: held ? Math.ceil((held.expires - now) / 1000) : 0,
    idleSeconds: own.length ? Math.round((now - last) / 1000) : null
  };
}

function currentTab() { return tabs.get(selected.get(activeStudio)); }
function assertTab() { const tab = currentTab(); if (!tab || tab.view.webContents.isDestroyed()) throw codedError('NO_TAB', suspended.has(activeStudio) ? `${studioName(activeStudio)} is suspended; switch to it or target it with studio to wake it` : 'No active website tab'); return tab; }
function uniquePath(folder, name) {
  const parsed = path.parse(path.basename(name)); let target = path.join(folder, parsed.base); let i = 1;
  while (fs.existsSync(target)) target = path.join(folder, `${parsed.name}-${i++}${parsed.ext}`);
  return target;
}
function state() {
  const tab = currentTab();
  return { name: 'AuTomato', version: require('../package.json').version, local: true, active: activeStudio,
    studios: Object.keys(STUDIOS).map(studioInfo),
    tabs: [...tabs.values()].map(t => ({ id: t.id, studio: t.studio, active: t.id === selected.get(t.studio), title: t.view.webContents.getTitle(), url: safeUrl(t.view.webContents.getURL()), loading: t.view.webContents.isLoading(), error: t.error || null })),
    suspendSettings, layout, appearance, assetsRevision, bounds: tab?.view.getBounds(), dataDir: DATA, assetsDir: path.join(DATA, 'assets'), downloadDir: path.join(DATA, 'downloads') };
}
function publish() {
  const snapshot = state();
  for (const target of [window, appearanceWindow]) if (target && !target.isDestroyed()) target.webContents.send('automato:state', snapshot);
}
function updateBounds() {
  if (!window || window.isDestroyed()) return;
  const size = window.getContentBounds();
  let x = Math.max(0, Math.round(surface.x)), y = Math.max(0, Math.round(surface.y));
  let w = Math.max(300, Math.round(surface.width || 900));
  let h = Math.max(200, Math.round(surface.height || 580));
  const bounds = { x, y, width: Math.max(300, Math.min(w, Math.max(1, size.width - x))), height: Math.max(200, Math.min(h, Math.max(1, size.height - y))) };
  const current = currentTab();
  for (const tab of tabs.values()) {
    if (tab.view.webContents.isDestroyed()) continue;
    // Every studio stays "visible" to Chromium (occlusion detection is off) so background pages render,
    // lazy-load and paint like the one on screen; the on-screen studio is simply stacked on top.
    // With no on-screen tab (its studio suspended) the others hide so they don't show through.
    const visible = !resizing && !!current && !current.view.webContents.isDestroyed();
    // A tab can ask for a minimum layout width (viewport command). Its page area then extends past the window's
    // right edge: the page lays out wide and refs/clicks work, whatever size or monitor the window is on.
    const own = tab.minWidth > bounds.width ? { ...bounds, width: tab.minWidth } : bounds;
    if (JSON.stringify(tab.bounds) !== JSON.stringify(own)) { tab.view.setBounds(own); tab.bounds = own; }
    if (visible !== tab.visible) { tab.view.setVisible(visible); tab.visible = visible; }
  }
  if (current && !current.view.webContents.isDestroyed() && frontTab !== current.id) {
    try { window.contentView.addChildView(current.view); } catch {}
    frontTab = current.id;
  }
}
function configureSession(partition) {
  if (sessions.has(partition)) return;
  sessions.add(partition);
  const s = session.fromPartition(partition);
  s.setPermissionRequestHandler((_contents, permission, done) => done(permission === 'clipboard-sanitized-write'));
  s.on('will-download', (_event, item) => {
    const target = uniquePath(path.join(DATA, 'downloads'), item.getFilename());
    item.setSavePath(target);
    const studio = partitionStudio(partition);
    const record = { file: target, studio, owner: lease(studio)?.owner || null, url: safeUrl(item.getURL()), started: Date.now(), state: 'progressing' };
    downloadLog.push(record); activeDownloads.set(studio, (activeDownloads.get(studio) || 0) + 1); saveDownloadIndex();
    item.once('done', (_e, result) => {
      record.state = result; record.finished = Date.now();
      activeDownloads.set(studio, Math.max(0, (activeDownloads.get(studio) || 1) - 1)); saveDownloadIndex();
      assetsRevision++; publish();
    });
  });
}
function createTab(studio, url, opener, inherited = {}) {
  const partition = STUDIOS[studio]?.partition || 'persist:automato-test';
  configureSession(partition);
  const view = new WebContentsView({ ...(inherited.webContents ? { webContents: inherited.webContents } : {}), webPreferences: { ...inherited.webPreferences, partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  try { view.webContents.incrementCapturerCount(undefined, false, true); } catch {}
  const tab = { id: nextId++, studio, view, opener, generation: 0, error: null, lastUsed: Date.now() };
  tabs.set(tab.id, tab); selected.set(studio, tab.id); suspended.delete(studio); window.contentView.addChildView(view);
  frontTab = null; // a new view lands on top; let updateBounds re-raise the on-screen studio
  const wc = view.webContents;
  wc.setWindowOpenHandler(details => {
    if (!['https:', 'http:'].includes(new URL(details.url).protocol) && !(fixtureMode && details.url.startsWith('file:'))) return { action: 'deny' };
    // Popups open inside their own studio; the screen only follows when that studio is already on screen.
    return { action: 'allow', createWindow: options => { const child = createTab(studio, null, tab.id, options); return child.view.webContents; } };
  });
  wc.on('will-navigate', (event, url) => { if (!['http:', 'https:'].includes(new URL(url).protocol) && !(fixtureMode && url.startsWith('file:'))) event.preventDefault(); });
  wc.on('did-start-navigation', (_e, _url, _inPlace, mainFrame) => { if (mainFrame) { tab.generation++; tab.error = null; automation.invalidate(tab); } });
  wc.on('input-event', () => touch(tab));
  for (const event of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate-in-page']) wc.on(event, publish);
  wc.on('did-fail-load', (_e, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) { tab.error = description; publish(); } });
  wc.on('destroyed', () => {
    automation.invalidate(tab); tabs.delete(tab.id);
    if (selected.get(studio) === tab.id) selected.set(studio, tabs.has(opener) ? opener : [...tabs.values()].filter(t => t.studio === studio).at(-1)?.id);
    if (!quitting) { updateBounds(); publish(); }
  });
  // Defer UI updates until Chromium has finished constructing window.open's child.
  if (opener) setImmediate(() => { updateBounds(); publish(); });
  else { updateBounds(); if (url) wc.loadURL(url).catch(() => {}); publish(); }
  return tab;
}
function switchStudio(id) {
  knownStudio(id);
  activeStudio = id;
  if (!tabs.has(selected.get(id))) {
    const saved = suspended.get(id);
    createTab(id, saved?.url || (id === 'test' ? require('node:url').pathToFileURL(path.join(__dirname, 'fixture.html')).href : STUDIOS[id].url));
  }
  touch(currentTab());
  updateBounds(); publish(); return state();
}
function listAssets() {
  const byFile = new Map(downloadLog.map(record => [record.file, record]));
  return ['assets', 'downloads'].flatMap(source => fs.readdirSync(path.join(DATA, source), { withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const file = path.join(DATA, source, e.name), stat = fs.statSync(file);
    const record = source === 'downloads' ? byFile.get(file) : null;
    return { name: e.name, path: file, source, size: stat.size, modified: stat.mtimeMs, ...(record ? { studio: record.studio, owner: record.owner, state: record.state } : {}) };
  })).sort((a, b) => b.modified - a.modified);
}
function approvedOutput(file) {
  if (!path.isAbsolute(file)) throw codedError('BAD_ARGS', 'Use an absolute output path');
  if (fs.existsSync(file)) throw codedError('BAD_ARGS', 'Output exists; choose a new path');
  fs.mkdirSync(path.dirname(file), { recursive: true }); return file;
}
async function capture(args) {
  const file = approvedOutput(path.resolve(args.path || uniquePath(path.join(DATA, 'previews'), 'capture.png')));
  const wc = args.shell ? window.webContents : (await targetTab(args)).view.webContents;
  let png, size, via = 'capturePage';
  try {
    const image = await wc.capturePage();
    if (image.isEmpty()) throw new Error('The page has no rendered content yet; wait for loading to finish');
    png = image.toPNG(); size = image.getSize();
  } catch (error) {
    // Minimized windows and background studios have no display surface: force repaints and retry, then render through DevTools with a time limit.
    if (args.shell) throw error;
    const limit = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('capture timed out')), ms))]);
    for (let i = 0; i < 4 && !png; i++) {
      try { wc.invalidate(); } catch {}
      await new Promise(resolve => setTimeout(resolve, 400));
      try { const image = await limit(wc.capturePage(), 3000); if (!image.isEmpty()) { png = image.toPNG(); size = image.getSize(); via = 'capturePage-retry'; } } catch {}
    }
    if (!png) {
      try {
        if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); try { await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch {} }
        const shot = await limit(wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' }), 8000);
        png = Buffer.from(shot.data, 'base64'); size = nativeImage.createFromBuffer(png).getSize(); via = 'devtools';
      } catch { throw codedError('CAPTURE_FAILED', error.message); }
    }
  }
  fs.writeFileSync(file, png, { flag: 'wx' });
  return { path: file, width: size.width, height: size.height, bytes: fs.statSync(file).size, via };
}
async function navigate(tab, url) {
  const wc = tab.view.webContents, before = wc.getURL(), target = validateUrl(url);
  try { await wc.loadURL(target); }
  catch (error) {
    // ERR_ABORTED (-3) is usually a client-side redirect; succeed when the page really moved.
    if (!/ERR_ABORTED|\(-3\)/.test(error.message)) throw error;
    await waitLoaded(tab, 10000);
    const now = wc.getURL();
    if (!now || (now === before && now !== target)) throw codedError('NAV_ABORTED', error.message);
  }
}
async function waitFor(tab, args) {
  const wc = tab.view.webContents;
  const ms = Math.min(60000, Math.max(500, (Number(args.timeout) || 20) * 1000));
  const until = args.until || 'idle', value = args.value == null ? '' : String(args.value), deadline = Date.now() + ms;
  if (until !== 'idle' && !value) throw codedError('BAD_ARGS', 'wait needs a value for ' + until);
  while (Date.now() < deadline) {
    if (until === 'idle' && !wc.isLoading()) return { ok: true, until, url: safeUrl(wc.getURL()) };
    if (until === 'url-contains' && wc.getURL().includes(value)) return { ok: true, until, url: safeUrl(wc.getURL()) };
    if (until === 'text') { const found = await automation.inspect(tab, { query: value, limit: 20 }); if (found.nodes.length) return { ok: true, until, ...found }; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw codedError('TIMEOUT', `Waited ${Math.round(ms / 1000)}s for ${until}${value ? ' "' + value + '"' : ''}`);
}
async function dispatch(command, args = {}) {
  if (args.dryRun && !['status', 'inspect', 'assets', 'tabs', 'studios'].includes(command)) return { dryRun: true, command };
  switch (command) {
    case 'status': return state();
    case 'studios': return state().studios;
    case 'switch': return switchStudio(args.studio);
    case 'tabs': return state().tabs;
    case 'select-tab': { const tab = tabs.get(Number(args.id)); if (!tab) throw codedError('NO_TAB', 'Tab not found'); activeStudio = tab.studio; selected.set(tab.studio, tab.id); touch(tab); updateBounds(); publish(); return state(); }
    case 'close-tab': { const tab = tabs.get(Number(args.id)); if (!tab) throw codedError('NO_TAB', 'Tab not found'); tab.view.webContents.close(); return { closed: tab.id }; }
    case 'ensure': { if (!args.studio) throw codedError('BAD_ARGS', 'ensure needs a studio'); const tab = await targetTab(args); return { tab: tab.id, studio: tab.studio, url: safeUrl(tab.view.webContents.getURL()), loading: tab.view.webContents.isLoading() }; }
    case 'navigate': { const tab = await targetTab(args); await navigate(tab, args.url); return state(); }
    case 'reload': (await targetTab(args)).view.webContents.reload(); return { reloading: true };
    case 'back': { const history = (await targetTab(args)).view.webContents.navigationHistory; if (history.canGoBack()) history.goBack(); return { back: true }; }
    case 'wait': return waitFor(await targetTab(args), args);
    // Type at the caret one character at a time, without selecting or replacing what is there. Editors that open a
    // suggestion list while you type (TikTok's hashtag picker) only react to typed input, not to a replaced field.
    case 'type': { const tab = await targetTab(args), text = String(args.text == null ? '' : args.text).slice(0, 2000), delay = Math.max(0, Math.min(500, Number(args.delay) || 60)); for (const ch of text) { await automation.cdp(tab, 'Input.insertText', { text: ch }); await new Promise(resolve => setTimeout(resolve, delay)); } return { typed: text.length }; }
    case 'viewport': { const tab = await targetTab(args); tab.minWidth = Math.max(0, Math.min(3840, Math.round(Number(args.width) || 0))); updateBounds(); await new Promise(resolve => setTimeout(resolve, 600)); const b = tab.view.getBounds(); return { minWidth: tab.minWidth, width: b.width, height: b.height }; }
    case 'inspect': return automation.inspect(await targetTab(args), args);
    // v7: read-only list of the images on the page (address, natural size, alt text). The accessibility tree that
    // `inspect` returns carries no image addresses, so review photos could be seen but not saved.
    case 'images': { const tab = await targetTab(args), min = Math.max(0, Math.min(4000, Math.round(Number(args.min) || 0))); const { result } = await automation.cdp(tab, 'Runtime.evaluate', { expression: `JSON.stringify(Array.from(document.images).map(i => ({ src: i.currentSrc || i.src || '', w: i.naturalWidth, h: i.naturalHeight, alt: (i.alt || '').slice(0, 80) })).concat(Array.from(document.querySelectorAll('body *')).slice(0, 20000).map(e => { const m = /url\\(["']?(https?:[^"')]+)/.exec(getComputedStyle(e).backgroundImage || ''); if (!m) return null; const r = e.getBoundingClientRect(); return { src: m[1], w: Math.round(r.width), h: Math.round(r.height), alt: (e.getAttribute('aria-label') || '').slice(0, 80), bg: true }; }).filter(Boolean)).filter(i => /^https?:/.test(i.src) && i.w >= ${min} && i.h >= ${min}).slice(0, 800))`, returnByValue: true }); return { url: safeUrl(tab.view.webContents.getURL()), images: JSON.parse((result && result.value) || '[]') }; }
    case 'click': return automation.click(refTab(args), args.ref);
    case 'hover': return automation.hover(refTab(args), args.ref);
    case 'fill': return automation.fill(refTab(args), args.ref, args.text);
    case 'press': {
      const keys = { Enter: ['Enter', 13], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39] };
      const [key, code] = keys[args.key] || (String(args.key).length === 1 ? [args.key, String(args.key).toUpperCase().charCodeAt(0)] : []);
      if (!key) throw codedError('BAD_ARGS', 'Use Enter, Tab, Escape, Backspace, Delete, an Arrow key or a single character');
      const tab = await targetTab(args);
      await automation.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, modifiers: Number(args.modifiers) || 0 });
      await automation.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers: Number(args.modifiers) || 0 });
      return { pressed: key };
    }
    case 'scroll': { const tab = await targetTab(args), size = tab.view.getBounds(); await automation.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: size.width / 2, y: size.height / 2, deltaX: 0, deltaY: Math.max(-3000, Math.min(3000, Number(args.delta) || 600)) }); return { scrolled: true }; }
    case 'upload': { const tab = refTab(args); const files = args.files.map(file => { const resolved = path.resolve(file); if (!fs.statSync(resolved).isFile()) throw codedError('BAD_ARGS', 'Upload requires files'); return resolved; }); return automation.upload(tab, args.ref, files); }
    case 'upload-picker': { const tab = refTab(args); if (!Array.isArray(args.files) || args.files.length !== 1) throw codedError('BAD_ARGS', 'Picker upload requires exactly one file'); const files = args.files.map(file => { if (!path.isAbsolute(file)) throw codedError('BAD_ARGS', 'Use absolute file paths'); const resolved = path.resolve(file); if (!fs.statSync(resolved).isFile()) throw codedError('BAD_ARGS', 'Upload requires files'); return resolved; }); return automation.uploadPicker(tab, args.ref, files); }
    case 'lease': { knownStudio(args.studio); if (!args.owner) throw codedError('BAD_ARGS', 'lease needs an owner'); checkLease(args.studio, args.owner); return studioInfo(args.studio); }
    case 'release': { knownStudio(args.studio); const held = lease(args.studio); const released = !!held && held.owner === String(args.owner); if (released) { leases.delete(args.studio); publish(); } return { released, ...studioInfo(args.studio) }; }
    case 'suspend': return suspendStudio(args.studio, 'manual');
    case 'wake': { const tab = await targetTab({ studio: args.studio, owner: args.owner }); return { woke: tab.studio, tab: tab.id, url: safeUrl(tab.view.webContents.getURL()) }; }
    case 'suspend-settings': { if (Object.keys(args).length) { suspendSettings = normalizeSuspend(args, suspendSettings); fs.writeFileSync(suspendFile, JSON.stringify(suspendSettings)); publish(); } return suspendSettings; }
    case 'assets': return listAssets();
    case 'import': { const files = args.files || []; const imported = files.map(file => { if (!path.isAbsolute(file) || !fs.statSync(file).isFile()) throw codedError('BAD_ARGS', 'Use absolute file paths'); const target = uniquePath(path.join(DATA, 'assets'), path.basename(file)); fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); return target; }); assetsRevision++; publish(); return { imported }; }
    case 'panels': { layout = normalizeLayout(args, layout); fs.writeFileSync(settingsFile, JSON.stringify(layout)); publish(); return layout; }
    case 'appearance': {
      if (Object.keys(args).length) { appearance = args.reset ? { ...DEFAULT_APPEARANCE } : normalizeAppearance(args, appearance); fs.writeFileSync(appearanceFile, JSON.stringify(appearance)); publish(); }
      return appearance;
    }
    case 'appearance-window': openAppearance(); return { opened: true };
    case 'storage-window': openAppearance('storage'); return { opened: true };
    case 'storage': return { dataDir: DATA, configured: !storage.setupRequired, launchOverride: storage.explicit, setup: !!setupWindow, hasExistingData: hadWorkspace, restartPending, recovery: storage.recovery || null };
    case 'screenshot': return capture(args);
    case 'window': { if (args.action === 'minimize') window.minimize(); else if (args.action === 'restore') { if (window.isMinimized()) window.restore(); window.showInactive(); } else if (args.action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize(); else if (args.action === 'close') window.close(); return { ok: true }; }
    case 'quit': setImmediate(() => app.quit()); return { quitting: true };
    case 'test-state': { if (!fixtureMode || !assertTab().view.webContents.getURL().endsWith('fixture.html')) throw new Error('Only available in isolated test mode'); return assertTab().view.webContents.executeJavaScript(`({ text: document.querySelector('#typed').textContent, result: document.querySelector('#result').textContent, attached: document.querySelector('#attached').textContent, scroll: scrollY, width: innerWidth, height: innerHeight })`); }
    default: throw codedError('BAD_ARGS', 'Unknown command');
  }
}
function openAppearance(tab = 'appearance') {
  if (appearanceWindow && !appearanceWindow.isDestroyed()) { appearanceWindow.show(); appearanceWindow.focus(); appearanceWindow.webContents.send('automato:settings-tab', tab); return; }
  appearanceWindow = new BrowserWindow({ parent: window, width: 690, height: 735, minWidth: 590, minHeight: 680, frame: false, title: 'AuTomato Appearance', backgroundColor: themeTokens(appearance, nativeTheme.shouldUseDarkColors)['--paper'], icon: nativeImage.createFromPath(path.join(__dirname, 'assets/automato.png')), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  appearanceWindow.on('closed', () => { appearanceWindow = null; });
  appearanceWindow.loadFile(path.join(__dirname, 'appearance.html'), { query: { tab } });
}
function trusted(event) { if (event.sender !== window?.webContents && event.sender !== appearanceWindow?.webContents && event.sender !== setupWindow?.webContents) throw new Error('Untrusted IPC sender'); }
ipcMain.handle('automato:command', (event, command, args) => { trusted(event); return dispatch(command, args); });
ipcMain.handle('automato:appearance-close', event => { trusted(event); if (event.sender === appearanceWindow?.webContents) appearanceWindow.close(); });
ipcMain.handle('automato:storage-info', event => { trusted(event); return dispatch('storage'); });
ipcMain.handle('automato:storage-choose', async event => {
  trusted(event);
  if (storage.explicit) throw new Error('The data folder is set by AUTOMATO_DATA_DIR. Relaunch without that override to change it here.');
  const result = await dialog.showOpenDialog(setupWindow || appearanceWindow || window, { title: 'Choose your AuTomato data folder', defaultPath: DATA, properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : storage.recovery?.kind === 'location' || (setupWindow && !hadWorkspace) ? storageTools.validateRecoveryDestination(result.filePaths[0]) : storageTools.validateDestination(DATA, result.filePaths[0]);
});
ipcMain.handle('automato:storage-open', event => { trusted(event); return shell.openPath(DATA); });
ipcMain.handle('automato:storage-save', async (event, folder) => {
  trusted(event);
  if (storage.explicit || restartPending) throw new Error('The folder cannot be changed during this launch.');
  const restoring = storage.recovery?.kind === 'location' || (setupWindow && !hadWorkspace);
  const target = restoring ? storageTools.validateRecoveryDestination(folder) : storageTools.validateDestination(DATA, folder);
  if (!setupWindow) {
    const answer = await dialog.showMessageBox(appearanceWindow || window, { type: 'question', title: 'Restart and copy your workspace?', message: 'AuTomato will restart to use the new folder.', detail: 'Save any unfinished website work first. Sessions, assets, downloads and preferences will be copied after the app closes. The original folder is kept. Copying a large workspace may take a while before it reopens.', buttons: ['Cancel', 'Copy and restart'], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1) return { canceled: true };
  }
  for (const partition of sessions) { const s = session.fromPartition(partition); s.flushStorageData(); await s.cookies.flushStore(); }
  const move = !restoring && target !== DATA && (hadWorkspace || !setupWindow);
  storageTools.saveConfig(storage.configDir, { dataDir: move ? DATA : target, ...(move ? { pendingMove: { source: DATA, target, pid: process.pid } } : {}) });
  restartPending = true;
  app.relaunch(); setImmediate(() => app.quit());
  return { restarting: true };
});
ipcMain.handle('automato:storage-retry', event => {
  trusted(event);
  if (!setupWindow || storage.recovery?.kind !== 'transfer' || !storage.recovery.retryable || restartPending) throw new Error('No transfer is waiting for retry.');
  const pending = storage.config.pendingMove;
  storageTools.validateRoot(pending.target);
  storageTools.saveConfig(storage.configDir, { dataDir: DATA, pendingMove: { ...pending, pid: process.pid } });
  restartPending = true; app.relaunch(); setImmediate(() => app.quit());
  return { restarting: true };
});
ipcMain.handle('automato:resize', async (event, action, token) => {
  if (event.sender !== window?.webContents) throw new Error('Untrusted IPC sender');
  if (action === 'begin') {
    resizeToken = token;
    const image = await assertTab().view.webContents.capturePage();
    if (resizeToken !== token) return null;
    resizing = true; updateBounds();
    return image.isEmpty() ? null : image.toDataURL();
  }
  if (action === 'end' && resizeToken === token) { resizeToken = 0; resizing = false; updateBounds(); }
  return null;
});
ipcMain.on('automato:bounds', (event, value) => { trusted(event); if (['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) { surface = value; updateBounds(); } });
ipcMain.handle('automato:choose', async event => { trusted(event); const result = await dialog.showOpenDialog(window, { title: 'Add assets to AuTomato', properties: ['openFile', 'multiSelections'] }); return result.canceled ? {} : dispatch('import', { files: result.filePaths }); });
ipcMain.handle('automato:attach', async (event, file) => {
  trusted(event); const tab = assertTab();
  const inspect = await automation.inspect(tab, { limit: 1000 });
  // AX trees can omit file inputs: find the real input through DOM without page automation code.
  const { root } = await automation.cdp(tab, 'DOM.getDocument', { depth: -1, pierce: true });
  const { nodeIds } = await automation.cdp(tab, 'DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
  if (nodeIds.length !== 1) throw new Error('Use the website upload button, or select a file input with the CLI');
  if (!listAssets().some(asset => asset.path === file)) throw new Error('Select an asset from the shelf');
  await automation.cdp(tab, 'DOM.setFileInputFiles', { nodeId: nodeIds[0], files: [file] }); return { attached: true };
});
ipcMain.handle('automato:folder', (event, type) => { trusted(event); if (!['assets', 'downloads'].includes(type)) throw new Error('Unknown folder'); return shell.openPath(path.join(DATA, type)); });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const target = setupWindow || window; target?.show(); target?.focus(); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    if (storage.setupRequired) {
      setupWindow = new BrowserWindow({ width: 650, height: storage.recovery ? 610 : 490, minWidth: 550, minHeight: storage.recovery ? 550 : 440, frame: false, title: 'Welcome to AuTomato', backgroundColor: '#f6f1e7', icon: nativeImage.createFromPath(path.join(__dirname, 'assets/automato.png')), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), partition: 'automato-setup', sandbox: true, contextIsolation: true, nodeIntegration: false } });
      setupWindow.on('closed', () => { setupWindow = null; });
      await setupWindow.loadFile(path.join(__dirname, 'storage-setup.html'));
      return;
    }
    window = new BrowserWindow({ width: 1500, height: 960, minWidth: 900, minHeight: 600, title: 'AuTomato', frame: false, backgroundColor: '#f6f1e7', icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'automato.png')), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.on('resize', updateBounds);
    window.on('blur', () => { if (resizing) { resizeToken = 0; resizing = false; updateBounds(); } });
    window.on('close', () => { quitting = true; for (const tab of tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); bridge?.server.close(); });
    await window.loadFile(path.join(__dirname, 'index.html'));
    switchStudio(activeStudio);
    bridge = await createBridge(DATA, dispatch);
    setInterval(autoSuspend, 60000);
  }).catch(error => { console.error(error.message); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
