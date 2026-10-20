const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateDestination, copyWorkspace, saveConfig, resolveStorage, validateRoot } = require('../storage.cjs');
const storage = require('../storage.cjs');
fs.mkdirSync(path.resolve(__dirname, '../../.tmp'), { recursive: true });
const root = fs.mkdtempSync(path.resolve(__dirname, '../../.tmp/storage-tests-'));
function folder(name) { const file = path.join(root, name); fs.mkdirSync(file, { recursive: true }); return file; }
test('first launch requires setup; saved locations and explicit overrides remain discoverable', () => {
  const config = folder('config'), chosen = folder('chosen'), override = folder('override');
  assert.equal(resolveStorage({ AUTOMATO_CONFIG_DIR: config }).setupRequired, true);
  saveConfig(config, { dataDir: chosen });
  assert.equal(resolveStorage({ AUTOMATO_CONFIG_DIR: config }).dataDir, chosen);
  saveConfig(config, { dataDir: chosen });
  assert.equal(fs.readdirSync(path.join(config, 'storage-history')).length, 1);
  assert.equal(resolveStorage({ AUTOMATO_CONFIG_DIR: config, AUTOMATO_DATA_DIR: override }).dataDir, override);
  assert.equal(resolveStorage({ AUTOMATO_CONFIG_DIR: config, AUTOMATO_DATA_DIR: override }).setupRequired, false);
});
test('destinations cannot overwrite files, contain the source or point into it', () => {
  const source = folder('source'), occupied = folder('occupied'); fs.writeFileSync(path.join(occupied, 'keep.txt'), 'keep');
  assert.throws(() => validateDestination(source, occupied), /empty/);
  assert.throws(() => validateDestination(source, path.join(source, 'nested')), /outside/);
  assert.throws(() => validateDestination(source, root), /outside/);
  assert.throws(() => validateRoot(path.parse(root).root), /drive root/);
  assert.throws(() => validateRoot('relative'), /absolute/);
  if (process.platform === 'win32') assert.equal(validateRoot('C:/AuTomato-fixture'), path.resolve('C:/AuTomato-fixture'));
  if (process.platform === 'win32') {
    const missing = ['Z:', 'Y:', 'X:', 'W:'].find(drive => !fs.existsSync(drive + '/'));
    if (missing) assert.throws(() => validateRoot(missing + '/AuTomato'), /unavailable/);
  }
});

test('default data paths use platform conventions and environment, without requiring a drive letter', () => {
  assert.equal(storage.defaultRoot('win32', 'C:/Users/Example', {}), path.win32.join('C:/Users/Example', 'AppData/Local/AuTomato'));
  assert.equal(storage.defaultRoot('win32', 'C:/Users/Example', { LOCALAPPDATA: 'E:/UserData' }), path.win32.join('E:/UserData', 'AuTomato'));
  assert.equal(storage.defaultRoot('darwin', '/Users/example', {}), path.join('/Users/example', 'Library/Application Support/AuTomato'));
  assert.equal(storage.defaultRoot('linux', '/home/example', { XDG_CONFIG_HOME: '/custom/config' }), path.join('/custom/config', 'AuTomato'));
  if (process.platform === 'win32') assert.equal(resolveStorage({ LOCALAPPDATA: path.join(root, 'user-local') }).configDir, path.join(root, 'user-local', 'AuTomato'));
});
test('offline copy preserves all workspace bytes and original files, excluding transient discovery', () => {
  const source = folder('copy-source'), target = folder('copy-target');
  fs.mkdirSync(path.join(source, 'profile/Partitions/test'), { recursive: true });
  fs.writeFileSync(path.join(source, 'profile/Partitions/test/fixture.bin'), Buffer.from([0, 1, 4, 255]));
  fs.mkdirSync(path.join(source, 'assets')); fs.writeFileSync(path.join(source, 'assets/reference.txt'), 'fixture');
  fs.writeFileSync(path.join(source, 'layout.json'), '{"sidebarWidth":320}');
  fs.writeFileSync(path.join(source, 'bridge.json'), '{}');
  copyWorkspace(source, target); copyWorkspace(source, target);
  assert.deepEqual(fs.readFileSync(path.join(target, 'profile/Partitions/test/fixture.bin')), fs.readFileSync(path.join(source, 'profile/Partitions/test/fixture.bin')));
  assert.equal(fs.readFileSync(path.join(source, 'assets/reference.txt'), 'utf8'), 'fixture');
  assert.equal(fs.existsSync(path.join(target, 'bridge.json')), false);
  fs.writeFileSync(path.join(target, 'assets/reference.txt'), 'different');
  assert.throws(() => copyWorkspace(source, target), /does not match/);
  assert.equal(fs.readFileSync(path.join(target, 'assets/reference.txt'), 'utf8'), 'different');
});

test('asset names matching browser locks are copied; only profile locks are excluded', () => {
  const source = folder('lock-names/source'), target = folder('lock-names/target');
  for (const area of ['assets', 'downloads', 'previews', 'profile']) {
    fs.mkdirSync(path.join(source, area));
    for (const name of ['LOCK', 'lockfile', 'SingletonCookie', 'SingletonLock', 'SingletonSocket']) fs.writeFileSync(path.join(source, area, name), 'synthetic file');
  }
  copyWorkspace(source, target);
  for (const area of ['assets', 'downloads', 'previews']) assert.deepEqual(fs.readdirSync(path.join(target, area)), fs.readdirSync(path.join(source, area)));
  assert.deepEqual(fs.readdirSync(path.join(target, 'profile')), []);
});

test('damaged settings and invalid locations open recovery without rewriting their settings', () => {
  const config = folder('damaged-setting'); const setting = path.join(config, 'storage-location.json');
  fs.writeFileSync(setting, '{invalid');
  let result = resolveStorage({ AUTOMATO_CONFIG_DIR: config });
  assert.equal(result.setupRequired, true); assert.equal(result.recovery.kind, 'location');
  assert.equal(fs.readFileSync(setting, 'utf8'), '{invalid');
  const notFolder = path.join(config, 'fixture-file'); fs.writeFileSync(notFolder, 'fixture');
  saveConfig(config, { dataDir: notFolder });
  result = resolveStorage({ AUTOMATO_CONFIG_DIR: config });
  assert.equal(result.recovery.kind, 'location'); assert.equal(result.dataDir, config);
});

test('partial copies return a recoverable startup state and preserve both original and partial files', () => {
  const source = folder('partial/source'), target = folder('partial/target'), config = folder('partial/config');
  fs.mkdirSync(path.join(source, 'assets')); fs.mkdirSync(path.join(source, 'profile')); fs.mkdirSync(path.join(target, 'assets'));
  fs.writeFileSync(path.join(source, 'assets/fixture.txt'), 'complete synthetic payload');
  fs.writeFileSync(path.join(target, 'assets/fixture.txt'), 'partial');
  saveConfig(config, { dataDir: source, pendingMove: { source, target, pid: 2147483647 } });
  const result = storage.prepareStorage({ AUTOMATO_CONFIG_DIR: config });
  assert.equal(result.setupRequired, true); assert.equal(result.recovery.kind, 'transfer');
  assert.equal(result.recovery.retryable, false);
  assert.equal(result.dataDir, source);
  assert.equal(fs.readFileSync(path.join(source, 'assets/fixture.txt'), 'utf8'), 'complete synthetic payload');
  assert.equal(fs.readFileSync(path.join(target, 'assets/fixture.txt'), 'utf8'), 'partial');
  // Reverting to the original location clears the pending transfer without deleting either copy.
  saveConfig(config, { dataDir: source });
  assert.equal(storage.prepareStorage({ AUTOMATO_CONFIG_DIR: config }).setupRequired, false);
});

test('recovery can select a recognized existing workspace but rejects unrelated occupied folders', () => {
  const existing = folder('restore-existing'), unrelated = folder('unrelated');
  fs.mkdirSync(path.join(existing, 'profile')); fs.mkdirSync(path.join(existing, 'assets'));
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'keep');
  assert.equal(storage.validateRecoveryDestination(existing), existing);
  assert.throws(() => storage.validateRecoveryDestination(unrelated), /empty folder|AuTomato workspace/);
});
