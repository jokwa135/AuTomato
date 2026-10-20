(function () {
  const DEFAULT_LAYOUT = { sidebar: true, bottom: true, sidebarWidth: 264, bottomHeight: 125, studiosHeight: 59 };
  const DEFAULT_APPEARANCE = { mode: 'light', theme: 'orchard', accent: null, background: null, foreground: null, font: 'Segoe UI' };
  const FONTS = ['Segoe UI', 'Arial', 'Georgia', 'Consolas', 'System UI'];
  const THEMES = {
    orchard: { name: 'Orchard', light: ['#f6f1e7', '#263b2f', '#e8472d', '#174a33'], dark: ['#202620', '#e8e5d8', '#ff7858', '#a8c8a0'] },
    everforest: { name: 'Everforest', light: ['#f3ead3', '#4c5d4f', '#aa5161', '#496b50'], dark: ['#222628', '#d3c9b3', '#e87678', '#a7c080'] },
    graphite: { name: 'Graphite', light: ['#f2f3f5', '#292b30', '#5d67c9', '#50599d'], dark: ['#1d1e20', '#e5e4e2', '#a4b5f6', '#a4b5f6'] },
    rosewood: { name: 'Rosewood', light: ['#f7edf0', '#563d49', '#b74e67', '#8d455f'], dark: ['#2a2228', '#f0dce5', '#e49b9a', '#e3b1c6'] },
    nord: { name: 'Nord', light: ['#e9edf2', '#2e3440', '#507b97', '#4b728d'], dark: ['#242933', '#d8dee9', '#88c0d0', '#a3be8c'] }
  };
  const clamp = (value, range) => Math.max(range[0], Math.min(range[1], Math.round(value)));
  function sizeLimits(width, height, studiosHeight) {
    return { sidebarWidth: [190, Math.max(190, Math.min(560, width - 480))], bottomHeight: [88, Math.max(88, Math.min(420, height - 65 - studiosHeight - 46 - 28 - 180))], studiosHeight: [44, 112] };
  }
  function normalizeLayout(value = {}, fallback = DEFAULT_LAYOUT) {
    const result = { ...fallback }, ranges = { sidebarWidth: [190, 560], bottomHeight: [88, 420], studiosHeight: [44, 112] };
    for (const key of ['sidebar', 'bottom']) if (typeof value?.[key] === 'boolean') result[key] = value[key];
    for (const key of Object.keys(ranges)) if (typeof value?.[key] === 'number' && Number.isFinite(value[key])) result[key] = clamp(value[key], ranges[key]);
    return result;
  }
  function normalizeAppearance(value = {}, fallback = DEFAULT_APPEARANCE) {
    const result = { ...fallback };
    if (['system', 'light', 'dark'].includes(value?.mode)) result.mode = value.mode;
    if (Object.hasOwn(THEMES, value?.theme)) result.theme = value.theme;
    if (FONTS.includes(value?.font)) result.font = value.font;
    for (const key of ['accent', 'background', 'foreground']) {
      if (value?.[key] === null) result[key] = null;
      else if (typeof value?.[key] === 'string' && /^#[\da-f]{6}$/i.test(value[key])) result[key] = value[key].toLowerCase();
    }
    return result;
  }
  function mix(a, b, fraction) {
    return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - fraction) + parseInt(b.slice(i, i + 2), 16) * fraction).toString(16).padStart(2, '0')).join('');
  }
  function themeTokens(prefs, systemDark) {
    const dark = prefs.mode === 'dark' || (prefs.mode === 'system' && systemDark);
    const [paper, ink, accent, green] = THEMES[prefs.theme][dark ? 'dark' : 'light'];
    const bg = prefs.background || paper, fg = prefs.foreground || ink;
    return { '--paper': bg, '--ink': fg, '--red': prefs.accent || accent, '--green': prefs.foreground || green,
      '--line': mix(bg, fg, .16), '--muted': mix(bg, fg, .62), '--shelf': mix(bg, fg, .045), '--nav': mix(bg, dark ? fg : '#ffffff', dark ? .025 : .25),
      '--well': mix(bg, dark ? fg : '#ffffff', dark ? .06 : .45), '--hover': mix(bg, fg, .08), '--app-font': prefs.font === 'System UI' ? 'system-ui, sans-serif' : `"${prefs.font}", system-ui, sans-serif`, 'color-scheme': dark ? 'dark' : 'light' };
  }
  const api = { DEFAULT_LAYOUT, DEFAULT_APPEARANCE, FONTS, THEMES, clamp, sizeLimits, normalizeLayout, normalizeAppearance, themeTokens };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.automatoPreferences = api;
})();
