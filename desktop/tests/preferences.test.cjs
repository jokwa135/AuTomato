const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_LAYOUT, DEFAULT_APPEARANCE, normalizeLayout, normalizeAppearance, sizeLimits, themeTokens } = require('../preferences.cjs');

test('old collapse settings retain the original layout sizes', () => {
  assert.deepEqual(normalizeLayout({ sidebar: false }), { ...DEFAULT_LAYOUT, sidebar: false });
  assert.equal(normalizeLayout({ sidebarWidth: -40, bottomHeight: Infinity }).sidebarWidth, 190);
  assert.equal(normalizeLayout({ bottomHeight: Infinity }).bottomHeight, 125);
});
test('minimum window leaves room for a usable native website', () => {
  assert.equal(sizeLimits(900, 600, 112).sidebarWidth[1], 420);
  assert.equal(sizeLimits(900, 600, 112).bottomHeight[1], 169);
});
test('appearance accepts only supported fonts, modes and valid hex colors', () => {
  assert.deepEqual(normalizeAppearance({ mode: 'unexpected', background: 'url(file:secret)', font: 'unknown' }), DEFAULT_APPEARANCE);
  assert.equal(normalizeAppearance({ accent: '#E87678' }).accent, '#e87678');
  assert.equal(normalizeAppearance({ accent: null }, { ...DEFAULT_APPEARANCE, accent: '#112233' }).accent, null);
});
test('theme mode changes colors and custom colors remain exact', () => {
  assert.equal(themeTokens(DEFAULT_APPEARANCE, false)['--paper'], '#f6f1e7');
  const system = { ...DEFAULT_APPEARANCE, mode: 'system' };
  assert.notEqual(themeTokens(system, true)['--paper'], themeTokens(system, false)['--paper']);
  assert.equal(themeTokens({ ...system, background: '#123456' }, true)['--paper'], '#123456');
});
