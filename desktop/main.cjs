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
const STUDIOS = {
  higgsfield: { name: 'Higgsfield', url: 'https://higgsfield.ai/', partition: 'persist:higgsfield' },
  flow: { name: 'Flow', url: 'https://flow.google.com/', partition: 'persist:flow' },
  symphony: { name: 'Symphony', url: 'https://ads.tiktok.com/creative/creativestudio/home/en', partition: 'persist:symphony' },
  tiktok: { name: 'TikTok Studio', url: 'https://www.tiktok.com/tiktokstudio/upload', partition: 'persist:tiktok' },
  capcut: { name: 'CapCut Web', url: 'https://www.capcut.com/my-edit', partition: 'persist:capcut' },
  clipscript: { name: 'ClipScript', url: 'https://clipscript.jsxcreatives.com/', partition: 'persist:clipscript' }
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
let assetsRevision = 0, resizing = false, resizeToken = 0;
const tabs = new Map(); const selected = new Map(); const sessions = new Set();
const automation = new PageAutomation();

function currentTab() { return tabs.get(selected.get(activeStudio)); }
function assertTab() { const tab = currentTab(); if (!tab || tab.view.webContents.isDestroyed()) throw new Error('No active website tab'); return tab; }
function uniquePath(folder, name) {
  const parsed = path.parse(path.basename(name)); let target = path.join(folder, parsed.base); let i = 1;
  while (fs.existsSync(target)) target = path.join(folder, `${parsed.name}-${i++}${parsed.ext}`);
  return target;
}
function state() {
  const tab = currentTab();
  return { name: 'AuTomato', version: require('../package.json').version, local: true, active: activeStudio,
    studios: Object.entries(STUDIOS).map(([id, studio]) => ({ id, name: studio.name })),
    tabs: [...tabs.values()].map(t => ({ id: t.id, studio: t.studio, active: t.id === selected.get(t.studio), title: t.view.webContents.getTitle(), url: safeUrl(t.view.webContents.getURL()), loading: t.view.webContents.isLoading(), error: t.error || null })),
    layout, appearance, assetsRevision, bounds: tab?.view.getBounds(), dataDir: DATA, assetsDir: path.join(DATA, 'assets'), downloadDir: path.join(DATA, 'downloads') };
}
function publish() {
  const snapshot = state();
  for (const target of [window, appearanceWindow]) if (target && !target.isDestroyed()) target.webContents.send('automato:state', snapshot);
}
function updateBounds() {
  if (!window || window.isDestroyed()) return;
  const size = window.getContentBounds();
  const x = Math.max(0, Math.round(surface.x)), y = Math.max(0, Math.round(surface.y));
  const bounds = { x, y, width: Math.max(1, Math.min(Math.round(surface.width), size.width - x)), height: Math.max(1, Math.min(Math.round(surface.height), size.height - y)) };
  for (const tab of tabs.values()) {
    const visible = tab === currentTab() && !resizing;
    if (visible && JSON.stringify(tab.bounds) !== JSON.stringify(bounds)) { tab.view.setBounds(bounds); tab.bounds = bounds; }
    if (visible !== tab.visible) { tab.view.setVisible(visible); tab.visible = visible; }
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
    item.once('done', () => { assetsRevision++; publish(); });
  });
}
function createTab(studio, url, opener, inherited = {}) {
  const partition = STUDIOS[studio]?.partition || 'persist:automato-test';
  configureSession(partition);
  const view = new WebContentsView({ ...(inherited.webContents ? { webContents: inherited.webContents } : {}), webPreferences: { ...inherited.webPreferences, partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true } });
  const tab = { id: nextId++, studio, view, opener, generation: 0, error: null };
  tabs.set(tab.id, tab); selected.set(studio, tab.id); window.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setWindowOpenHandler(details => {
    if (!['https:', 'http:'].includes(new URL(details.url).protocol) && !(fixtureMode && details.url.startsWith('file:'))) return { action: 'deny' };
    return { action: 'allow', createWindow: options => { const child = createTab(studio, null, tab.id, options); activeStudio = studio; return child.view.webContents; } };
  });
  wc.on('will-navigate', (event, url) => { if (!['http:', 'https:'].includes(new URL(url).protocol) && !(fixtureMode && url.startsWith('file:'))) event.preventDefault(); });
  wc.on('did-start-navigation', (_e, _url, _inPlace, mainFrame) => { if (mainFrame) { tab.generation++; tab.error = null; automation.invalidate(tab); } });
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
  if (!STUDIOS[id] && !(fixtureMode && id === 'test')) throw new Error('Unknown studio');
  activeStudio = id;
  if (!tabs.has(selected.get(id))) createTab(id, id === 'test' ? require('node:url').pathToFileURL(path.join(__dirname, 'fixture.html')).href : STUDIOS[id].url);
  updateBounds(); publish(); return state();
}
function listAssets() {
  return ['assets', 'downloads'].flatMap(source => fs.readdirSync(path.join(DATA, source), { withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const file = path.join(DATA, source, e.name), stat = fs.statSync(file);
    return { name: e.name, path: file, source, size: stat.size, modified: stat.mtimeMs };
  })).sort((a, b) => b.modified - a.modified);
}
function approvedOutput(file) {
  if (!path.isAbsolute(file)) throw new Error('Use an absolute output path');
  if (fs.existsSync(file)) throw new Error('Output exists; choose a new path');
  fs.mkdirSync(path.dirname(file), { recursive: true }); return file;
}
async function capture(args) {
  const file = approvedOutput(path.resolve(args.path || uniquePath(path.join(DATA, 'previews'), 'capture.png')));
  const image = await (args.shell ? window.webContents : assertTab().view.webContents).capturePage();
  if (image.isEmpty()) throw new Error('The page has no rendered content yet; wait for loading to finish');
  fs.writeFileSync(file, image.toPNG(), { flag: 'wx' });
  return { path: file, width: image.getSize().width, height: image.getSize().height, bytes: fs.statSync(file).size };
}
async function dispatch(command, args = {}) {
  if (args.dryRun && !['status', 'inspect', 'assets', 'tabs', 'studios'].includes(command)) return { dryRun: true, command };
  switch (command) {
    case 'status': return state();
    case 'studios': return state().studios;
    case 'switch': return switchStudio(args.studio);
    case 'tabs': return state().tabs;
    case 'select-tab': { const tab = tabs.get(Number(args.id)); if (!tab) throw new Error('Tab not found'); activeStudio = tab.studio; selected.set(tab.studio, tab.id); updateBounds(); publish(); return state(); }
    case 'close-tab': { const tab = tabs.get(Number(args.id)); if (!tab) throw new Error('Tab not found'); tab.view.webContents.close(); return { closed: tab.id }; }
    case 'navigate': { const tab = assertTab(); await tab.view.webContents.loadURL(validateUrl(args.url)); return state(); }
    case 'reload': assertTab().view.webContents.reload(); return { reloading: true };
    case 'back': { const history = assertTab().view.webContents.navigationHistory; if (history.canGoBack()) history.goBack(); return { back: true }; }
    case 'inspect': return automation.inspect(assertTab(), args);
    case 'click': return automation.click(assertTab(), args.ref);
    case 'fill': return automation.fill(assertTab(), args.ref, args.text);
    case 'press': {
      const keys = { Enter: ['Enter', 13], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39] };
      const [key, code] = keys[args.key] || (String(args.key).length === 1 ? [args.key, String(args.key).toUpperCase().charCodeAt(0)] : []);
      if (!key) throw new Error('Use Enter, Tab, Escape, Backspace, Delete, an Arrow key or a single character');
      await automation.cdp(assertTab(), 'Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, modifiers: Number(args.modifiers) || 0 });
      await automation.cdp(assertTab(), 'Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers: Number(args.modifiers) || 0 });
      return { pressed: key };
    }
    case 'scroll': { const tab = assertTab(), size = tab.view.getBounds(); await automation.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: size.width / 2, y: size.height / 2, deltaX: 0, deltaY: Math.max(-3000, Math.min(3000, Number(args.delta) || 600)) }); return { scrolled: true }; }
    case 'upload': { const files = args.files.map(file => { const resolved = path.resolve(file); if (!fs.statSync(resolved).isFile()) throw new Error('Upload requires files'); return resolved; }); return automation.upload(assertTab(), args.ref, files); }
    case 'assets': return listAssets();
    case 'import': { const files = args.files || []; const imported = files.map(file => { if (!path.isAbsolute(file) || !fs.statSync(file).isFile()) throw new Error('Use absolute file paths'); const target = uniquePath(path.join(DATA, 'assets'), path.basename(file)); fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); return target; }); assetsRevision++; publish(); return { imported }; }
    case 'panels': { layout = normalizeLayout(args, layout); fs.writeFileSync(settingsFile, JSON.stringify(layout)); publish(); return layout; }
    case 'appearance': {
      if (Object.keys(args).length) { appearance = args.reset ? { ...DEFAULT_APPEARANCE } : normalizeAppearance(args, appearance); fs.writeFileSync(appearanceFile, JSON.stringify(appearance)); publish(); }
      return appearance;
    }
    case 'appearance-window': openAppearance(); return { opened: true };
    case 'storage-window': openAppearance('storage'); return { opened: true };
    case 'storage': return { dataDir: DATA, configured: !storage.setupRequired, launchOverride: storage.explicit, setup: !!setupWindow, hasExistingData: hadWorkspace, restartPending, recovery: storage.recovery || null };
    case 'screenshot': return capture(args);
    case 'window': { if (args.action === 'minimize') window.minimize(); else if (args.action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize(); else if (args.action === 'close') window.close(); return { ok: true }; }
    case 'quit': setImmediate(() => app.quit()); return { quitting: true };
    case 'test-state': { if (!fixtureMode || !assertTab().view.webContents.getURL().endsWith('fixture.html')) throw new Error('Only available in isolated test mode'); return assertTab().view.webContents.executeJavaScript(`({ text: document.querySelector('#typed').textContent, result: document.querySelector('#result').textContent, attached: document.querySelector('#attached').textContent, scroll: scrollY, width: innerWidth, height: innerHeight })`); }
    default: throw new Error('Unknown command');
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
  }).catch(error => { console.error(error.message); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
