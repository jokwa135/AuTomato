const path = require('node:path');
const base = require('./builder.cjs');
const mac = process.argv.includes('--mac');
module.exports = {
  ...base,
  directories: { ...base.directories, output: path.resolve(__dirname, '../dist/installers/build') },
  electronDist: mac ? undefined : base.electronDist,
  extraResources: [
    { from: path.resolve(__dirname, '../agent-harness'), to: 'cli-anything', filter: [
      'setup.py', 'AUTOMATO.md', 'cli_anything/automato/__init__.py',
      'cli_anything/automato/__main__.py', 'cli_anything/automato/automato_cli.py',
      'cli_anything/automato/utils/__init__.py', 'cli_anything/automato/utils/automato_backend.py',
      'cli_anything/automato/utils/repl_skin.py', 'cli_anything/automato/README.md',
      'cli_anything/automato/skills/SKILL.md', 'cli_anything/automato/licenses/AuTomato-MIT.txt',
      'cli_anything/automato/licenses/CLI-Anything.txt'
    ] },
    { from: path.resolve(__dirname, '../LICENSE'), to: 'LICENSE' },
    { from: path.resolve(__dirname, '../THIRD_PARTY_NOTICES.md'), to: 'THIRD_PARTY_NOTICES.md' },
    { from: path.resolve(__dirname, '../licenses'), to: 'licenses', filter: ['Click.txt', 'Electron.txt', 'NSIS.txt', 'electron-builder.txt'] }
  ],
  win: { target: 'dir', icon: path.resolve(__dirname, 'assets/installer-icons/icon.ico'), signAndEditExecutable: false },
  mac: { target: 'zip', identity: null, hardenedRuntime: false, notarize: false, category: 'public.app-category.video', icon: path.resolve(__dirname, 'assets/installer-icons/icon.icns'), artifactName: 'AuTomato-${version}-mac-${arch}.zip' }
};
