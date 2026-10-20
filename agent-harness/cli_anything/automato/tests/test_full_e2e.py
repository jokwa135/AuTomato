"""Real installed CLI -> local IPC -> real Electron -> fixture page."""
import json
import os
import shutil
import struct
import subprocess
import time
from pathlib import Path


def _resolve_cli(name):
    installed = shutil.which(name)
    if installed:
        return [installed]
    if os.environ.get('CLI_ANYTHING_FORCE_INSTALLED') == '1':
        raise RuntimeError('Installed command missing: ' + name)
    return [os.sys.executable, '-m', 'cli_anything.automato']


class TestCLISubprocess:
    def run_cli(self, *args, check=True):
        result = subprocess.run(_resolve_cli('cli-anything-automato') + ['--json', *args], capture_output=True, text=True, encoding='utf-8', timeout=25)
        if check:
            assert result.returncode == 0, result.stderr or result.stdout
            return json.loads(result.stdout)
        return result

    def ref(self, name, role=None):
        snapshot = self.run_cli('inspect')
        return next(node['ref'] for node in snapshot['nodes'] if node['name'] == name and (not role or node['role'] == role))

    def wait_for_viewport(self):
        deadline = time.monotonic() + 8
        while True:
            state = self.run_cli('status')
            viewport = self.run_cli('test-state')
            if all(viewport[key] == state['bounds'][key] for key in ('width', 'height')):
                return state
            assert time.monotonic() < deadline, (viewport, state['bounds'])
            time.sleep(0.1)

    def test_installed_status_and_help(self):
        assert self.run_cli('status')['local'] is True
        assert {studio['id'] for studio in self.run_cli('studios')} == {'higgsfield', 'flow', 'symphony', 'tiktok', 'capcut', 'clipscript'}
        result = subprocess.run(_resolve_cli('cli-anything-automato') + ['--help'], capture_output=True, text=True, timeout=10)
        assert result.returncode == 0
        assert 'inspect' in result.stdout

    def test_repl_accepts_piped_help_and_exit(self):
        result = subprocess.run(_resolve_cli('cli-anything-automato'), input='help\nexit\n', capture_output=True, text=True, encoding='utf-8', timeout=10)
        assert result.returncode == 0, result.stderr
        assert 'inspect' in result.stdout

    def test_real_click_and_typing(self):
        self.run_cli('click', self.ref('Test click', 'button'))
        assert self.run_cli('test-state')['result'] == 'Click received'
        self.run_cli('fill', self.ref('Test text', 'textbox'), 'AuTomato: café and 日本語')
        assert self.run_cli('test-state')['text'] == 'AuTomato: café and 日本語'
        self.run_cli('press', 'Backspace')
        assert self.run_cli('test-state')['text'] == 'AuTomato: café and 日本'

    def test_reject_stale_refs_and_bad_navigation(self):
        old = self.ref('Test click', 'button')
        self.run_cli('inspect')
        result = self.run_cli('click', old, check=False)
        assert result.returncode != 0
        assert 'Stale' in result.stderr
        result = self.run_cli('page', 'navigate', 'javascript:alert(1)', check=False)
        assert result.returncode != 0

    def test_upload_real_file_and_import(self):
        image = Path(__file__).resolve().parents[4] / 'desktop/assets/automato.png'
        self.run_cli('upload', self.ref('Test file', 'button'), str(image))
        assert self.run_cli('test-state')['attached'] == 'automato.png'
        imported = self.run_cli('assets', 'import', str(image))['imported'][0]
        assert Path(imported).read_bytes() == image.read_bytes()
        assert any(asset['path'] == imported for asset in self.run_cli('assets', 'list'))

    def test_popup_round_trip(self):
        original = self.run_cli('status')['tabs'][0]['id']
        self.run_cli('click', self.ref('Open test tab', 'link'))
        for _ in range(30):
            tabs = self.run_cli('tabs', 'list')
            if len(tabs) > 1:
                break
            time.sleep(0.1)
        assert len(tabs) == 2
        child = next(tab for tab in tabs if tab['id'] != original)
        assert child['active'] is True
        for _ in range(20):
            popup = self.run_cli('inspect')
            if popup['title'] == 'AuTomato popup test':
                break
            time.sleep(0.1)
        assert popup['title'] == 'AuTomato popup test'
        assert any(node['name'] == 'Local popup' for node in popup['nodes'])
        self.run_cli('tabs', 'select', str(original))
        assert self.run_cli('inspect')['title'] == 'AuTomato local test'
        self.run_cli('tabs', 'close', str(child['id']))
        assert len(self.run_cli('tabs', 'list')) == 1

    def test_hidden_file_input(self):
        image = Path(__file__).resolve().parents[4] / 'desktop/assets/automato.png'
        snapshot = self.run_cli('inspect', '--query', 'Hidden upload')
        node = next(node for node in snapshot['nodes'] if node['name'] == 'Hidden upload')
        assert node['role'] == 'fileinput'
        assert node['accept'] == 'image/png'
        self.run_cli('upload', node['ref'], str(image))
        assert self.run_cli('test-state')['attached'] == 'hidden:automato.png'

    def test_panels_resize_without_stream_scaling(self):
        before = self.run_cli('status')['bounds']
        self.run_cli('panels', '--sidebar', 'hide', '--bottom', 'hide')
        after = self.wait_for_viewport()['bounds']
        assert after['width'] > before['width']
        assert after['height'] > before['height']
        viewport = self.run_cli('test-state')
        assert viewport['width'] == after['width']
        assert viewport['height'] == after['height']
        self.run_cli('panels', '--sidebar', 'show', '--bottom', 'show')
        self.wait_for_viewport()

    def test_native_capture_bundle(self):
        result = self.run_cli('preview', 'capture')
        png = Path(result['path']).read_bytes()
        assert png[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II', png[16:24]) == (result['width'], result['height'])
        assert result['width'] > 500
        assert len(set(png[40:])) > 50
        manifest = json.loads(Path(result['_manifest_path']).read_text())
        assert manifest['protocol_version'] == 'preview-bundle/v1'
        assert self.run_cli('preview', 'latest')['_bundle_dir'] == result['_bundle_dir']
        print('\nNative preview:', result['path'])

    def test_scroll_native_page(self):
        self.run_cli('scroll', '650')
        time.sleep(0.4)
        assert self.run_cli('test-state')['scroll'] > 0
        self.run_cli('scroll', '-650')

    def test_resize_preferences(self):
        original = self.run_cli('status')['layout']
        self.run_cli('panels', '--sidebar-width', '320', '--bottom-height', '180', '--studios-height', '72')
        state = self.wait_for_viewport()
        assert state['bounds']['x'] == 320
        assert state['layout']['bottomHeight'] == 180
        assert state['bounds']['y'] == 183
        viewport = self.run_cli('test-state')
        assert viewport['width'] == state['bounds']['width']
        assert viewport['height'] == state['bounds']['height']
        self.run_cli('panels', '--sidebar-width', str(original['sidebarWidth']), '--bottom-height', str(original['bottomHeight']), '--studios-height', str(original['studiosHeight']))
        self.wait_for_viewport()

    def test_appearance_preferences(self):
        self.run_cli('appearance', '--mode', 'dark', '--theme', 'everforest', '--accent', '#E87678', '--font', 'Consolas')
        prefs = self.run_cli('appearance')
        assert prefs['mode'] == 'dark'
        assert prefs['theme'] == 'everforest'
        assert prefs['accent'] == '#e87678'
        assert prefs['font'] == 'Consolas'
        file = Path(self.run_cli('status')['dataDir']) / 'appearance.json'
        assert json.loads(file.read_text()) == prefs
        self.run_cli('appearance', '--reset')
