const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require('./package-local.cjs');
const env = { ...process.env };
for (const [key, name] of Object.entries({ TEMP: '.tmp', TMP: '.tmp', npm_config_cache: '.npm-cache', ELECTRON_BUILDER_CACHE: '.electron-builder-cache' })) {
  env[key] = path.join(root, name);
  fs.mkdirSync(env[key], { recursive: true });
}
// electron-builder invokes npm.cmd itself; include the actual Node installation.
const candidates = [path.dirname(process.execPath), ...(process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, 'nodejs')] : [])];
const npmDir = candidates.find(folder => fs.existsSync(path.join(folder, process.platform === 'win32' ? 'npm.cmd' : 'npm')));
if (npmDir) env.PATH = npmDir + path.delimiter + env.PATH;
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--config', path.join(__dirname, 'builder.cjs'), '--win', '--dir'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
