const api = window.automato, prefs = window.automatoPreferences;
const $ = selector => document.querySelector(selector);
const system = matchMedia('(prefers-color-scheme: dark)');
let current, last = '';
for (const [value, theme] of Object.entries(prefs.THEMES)) { const option = document.createElement('option'); option.value = value; option.textContent = theme.name; $('#theme').append(option); }
for (const font of prefs.FONTS) { const option = document.createElement('option'); option.value = font; option.textContent = font; $('#font').append(option); }
function render(state) {
  current = state.appearance;
  const signature = JSON.stringify([current, system.matches]); if (signature === last) return; last = signature;
  const tokens = prefs.themeTokens(current, system.matches);
  for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value);
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === current.mode));
  $('#theme').value = current.theme; $('#font').value = current.font;
  for (const [key, token] of Object.entries({ accent: '--red', background: '--paper', foreground: '--ink' })) { $('#' + key).value = tokens[token]; $('#' + key + 'Hex').value = tokens[token].toUpperCase(); $('#' + key + 'Hex').removeAttribute('aria-invalid'); }
}
async function save(values) {
  try { const appearance = await api.command('appearance', values); last = ''; render({ appearance }); $('#saved').textContent = 'Saved automatically on this computer'; }
  catch (error) { $('#saved').textContent = error.message; }
}
for (const button of document.querySelectorAll('[data-mode]')) button.onclick = () => save({ mode: button.dataset.mode });
$('#theme').onchange = event => save({ theme: event.target.value, accent: null, background: null, foreground: null });
$('#font').onchange = event => save({ font: event.target.value });
for (const key of ['accent', 'background', 'foreground']) {
  $('#' + key).onchange = event => save({ [key]: event.target.value });
  $('#' + key + 'Hex').onchange = event => {
    if (!/^#[\da-f]{6}$/i.test(event.target.value)) { event.target.setAttribute('aria-invalid', 'true'); $('#saved').textContent = 'Use a six-digit hex color, for example #E87678'; return; }
    save({ [key]: event.target.value });
  };
}
$('#reset').onclick = () => save({ reset: true }); $('#close').onclick = () => api.closeAppearance();
addEventListener('keydown', event => { if (event.key === 'Escape') api.closeAppearance(); });
system.addEventListener('change', () => { if (current) render({ appearance: current }); });
api.onState(render); api.command('status').then(render);
async function showSettingsTab(tab) {
  const storageTab = tab === 'storage';
  $('#appearanceSection').hidden = storageTab; $('#storageSection').hidden = !storageTab;
  document.title = storageTab ? 'AuTomato Storage' : 'AuTomato Appearance';
  for (const button of document.querySelectorAll('[data-settings-tab]')) button.setAttribute('aria-selected', String(button.dataset.settingsTab === (storageTab ? 'storage' : 'appearance')));
  if (storageTab) {
    try { const info = await api.storageInfo(); $('#storagePath').textContent = info.dataDir; $('#storageOverride').hidden = !info.launchOverride; $('#storageChoose').disabled = info.launchOverride || info.restartPending; }
    catch (error) { $('#storageStatus').textContent = error.message; }
  }
}
for (const button of document.querySelectorAll('[data-settings-tab]')) button.onclick = () => showSettingsTab(button.dataset.settingsTab);
$('#storageOpen').onclick = () => api.openStorage();
$('#storageChoose').onclick = async () => {
  try { const folder = await api.chooseStorage(); if (!folder) return; $('#storageChoose').disabled = true; const result = await api.saveStorage(folder); if (result.canceled) $('#storageChoose').disabled = false; else $('#storageStatus').textContent = 'Restarting and copying your workspace…'; }
  catch (error) { $('#storageStatus').textContent = error.message; $('#storageChoose').disabled = false; }
};
api.onSettingsTab(showSettingsTab); showSettingsTab(new URLSearchParams(location.search).get('tab'));
