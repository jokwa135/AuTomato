const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'output/local-package');
// Preserve old staging output, then create a clean, explicit distribution.
if (fs.existsSync(target)) fs.renameSync(target, path.join(root, 'output', `local-package-backup-${Date.now()}`));
fs.mkdirSync(target, { recursive: true });
const files = [
  'appearance.cjs', 'appearance.css', 'appearance.html', 'automation.cjs', 'bridge.cjs',
  'fixture-popup.html', 'fixture.html', 'index.html', 'main.cjs', 'preferences.cjs',
  'preferences.css', 'preload.cjs', 'renderer.cjs', 'storage-setup.cjs',
  'storage-setup.html', 'storage.cjs', 'style.css',
  'assets/automato.png', 'assets/capcut.ico', 'assets/clipscript.png',
  'assets/flow.png', 'assets/higgsfield.ico', 'assets/symphony.ico', 'assets/tiktok.ico'
];
for (const name of files) {
  const destination = path.join(target, 'desktop', name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(__dirname, name), destination);
}
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'automato', version: '0.3.2', description: 'Local creative workspace', main: 'desktop/main.cjs', author: 'AuTomato', license: 'MIT', private: true }, null, 2));
const lockPath = path.join(root, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); lock.name = 'automato'; lock.version = '0.3.2'; lock.packages[''].name = 'automato'; lock.packages[''].version = '0.3.2';
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
