// Use only synthetic data in a fresh profile. Native dialogs are stubbed;
// configuration, process exits, copies and subsequent launches are real.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
async function verifyStorage(electron, executable, sourceArgs = []) {
  const root = path.resolve(__dirname, '../..');
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  const testRoot = fs.mkdtempSync(path.join(root, 'output/storage-qa-'));
  const control = path.join(testRoot, 'location'), first = path.join(testRoot, 'first'), second = path.join(testRoot, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  const env = { ...process.env, AUTOMATO_CONFIG_DIR: control, AUTOMATO_TEST_MODE: '1', TEMP: path.join(root, '.tmp'), TMP: path.join(root, '.tmp') };
  delete env.AUTOMATO_DATA_DIR; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ executablePath: executable, args: sourceArgs, env });
  const mockDialogs = (app, target, response = 1) => app.evaluate(({ dialog, app }, { target, response }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    dialog.showMessageBox = async () => ({ response });
    app.relaunch = () => {}; // The test runner starts the next process explicitly.
  }, { target, response });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('#setupPath').filter({ hasText: control }).waitFor();
    await mockDialogs(app, first);
    await page.locator('#setupChoose').click();
    await page.locator('#setupPath').filter({ hasText: first }).waitFor();
    let closed = app.waitForEvent('close');
    await page.locator('#setupContinue').click(); await closed;
    assert.equal(JSON.parse(fs.readFileSync(path.join(control, 'storage-location.json'))).dataDir, first);
    app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(async () => { const tabs = (await window.automato.command('status')).tabs; return tabs.length > 0 && !tabs[0].loading; });
    await app.evaluate(async ({ session }) => {
      const s = session.fromPartition('persist:automato-test');
      await s.cookies.set({ url: 'https://automato-test.invalid', name: 'storage-fixture', value: 'synthetic-session', expirationDate: Math.floor(Date.now() / 1000) + 86400 });
      await s.cookies.flushStore();
    });
    fs.writeFileSync(path.join(first, 'assets/reference-fixture.txt'), 'storage copy fixture');
    await page.evaluate(async () => { await window.automato.command('panels', { sidebarWidth: 320 }); await window.automato.command('appearance', { theme: 'everforest' }); });
    const settingsEvent = app.waitForEvent('window', { predicate: async candidate => {
      try { await candidate.waitForURL(url => url.pathname.endsWith('/appearance.html'), { timeout: 5000 }); return true; } catch { return false; }
    } }); await page.locator('#appearance').click();
    const settings = await settingsEvent;
    await settings.locator('[data-settings-tab=storage]').click();
    await settings.locator('#storagePath').filter({ hasText: first }).waitFor();
    // Choosing a populated folder reports an error, with no config change.
    await mockDialogs(app, control);
    await settings.locator('#storageChoose').click();
    await settings.locator('#storageStatus').filter({ hasText: 'empty folder' }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(control, 'storage-location.json'))).pendingMove, undefined);
    // Canceling the restart leaves the existing workspace selected.
    await mockDialogs(app, second, 0); await settings.locator('#storageChoose').click();
    assert.equal(JSON.parse(fs.readFileSync(path.join(control, 'storage-location.json'))).dataDir, first);
    await mockDialogs(app, second);
    closed = app.waitForEvent('close'); await settings.locator('#storageChoose').click(); await closed;
    app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(async () => (await window.automato.command('status')).tabs.length > 0);
    const status = await page.evaluate(() => window.automato.command('status'));
    assert.equal(status.dataDir, second); assert.equal(status.layout.sidebarWidth, 320); assert.equal(status.appearance.theme, 'everforest');
    for (const folder of [first, second]) assert.equal(fs.readFileSync(path.join(folder, 'assets/reference-fixture.txt'), 'utf8'), 'storage copy fixture');
    assert.equal(await app.evaluate(async ({ session }) => (await session.fromPartition('persist:automato-test').cookies.get({ url: 'https://automato-test.invalid' })).some(c => c.name === 'storage-fixture' && c.value === 'synthetic-session')), true);
    console.log('PASS: first-launch picker, persisted choice, nonempty-folder rejection, restart cancellation and offline migration with cookie/asset/preferences preservation');
  } finally { await app.close().catch(() => {}); }
}
module.exports = { verifyStorage };

async function verifyRecovery(electron, executable, sourceArgs = []) {
  const root = path.resolve(__dirname, '../..');
  const testRoot = fs.mkdtempSync(path.join(root, 'output/storage-recovery-qa-'));
  const make = name => { const file = path.join(testRoot, name); fs.mkdirSync(file, { recursive: true }); return file; };
  const original = make('original'), target = make('partial-target');
  fs.mkdirSync(path.join(original, 'profile')); fs.mkdirSync(path.join(original, 'assets')); fs.mkdirSync(path.join(target, 'assets'));
  fs.writeFileSync(path.join(original, 'assets/fixture.txt'), 'complete synthetic payload');
  for (const name of ['LOCK', 'lockfile', 'SingletonCookie']) fs.writeFileSync(path.join(original, 'assets', name), 'synthetic asset');
  fs.writeFileSync(path.join(target, 'assets/fixture.txt'), 'partial');
  const env = { ...process.env, AUTOMATO_TEST_MODE: '1', TEMP: path.join(root, '.tmp'), TMP: path.join(root, '.tmp') };
  delete env.AUTOMATO_DATA_DIR; delete env.ELECTRON_RUN_AS_NODE;
  const launch = control => electron.launch({ executablePath: executable, args: sourceArgs, env: { ...env, AUTOMATO_CONFIG_DIR: control } });
  const stopRelaunch = app => app.evaluate(({ app }) => { app.relaunch = () => {}; });
  const waitMain = page => page.waitForFunction(async () => { const tabs = (await window.automato.command('status')).tabs; return tabs.length && !tabs[0].loading; });
  let app;
  try {
    const control = make('partial-config');
    fs.writeFileSync(path.join(control, 'storage-location.json'), JSON.stringify({ dataDir: original, pendingMove: { source: original, target, pid: 2147483647 } }));
    app = await launch(control); let page = await app.firstWindow();
    await page.locator('#setupContinue').filter({ hasText: 'Use original folder' }).waitFor();
    assert.equal((await page.evaluate(() => window.automato.storageInfo())).recovery.kind, 'transfer');
    assert.equal(await page.locator('#setupRetry').isVisible(), false);
    await page.screenshot({ path: path.join(testRoot, 'recovery.png') });
    console.log('Recovery screenshot:', path.join(testRoot, 'recovery.png'));
    await stopRelaunch(app); let closed = app.waitForEvent('close'); await page.locator('#setupContinue').click(); await closed;
    assert.equal(JSON.parse(fs.readFileSync(path.join(control, 'storage-location.json'))).pendingMove, undefined);
    app = await launch(control); page = await app.firstWindow(); await waitMain(page);
    assert.equal((await page.evaluate(() => window.automato.command('status'))).dataDir, original);
    assert.equal(fs.readFileSync(path.join(target, 'assets/fixture.txt'), 'utf8'), 'partial');
    assert.equal(fs.readFileSync(path.join(original, 'assets/fixture.txt'), 'utf8'), 'complete synthetic payload');
    await app.close(); app = null;

    // Both damaged JSON and an unavailable drive must offer restoration through the GUI.
    const missingDrive = process.platform === 'win32' && ['Z:', 'Y:', 'X:', 'W:'].find(d => !fs.existsSync(d + '/'));
    const badLocation = path.join(testRoot, 'not-a-directory'); fs.writeFileSync(badLocation, 'fixture');
    for (const [name, setting] of [['damaged', '{invalid'], ['unavailable', JSON.stringify({ dataDir: missingDrive ? missingDrive + '/AuTomato' : badLocation })]]) {
      const config = make(name); fs.writeFileSync(path.join(config, 'storage-location.json'), setting);
      app = await launch(config); page = await app.firstWindow();
      await page.locator('#setupTitle').filter({ hasText: 'still safe' }).waitFor();
      assert.equal((await page.evaluate(() => window.automato.storageInfo())).recovery.kind, 'location');
      assert.equal(fs.readFileSync(path.join(config, 'storage-location.json'), 'utf8'), setting);
      await app.evaluate(({ dialog, app }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); app.relaunch = () => {}; }, original);
      await page.locator('#setupChoose').click(); await page.locator('#setupPath').filter({ hasText: original }).waitFor();
      closed = app.waitForEvent('close'); await page.locator('#setupContinue').click(); await closed;
      assert(fs.readdirSync(path.join(config, 'storage-history')).some(file => fs.readFileSync(path.join(config, 'storage-history', file), 'utf8') === setting));
      app = await launch(config); page = await app.firstWindow(); await waitMain(page);
      assert.equal((await page.evaluate(() => window.automato.command('status'))).dataDir, original);
      await app.close(); app = null;
    }

    // Retry a transfer whose original process was previously reported as busy.
    const retryConfig = make('retry-config'), retryTarget = make('retry-target');
    fs.writeFileSync(path.join(retryConfig, 'storage-location.json'), JSON.stringify({ dataDir: original, pendingMove: { source: original, target: retryTarget, pid: process.pid } }));
    app = await launch(retryConfig); page = await app.firstWindow(); await page.locator('#setupRetry').waitFor({ state: 'visible' });
    await stopRelaunch(app); closed = app.waitForEvent('close'); await page.locator('#setupRetry').click(); await closed;
    app = await launch(retryConfig); page = await app.firstWindow(); await waitMain(page);
    assert.equal((await page.evaluate(() => window.automato.command('status'))).dataDir, retryTarget);
    assert.equal(fs.readFileSync(path.join(retryTarget, 'assets/fixture.txt'), 'utf8'), 'complete synthetic payload');
    for (const name of ['LOCK', 'lockfile', 'SingletonCookie']) assert.equal(fs.readFileSync(path.join(retryTarget, 'assets', name), 'utf8'), 'synthetic asset');
    console.log('PASS: partial-copy rollback, damaged-setting restoration, unavailable-drive restoration, preserved backups and retry recovery');
  } finally { if (app) await app.close().catch(() => {}); }
}
module.exports.verifyRecovery = verifyRecovery;

async function verifyUserLocations(electron, executable, sourceArgs = []) {
  const root = path.resolve(__dirname, '../..');
  const testRoot = fs.mkdtempSync(path.join(root, 'output/user-locations-'));
  const local = path.join(testRoot, 'user-local'), existing = path.join(testRoot, 'existing-workspace');
  fs.mkdirSync(path.join(existing, 'profile'), { recursive: true });
  fs.mkdirSync(path.join(existing, 'assets'));
  fs.writeFileSync(path.join(existing, 'assets/fixture.txt'), 'existing synthetic asset');
  const env = { ...process.env, LOCALAPPDATA: local, AUTOMATO_TEST_MODE: '1', TEMP: path.join(root, '.tmp'), TMP: path.join(root, '.tmp') };
  delete env.AUTOMATO_CONFIG_DIR; delete env.AUTOMATO_DATA_DIR; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ executablePath: executable, args: sourceArgs, env });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const expected = path.join(local, 'AuTomato');
    await page.locator('#setupPath').filter({ hasText: expected }).waitFor();
    await app.evaluate(({ dialog, app }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); app.relaunch = () => {}; }, existing);
    await page.locator('#setupChoose').click();
    await page.locator('#setupPath').filter({ hasText: existing }).waitFor();
    const closed = app.waitForEvent('close'); await page.locator('#setupContinue').click(); await closed;
    assert.equal(JSON.parse(fs.readFileSync(path.join(expected, 'storage-location.json'))).dataDir, existing);
    app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(async () => (await window.automato.command('status')).tabs.length > 0);
    assert.equal((await page.evaluate(() => window.automato.command('status'))).dataDir, existing);
    assert.equal(fs.readFileSync(path.join(existing, 'assets/fixture.txt'), 'utf8'), 'existing synthetic asset');
    console.log('PASS: per-user default follows LOCALAPPDATA; first launch opens an existing workspace without copying or deleting it.');
  } finally { await app.close().catch(() => {}); }
}
module.exports.verifyUserLocations = verifyUserLocations;
