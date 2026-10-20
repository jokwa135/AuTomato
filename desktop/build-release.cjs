const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const mac = process.argv.includes('--mac');
const macInstaller = process.argv.includes('--mac-installer');
require('./package-local.cjs');
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
for (const [key, name] of Object.entries({ TEMP: '.tmp', TMP: '.tmp', npm_config_cache: '.npm-cache', ELECTRON_BUILDER_CACHE: '.electron-builder-cache', ELECTRON_CACHE: '.electron-cache' })) {
  env[key] = path.join(root, name); fs.mkdirSync(env[key], { recursive: true });
}
env.PATH = path.dirname(process.execPath) + path.delimiter + env.PATH;
delete env.ELECTRON_RUN_AS_NODE;
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (macInstaller) {
  run(process.env.AUTOMATO_BUILD_PYTHON || 'python', [path.join(__dirname, 'build-mac-installer.py')]);
} else {
  run(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--config', path.join(__dirname, 'builder-release.cjs'), ...(mac ? ['--mac', 'zip', '--x64', '--arm64'] : ['--win', '--dir']), '--publish', 'never']);
  if (!mac) {
    run(process.execPath, [path.join(__dirname, 'prepare-windows-tools.cjs')]);
    const signerCache = path.join(root, '.electron-builder-cache/winCodeSign');
    const editor = fs.readdirSync(signerCache).map(folder => path.join(signerCache, folder, 'rcedit-x64.exe')).find(file => fs.existsSync(file));
    if (editor) run(editor, [path.join(root, 'dist/installers/build/win-unpacked/AuTomato.exe'), '--set-icon', path.join(__dirname, 'assets/installer-icons/icon.ico'), '--set-version-string', 'ProductName', 'AuTomato', '--set-version-string', 'FileDescription', 'AuTomato creative workspace', '--set-file-version', '0.3.2.0', '--set-product-version', '0.3.2.0']);
    run(path.join(root, '.electron-builder-cache/nsis/nsis-3.0.4.1/Bin/makensis.exe'), ['/V2', path.join(__dirname, 'installer.nsi')]);
    for (const name of ['Install AuTomato Windows.cmd', 'INSTALL.txt']) fs.copyFileSync(path.join(__dirname, name), path.join(root, 'dist/installers', name));
  }
}
