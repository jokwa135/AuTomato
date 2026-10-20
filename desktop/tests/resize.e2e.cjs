// Real-control QA: three drag handles, bounds, collapse/restore, keyboard/reset,
// small-window limits and persistence across an application restart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function verifyResize(electronLauncher, packaged = false) {
  const root = path.resolve(__dirname, '../..');
  const data = path.join(root, 'output/resize-ui-test');
  process.env.TEMP = process.env.TMP = path.join(root, '.tmp');
  fs.mkdirSync(process.env.TEMP, { recursive: true });
  const env = { ...process.env, AUTOMATO_DATA_DIR: data, AUTOMATO_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electronLauncher.launch({ executablePath: path.join(root, packaged ? 'dist/automato/win-unpacked/AuTomato.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [path.join(root, 'desktop/main.cjs')], cwd: root, env });
  let app = await launch();
  try {
    let page = await app.firstWindow(); page.setDefaultTimeout(5000);
    await page.locator('#sidebarResize').waitFor({ state: 'visible' });
    await page.evaluate(() => window.automato.command('panels', { sidebar: true, bottom: true, sidebarWidth: 264, bottomHeight: 125, studiosHeight: 59 }));
    const rect = id => page.locator(id).boundingBox();
    const drag = async (id, dx, dy) => {
      const box = await rect(id), x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.waitForFunction(() => document.body.classList.contains('resizing'));
      await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
      await page.waitForFunction(() => !document.body.classList.contains('resizing'));
    };
    const state = () => page.evaluate(() => window.automato.command('status'));
    const waitSize = (key, value) => page.waitForFunction(async ({ key, value }) => (await window.automato.command('status')).layout[key] === value, { key, value });

    await drag('#sidebarResize', 86, 0); await waitSize('sidebarWidth', 350);
    await drag('#bottomResize', 0, -65); await waitSize('bottomHeight', 190);
    await drag('#studiosResize', 0, 25); await waitSize('studiosHeight', 84);
    let current = await state(), surface = await rect('#surface');
    assert.equal(current.bounds.x, 350); assert.equal(current.bounds.y, 195);
    assert.equal(current.bounds.width, Math.round(surface.width)); assert.equal(current.bounds.height, Math.round(surface.height));
    assert.equal(await page.evaluate(() => window.automato.command('test-state').then(value => value.width)), current.bounds.width);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'layout.json'), 'utf8')), current.layout);

    await page.locator('#sidebar').click(); await page.locator('#sidebarResize').waitFor({ state: 'hidden' });
    await page.locator('#sidebar').click(); await page.locator('#sidebarResize').waitFor({ state: 'visible' });
    assert.equal(Math.round((await rect('#library')).width), 350);
    await page.locator('#bottom').click(); await page.locator('#bottomResize').waitFor({ state: 'hidden' });
    await page.locator('#bottom').click(); assert.equal(Math.round((await rect('#bottomPanel')).height), 190);

    await page.locator('#sidebarResize').focus(); await page.keyboard.press('ArrowRight'); await waitSize('sidebarWidth', 366);
    await page.locator('#sidebarResize').dblclick(); await waitSize('sidebarWidth', 264);
    await drag('#sidebarResize', -400, 0); await waitSize('sidebarWidth', 190);
    await page.locator('#sidebarResize').dblclick(); await waitSize('sidebarWidth', 264);
    await page.locator('#bottomResize').dblclick(); await waitSize('bottomHeight', 125);
    await page.locator('#studiosResize').dblclick(); await waitSize('studiosHeight', 59);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
    await drag('#sidebarResize', 800, 0); await drag('#bottomResize', 0, -500);
    current = await state();
    assert(current.bounds.width >= 480); assert(current.bounds.height >= 180);
    assert.equal(await page.locator('#studios').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    const saved = current.layout;
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.locator('#sidebarResize').waitFor({ state: 'visible' });
    assert.deepEqual((await state()).layout, saved);
    console.log('PASS: drag, native viewport fit, persistence, collapse/restore, keyboard, reset and minimum window');
  } finally { await app.close(); }
}
module.exports = { verifyResize };
async function verifyAppearance(electronLauncher, packaged = false) {
  const root = path.resolve(__dirname, '../..'), data = path.join(root, 'output/appearance-ui-test');
  const env = { ...process.env, AUTOMATO_DATA_DIR: data, AUTOMATO_TEST_MODE: '1', TEMP: path.join(root, '.tmp'), TMP: path.join(root, '.tmp') }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electronLauncher.launch({ executablePath: path.join(root, packaged ? 'dist/automato/win-unpacked/AuTomato.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [path.join(root, 'desktop/main.cjs')], cwd: root, env });
  let app = await launch();
  try {
    let page = await app.firstWindow(); page.setDefaultTimeout(5000);
    await page.waitForFunction(async () => { const state = await window.automato.command('status'); return state.tabs.length > 0 && !state.tabs[0].loading; });
    await page.evaluate(() => window.automato.command('appearance', { reset: true }));
    const openSettings = async () => {
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      for (let attempt = 0; attempt < 50; attempt++) {
        const target = app.windows().find(p => p.url().endsWith('/appearance.html'));
        if (target) return target;
        await page.waitForTimeout(50);
      }
      throw new Error('Appearance window did not load');
    };
    const settings = await openSettings(); settings.setDefaultTimeout(5000);
    await settings.getByRole('button', { name: 'Dark mode', exact: true }).click();
    await settings.getByLabel('Theme', { exact: true }).selectOption('everforest');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() === '#222628');
    await settings.getByLabel('Background hex color', { exact: true }).fill('#123456'); await settings.keyboard.press('Tab');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() === '#123456');
    await settings.getByLabel('Accent hex color', { exact: true }).fill('#f08888'); await settings.keyboard.press('Tab');
    await settings.getByLabel('Foreground hex color', { exact: true }).fill('#eeeecc'); await settings.keyboard.press('Tab');
    await settings.getByLabel('Font', { exact: true }).selectOption('Consolas');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--app-font').includes('Consolas'));
    const before = await page.evaluate(() => window.automato.command('appearance'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'appearance.json'), 'utf8')), before);
    await settings.screenshot({ path: path.join(data, 'custom-theme.png') });
    await app.close(); app = await launch(); page = await app.firstWindow();
    assert.deepEqual(await page.evaluate(() => window.automato.command('appearance')), before);
    const again = await openSettings();
    await again.getByRole('button', { name: 'Reset to default', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() === '#f6f1e7');
    await again.getByLabel('Background hex color', { exact: true }).fill('invalid'); await again.keyboard.press('Tab');
    assert.equal(await again.getByLabel('Background hex color', { exact: true }).getAttribute('aria-invalid'), 'true');
    await again.getByRole('button', { name: 'Reset to default', exact: true }).click();
    assert.equal(await again.getByLabel('Background hex color', { exact: true }).inputValue(), '#F6F1E7');
    await again.getByRole('button', { name: 'System mode', exact: true }).click(); await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() === '#202620');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() === '#f6f1e7');
    await again.getByRole('button', { name: 'Close appearance', exact: true }).click();

    // Unchanged native state notifications must preserve the shelf and tab DOM.
    await page.waitForFunction(() => document.querySelector('#files').firstChild !== null);
    await page.evaluate(() => { window.__shelfNode = document.querySelector('#files').firstChild; window.__shelfChanges = 0; new MutationObserver(() => window.__shelfChanges++).observe(document.querySelector('#files'), { childList: true, subtree: true }); });
    // Send real status objects through the supported renderer API and event channel.
    const snapshot = await page.evaluate(() => window.automato.command('status'));
    await app.evaluate(({ BrowserWindow }, value) => { for (let i = 0; i < 30; i++) BrowserWindow.getAllWindows()[0].webContents.send('automato:state', value); }, snapshot);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__shelfNode === document.querySelector('#files').firstChild && window.__shelfChanges === 0), true);
    console.log('PASS: appearance modes, presets, colors, fonts, persistence, reset and redundant redraw check');
  } finally { await app.close(); }
}
module.exports.verifyAppearance = verifyAppearance;
if (require.main === module) {
  const { _electron } = require(process.env.AUTOMATO_PLAYWRIGHT_MODULE || 'playwright');
  verifyResize(_electron).then(() => verifyAppearance(_electron)).catch(error => { console.error(error); process.exitCode = 1; });
}
