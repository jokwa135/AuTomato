const api = window.automato;
document.querySelector('#appearance').textContent = 'Settings';
document.querySelector('#appearance').setAttribute('aria-label', 'Settings');
const $ = selector => document.querySelector(selector);
let latest, source = 'assets';
const prefs = window.automatoPreferences;
let lastBounds = '', lastTabs = '', lastFiles = '', lastAssetsRevision = -1, lastTheme = '', drag, nextDrag = 1, resizeFrame;
const colorMode = matchMedia('(prefers-color-scheme: dark)');
const sidebarHandle = document.createElement('div'); sidebarHandle.id = 'sidebarResize'; sidebarHandle.className = 'resize-handle vertical'; sidebarHandle.dataset.resize = 'sidebarWidth'; sidebarHandle.tabIndex = 0; sidebarHandle.setAttribute('role', 'separator'); sidebarHandle.setAttribute('aria-label', 'Resize asset shelf'); sidebarHandle.setAttribute('aria-orientation', 'vertical'); sidebarHandle.title = 'Drag to resize shelf · Double-click to reset'; $('#library').append(sidebarHandle);
const bottomHandle = document.createElement('div'); bottomHandle.id = 'bottomResize'; bottomHandle.className = 'resize-handle horizontal'; bottomHandle.dataset.resize = 'bottomHeight'; bottomHandle.tabIndex = 0; bottomHandle.setAttribute('role', 'separator'); bottomHandle.setAttribute('aria-label', 'Resize prompt panel'); bottomHandle.setAttribute('aria-orientation', 'horizontal'); bottomHandle.title = 'Drag to resize prompt panel · Double-click to reset'; $('#bottomPanel').append(bottomHandle);
function message(text) { $('#message').textContent = text; }
async function run(command, args) { try { return await api.command(command, args); } catch (error) { message(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } }
function bounds() { const box = $('#surface').getBoundingClientRect(); const value = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }; const signature = JSON.stringify(value); if (signature !== lastBounds) { lastBounds = signature; api.bounds(value); } }
const observer = new ResizeObserver(bounds); observer.observe($('#surface'));
function applySizes() {
  if (!latest) return;
  const limits = prefs.sizeLimits(innerWidth, innerHeight, latest.layout.studiosHeight);
  for (const [key, variable] of Object.entries({ sidebarWidth: '--sidebar-width', bottomHeight: '--bottom-height', studiosHeight: '--studios-height' })) {
    const value = prefs.clamp(latest.layout[key], limits[key]); document.documentElement.style.setProperty(variable, value + 'px');
    const handle = document.querySelector(`[data-resize="${key}"]`); handle.setAttribute('aria-valuemin', limits[key][0]); handle.setAttribute('aria-valuemax', limits[key][1]); handle.setAttribute('aria-valuenow', value);
  }
  bounds();
}
function applyTheme() {
  if (!latest) return;
  const signature = JSON.stringify([latest.appearance, colorMode.matches]); if (signature === lastTheme) return; lastTheme = signature;
  for (const [key, value] of Object.entries(prefs.themeTokens(latest.appearance, colorMode.matches))) document.documentElement.style.setProperty(key, value);
}
colorMode.addEventListener('change', applyTheme); addEventListener('resize', applySizes);
function render(state) {
  if (drag && latest) state.layout = latest.layout;
  latest = state;
  document.body.classList.toggle('no-sidebar', !state.layout.sidebar);
  document.body.classList.toggle('no-bottom', !state.layout.bottom);
  $('#sidebar').setAttribute('aria-expanded', String(state.layout.sidebar));
  $('#bottom').setAttribute('aria-expanded', String(state.layout.bottom));
  const studios = $('#studios');
  if (!studios.querySelector('[data-studio]')) for (const studio of state.studios) {
    const button = document.createElement('button'); button.dataset.studio = studio.id;
    const icon = document.createElement('img'); icon.src = `assets/${({ flow: 'flow.png', clipscript: 'clipscript.png' })[studio.id] || studio.id + '.ico'}`; icon.alt = ''; icon.onerror = () => icon.hidden = true;
    button.append(icon, document.createTextNode(studio.name)); button.onclick = () => run('switch', { studio: studio.id }); studios.insertBefore(button, $('#studiosResize'));
  }
  for (const button of studios.querySelectorAll('[data-studio]')) { const active = button.dataset.studio === state.active; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  const tabs = state.tabs.filter(tab => tab.studio === state.active), selected = tabs.find(tab => tab.active);
  $('#pageTitle').textContent = selected?.title || state.studios.find(studio => studio.id === state.active)?.name || 'Local test';
  $('#pageStatus').textContent = selected?.error || (selected?.loading ? 'Loading website…' : selected?.url || '');
  const tabSignature = JSON.stringify(tabs.map(tab => [tab.id, tab.active, tab.title]));
  if (tabSignature !== lastTabs) { lastTabs = tabSignature; $('#tabs').replaceChildren();
  if (tabs.length > 1) for (const tab of tabs) {
    const box = document.createElement('div'); box.className = `tab ${tab.active ? 'active' : ''}`;
    const button = document.createElement('button'); button.textContent = tab.title || 'Opening tab…'; button.onclick = () => run('select-tab', { id: tab.id });
    const close = document.createElement('button'); close.className = 'close-tab'; close.textContent = '×'; close.setAttribute('aria-label', 'Close ' + button.textContent); close.onclick = () => run('close-tab', { id: tab.id });
    box.append(button, close); $('#tabs').append(box);
  }
  }
  if (state.assetsRevision !== lastAssetsRevision) { lastAssetsRevision = state.assetsRevision; refreshFiles(); }
  applyTheme(); applySizes();
}
async function refreshFiles() {
  const items = await run('assets'); if (!items) return;
  const files = items.filter(item => item.source === source);
  const signature = JSON.stringify([source, files]); if (signature === lastFiles) return; lastFiles = signature;
  $('#count').textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  $('#files').replaceChildren();
  if (!files.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = source === 'assets' ? 'A little room for your next idea. Add a reference to begin.' : 'Files downloaded from the studios will appear here.'; $('#files').append(p); }
  for (const file of files) {
    const button = document.createElement('button'); button.className = 'file'; button.title = `Attach ${file.name} to the current website`;
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = file.name.split('.').at(-1).slice(0, 4).toUpperCase();
    const label = document.createElement('span'); label.className = 'file-label'; const title = document.createElement('strong'); title.textContent = file.name;
    const meta = document.createElement('small'); meta.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · Click to attach`; label.append(title, meta); button.append(icon, label);
    button.onclick = async () => { try { await api.attach(file.path); message('Attached ' + file.name); } catch (error) { message(error.message); } };
    $('#files').append(button);
  }
}
$('#sidebar').onclick = () => run('panels', { sidebar: !latest.layout.sidebar });
$('#bottom').onclick = () => run('panels', { bottom: !latest.layout.bottom });
$('#back').onclick = () => run('back'); $('#reload').onclick = () => run('reload');
$('#add').onclick = async () => { try { await api.choose(); await refreshFiles(); } catch (error) { message(error.message); } };
$('#folder').onclick = () => api.folder(source);
$('#appearance').onclick = () => run('appearance-window');

function resizeAt(event) {
  if (!drag) return;
  const key = drag.key, delta = key === 'sidebarWidth' ? event.clientX - drag.x : (event.clientY - drag.y) * (key === 'bottomHeight' ? -1 : 1);
  const limits = prefs.sizeLimits(innerWidth, innerHeight, latest.layout.studiosHeight);
  latest.layout[key] = prefs.clamp(drag.value + delta, limits[key]); applySizes();
}
async function finishResize(cancel = false) {
  if (!drag) return;
  const ending = drag; drag = null; cancelAnimationFrame(resizeFrame);
  if (cancel) latest.layout = ending.original;
  document.body.classList.remove('resizing'); applySizes();
  await api.resize('end', ending.token);
  if (!drag) $('#surface').style.backgroundImage = '';
  await run('panels', latest.layout);
}
for (const handle of document.querySelectorAll('[data-resize]')) {
  handle.onpointerdown = async event => {
    if (event.button !== 0 || drag) return; event.preventDefault(); handle.setPointerCapture(event.pointerId);
    const active = { key: handle.dataset.resize, x: event.clientX, y: event.clientY, value: Number(handle.getAttribute('aria-valuenow')), original: { ...latest.layout }, token: nextDrag++ }; drag = active;
    try {
      const image = await api.resize('begin', active.token);
      if (drag !== active) { await api.resize('end', active.token); return; }
      $('#surface').style.backgroundImage = image ? `url("${image}")` : '';
      document.body.style.setProperty('--resize-cursor', active.key === 'sidebarWidth' ? 'col-resize' : 'row-resize'); document.body.classList.add('resizing');
    } catch (error) { message(error.message); finishResize(true); }
  };
  handle.onpointermove = event => { if (!drag) return; cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => resizeAt(event)); };
  handle.onpointerup = event => { if (drag) { resizeAt(event); finishResize(); } };
  handle.onlostpointercapture = () => finishResize();
  handle.ondblclick = () => { latest.layout[handle.dataset.resize] = prefs.DEFAULT_LAYOUT[handle.dataset.resize]; applySizes(); run('panels', latest.layout); };
  handle.onkeydown = event => {
    const key = handle.dataset.resize, limits = prefs.sizeLimits(innerWidth, innerHeight, latest.layout.studiosHeight);
    const direction = key === 'sidebarWidth' ? { ArrowLeft: -1, ArrowRight: 1 } : key === 'bottomHeight' ? { ArrowUp: 1, ArrowDown: -1 } : { ArrowUp: -1, ArrowDown: 1 };
    if (!(event.key in direction) && event.key !== 'Home') return; event.preventDefault();
    latest.layout[key] = event.key === 'Home' ? prefs.DEFAULT_LAYOUT[key] : prefs.clamp(Number(handle.getAttribute('aria-valuenow')) + direction[event.key] * (event.shiftKey ? 1 : 16), limits[key]);
    applySizes(); run('panels', latest.layout);
  };
}
addEventListener('blur', () => finishResize()); addEventListener('keydown', event => { if (event.key === 'Escape' && drag) finishResize(true); });
document.querySelectorAll('[data-source]').forEach(button => button.onclick = () => { source = button.dataset.source; document.querySelectorAll('[data-source]').forEach(b => b.classList.toggle('selected', b === button)); refreshFiles(); });
document.querySelectorAll('[data-window]').forEach(button => button.onclick = () => run('window', { action: button.dataset.window }));
api.onState(render); run('status').then(state => { if (state) render(state); });
