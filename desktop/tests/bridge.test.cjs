const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeUrl, compactAX, validateUrl, bridgeAddress } = require('../bridge.cjs');
test('status strips query strings and fragments', () => {
  assert.equal(safeUrl('https://example.com/page?token=secret#private'), 'https://example.com/page');
});
test('navigation permits web URLs and rejects executable/local schemes', () => {
  assert.equal(validateUrl('https://flow.google.com/'), 'https://flow.google.com/');
  for (const url of ['javascript:alert(1)', 'file:///C:/private', 'data:text/html,hello']) assert.throws(() => validateUrl(url));
});
test('compact accessibility output preserves actionable nodes and redacts password values', () => {
  const result = compactAX([
    { nodeId: '1', ignored: true, role: { value: 'none' } },
    { nodeId: '2', backendDOMNodeId: 20, role: { value: 'button' }, name: { value: 'Upload' } },
    { nodeId: '3', backendDOMNodeId: 21, role: { value: 'textbox' }, name: { value: 'Password' }, value: { value: 'private' }, properties: [{ name: 'protected', value: { value: true } }] }
  ], 10);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'Upload');
  assert(!JSON.stringify(result).includes('private'));
});
test('bridge is a local OS pipe or socket, never a TCP listener', () => {
  assert(!bridgeAddress(require('node:path').resolve('fixture-workspace')).includes('://'));
});
