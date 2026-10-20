const crypto = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'file:' ? 'local:test' : url.origin + url.pathname; } catch { return ''; }
}
function validateUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an http or https URL without embedded credentials');
  return url.href;
}
function bridgeAddress(dataRoot) {
  const id = crypto.createHash('sha256').update(path.resolve(dataRoot) + os.userInfo().username).digest('hex').slice(0, 18);
  return process.platform === 'win32' ? `\\\\.\\pipe\\automato-${id}` : path.join(dataRoot, 'control.sock');
}
function compactAX(nodes, limit = 250) {
  return nodes.filter(node => !node.ignored && node.role?.value && !['none', 'generic', 'InlineTextBox'].includes(node.role.value))
    .slice(0, limit).map(node => {
      const protectedValue = node.properties?.some(prop => prop.name === 'protected' && prop.value?.value);
      return {
        backendId: node.backendDOMNodeId, role: node.role.value, name: node.name?.value || '',
        ...(node.value && !protectedValue && !/password/i.test(node.name?.value || '') ? { value: String(node.value.value).slice(0, 500) } : {}),
        ...(node.properties?.length ? { states: Object.fromEntries(node.properties.filter(prop => ['disabled', 'checked', 'expanded', 'focused', 'required', 'selected'].includes(prop.name)).map(prop => [prop.name, prop.value?.value])) } : {})
      };
    });
}
function createBridge(dataRoot, dispatch) {
  const endpoint = bridgeAddress(dataRoot);
  const server = net.createServer(socket => {
    let data = ''; let handled = false;
    socket.setTimeout(20000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      if (handled) return;
      data += chunk.toString('utf8');
      if (Buffer.byteLength(data) > 1024 * 1024) { socket.destroy(); return; }
      const end = data.indexOf('\n'); if (end < 0) return;
      handled = true;
      (async () => {
        try {
          const request = JSON.parse(data.slice(0, end));
          const result = await dispatch(request.command, request.args || {});
          socket.end(JSON.stringify({ ok: true, result }) + '\n');
        } catch (error) { socket.end(JSON.stringify({ ok: false, error: error.message }) + '\n'); }
      })();
    });
  });
  const discovery = path.join(dataRoot, 'bridge.json');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      if (process.platform !== 'win32') fs.chmodSync(endpoint, 0o600);
      fs.writeFileSync(discovery, JSON.stringify({ version: 1, endpoint, pid: process.pid }), { mode: 0o600 });
      resolve({ server, endpoint });
    });
  });
}
module.exports = { safeUrl, validateUrl, bridgeAddress, compactAX, createBridge };
