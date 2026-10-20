const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const CONTENTS = ['profile', 'assets', 'downloads', 'previews', 'layout.json', 'appearance.json'];
function defaultRoot(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'AuTomato');
  return platform === 'darwin' ? path.join(home, 'Library/Application Support/AuTomato') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'AuTomato');
}
function validateRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Choose an absolute folder path.');
  const target = path.resolve(value);
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('That drive is unavailable. Choose a folder on a mounted drive.');
    ancestor = parent;
  }
  const resolved = fs.realpathSync(ancestor);
  if (target === path.parse(target).root) throw new Error('Choose a dedicated folder, not a drive root.');
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) throw new Error('Choose a folder, not a file.');
  return path.resolve(resolved, path.relative(ancestor, target));
}
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function validateDestination(source, target) {
  source = validateRoot(source); target = validateRoot(target);
  if (source === target) return target;
  const realSource = fs.existsSync(source) ? fs.realpathSync(source) : source;
  const realTarget = fs.existsSync(target) ? fs.realpathSync(target) : target;
  if (isInside(source, target) || isInside(target, source) || isInside(realSource, realTarget) || isInside(realTarget, realSource)) throw new Error('Choose a separate folder outside the current data folder.');
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('Choose an empty folder. Existing files will not be overwritten.');
  fs.mkdirSync(target, { recursive: true });
  fs.accessSync(target, fs.constants.W_OK);
  return target;
}
function validateRecoveryDestination(value) {
  const target = validateRoot(value);
  const workspace = ['profile', 'assets'].every(name => {
    const file = path.join(target, name);
    return fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isDirectory();
  });
  if (fs.existsSync(target) && fs.readdirSync(target).length && !workspace) throw new Error('Choose an empty folder or an existing AuTomato workspace.');
  fs.mkdirSync(target, { recursive: true }); fs.accessSync(target, fs.constants.W_OK);
  return target;
}
function readConfig(folder) {
  const file = path.join(folder, 'storage-location.json');
  if (!fs.existsSync(file)) return {};
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The storage location setting is invalid.');
  if (value.dataDir) validateRoot(value.dataDir);
  return value;
}
function saveConfig(folder, value) {
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'storage-location.json');
  // Preserve the prior setting rather than deleting or overwriting its only copy.
  if (fs.existsSync(file)) {
    const history = path.join(folder, 'storage-history'); fs.mkdirSync(history, { recursive: true });
    fs.copyFileSync(file, path.join(history, `${Date.now()}-${crypto.randomUUID()}.json`), fs.constants.COPYFILE_EXCL);
  }
  const temporary = path.join(folder, `storage-location-${crypto.randomUUID()}.next`);
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}
function digest(file) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), fd = fs.openSync(file, 'r');
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function copyWorkspace(source, target) {
  source = validateRoot(source); target = validateRoot(target);
  if (isInside(source, target) || isInside(target, source)) throw new Error('Storage folders must be separate.');
  const copy = (from, to, profile = false) => {
    const entry = fs.lstatSync(from);
    if (profile && /^(Singleton(Cookie|Lock|Socket)|lockfile|LOCK)$/.test(path.basename(from))) return;
    if (entry.isSymbolicLink()) throw new Error('A linked file was found. The original workspace is unchanged.');
    if (fs.existsSync(to) && fs.lstatSync(to).isSymbolicLink()) throw new Error('The destination contains a linked file. Nothing was overwritten.');
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name), profile);
    } else if (entry.isFile()) {
      // Interrupted transfers may resume only when already-copied bytes match.
      if (!fs.existsSync(to)) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      if (!fs.statSync(to).isFile() || digest(from) !== digest(to)) {
        const error = new Error('A copied file does not match. The original workspace is unchanged.');
        error.code = 'ECOPYMISMATCH'; throw error;
      }
    }
  };
  fs.mkdirSync(target, { recursive: true });
  for (const name of CONTENTS) if (fs.existsSync(path.join(source, name))) copy(path.join(source, name), path.join(target, name), name === 'profile');
}
function resolveStorage(env = process.env) {
  const configDir = validateRoot(env.AUTOMATO_CONFIG_DIR || defaultRoot(process.platform, os.homedir(), env));
  const explicit = !!env.AUTOMATO_DATA_DIR;
  try {
    const config = explicit ? {} : readConfig(configDir);
    const dataDir = validateRoot(env.AUTOMATO_DATA_DIR || config.dataDir || configDir);
    return { configDir, dataDir, explicit, config, setupRequired: !explicit && !config.dataDir };
  } catch {
    // Do not expose malformed file contents or silently replace the saved choice.
    return { configDir, dataDir: configDir, explicit, config: {}, setupRequired: true, recovery: { kind: explicit ? 'override' : 'location', message: explicit ? 'The launch data-folder override is unavailable or invalid. Close AuTomato and correct AUTOMATO_DATA_DIR before launching again.' : 'The saved data folder is unavailable, or its setting is damaged. Reconnect the drive or select an existing AuTomato workspace. You can also choose an empty folder to start separately.' } };
  }
}
function prepareStorage(env = process.env) {
  const storage = resolveStorage(env);
  if (storage.recovery || !storage.config.pendingMove) return storage;
  try {
    const move = storage.config.pendingMove;
    if (move.source !== storage.dataDir || !Number.isInteger(move.pid)) throw new Error('Invalid pending transfer.');
    let alive = true;
    try { process.kill(move.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('The previous process is still running.');
    copyWorkspace(move.source, move.target);
    saveConfig(storage.configDir, { dataDir: validateRoot(move.target) });
    return resolveStorage(env);
  } catch (error) {
    const conflict = error.code === 'ECOPYMISMATCH';
    return { ...storage, setupRequired: true, recovery: { kind: 'transfer', retryable: !conflict, message: conflict ? 'A file in the destination differs from the original. Both copies are preserved. Keep using the original folder below, or choose another empty folder to copy into.' : 'The workspace copy could not finish. Both folders are preserved. Keep using the original folder below, choose another empty folder, or retry after resolving the destination problem.' } };
  }
}
module.exports = { defaultRoot, validateRoot, validateDestination, validateRecoveryDestination, readConfig, saveConfig, copyWorkspace, resolveStorage, prepareStorage };
