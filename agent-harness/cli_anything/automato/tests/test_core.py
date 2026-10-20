import json
from click.testing import CliRunner
from cli_anything.automato.automato_cli import cli


def test_json_dry_run_does_not_require_running_app():
    result = CliRunner().invoke(cli, ['--json', '--dry-run', 'page', 'navigate', 'https://flow.google.com/'])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)['dryRun'] is True


def test_help_lists_inspection_and_navigation():
    result = CliRunner().invoke(cli, ['--help'])
    assert result.exit_code == 0
    assert 'inspect' in result.output
    assert 'preview' in result.output


def test_disconnected_app_has_actionable_error(monkeypatch, tmp_path):
    monkeypatch.setenv('AUTOMATO_DATA_DIR', str(tmp_path))
    result = CliRunner().invoke(cli, ['--json', 'status'])
    assert result.exit_code != 0
    assert 'start' in result.output.lower()


def test_invalid_custom_color_is_rejected_before_contacting_app():
    result = CliRunner().invoke(cli, ['appearance', '--background', 'invalid'])
    assert result.exit_code != 0
    assert 'hex color' in result.output


def test_installer_and_mac_application_locations(monkeypatch, tmp_path):
    from pathlib import Path
    from cli_anything.automato.utils import automato_backend as backend
    root = tmp_path / 'checkout'
    local = tmp_path / 'user-local'
    custom = tmp_path / 'custom-app'
    monkeypatch.setenv('LOCALAPPDATA', str(local))
    monkeypatch.setattr(backend, 'windows_install_location', lambda: custom)
    assert backend.app_candidates(root, 'win32')[0] == custom / 'AuTomato.exe'
    assert local / 'Programs/AuTomato/AuTomato.exe' in backend.app_candidates(root, 'win32')
    assert any(file.as_posix() == '/Applications/AuTomato.app/Contents/MacOS/AuTomato' for file in backend.app_candidates(root, 'darwin'))


def test_configuration_uses_user_local_app_data_without_touching_disk(monkeypatch, tmp_path):
    from cli_anything.automato.utils import automato_backend as backend
    monkeypatch.setattr(backend.sys, 'platform', 'win32')
    monkeypatch.delenv('AUTOMATO_CONFIG_DIR', raising=False)
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path / 'local'))
    assert backend.configuration_root() == tmp_path / 'local/AuTomato'


def test_installer_and_runtime_have_no_fixed_drive_paths():
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parents[4]
    for name in ('desktop/installer.nsi', 'desktop/main.cjs', 'desktop/storage.cjs',
                 'desktop/Install AuTomato Windows.cmd',
                 'agent-harness/cli_anything/automato/utils/automato_backend.py',
                 'agent-harness/cli_anything/automato/automato_cli.py'):
        assert not re.search(r'(?i)(?<![a-z0-9_])[a-z]:[/\\]', (root / name).read_text(encoding='utf-8')), name


def test_data_folder_discovery_uses_saved_choice_and_explicit_override(monkeypatch, tmp_path):
    from cli_anything.automato.utils.automato_backend import data_root
    monkeypatch.delenv('AUTOMATO_DATA_DIR', raising=False)
    monkeypatch.setenv('AUTOMATO_CONFIG_DIR', str(tmp_path))
    assert data_root() == tmp_path
    chosen = tmp_path.parent / 'chosen-fixture'
    (tmp_path / 'storage-location.json').write_text(json.dumps({'dataDir': str(chosen)}))
    assert data_root() == chosen
    monkeypatch.setenv('AUTOMATO_DATA_DIR', str(tmp_path / 'override'))
    assert data_root() == tmp_path / 'override'


def test_start_can_launch_recovery_when_saved_folder_setting_is_damaged(monkeypatch, tmp_path):
    from cli_anything.automato.utils import automato_backend as backend
    monkeypatch.delenv('AUTOMATO_DATA_DIR', raising=False)
    monkeypatch.setenv('AUTOMATO_CONFIG_DIR', str(tmp_path))
    (tmp_path / 'storage-location.json').write_text('{invalid')
    executable = tmp_path / 'fixture.exe'
    executable.write_bytes(b'fixture only; never executed')
    monkeypatch.setenv('AUTOMATO_APP_EXECUTABLE', str(executable))
    calls = []
    def request(command):
        if not calls:
            raise RuntimeError('Storage setting needs recovery')
        return {'started': True}
    monkeypatch.setattr(backend, 'request', request)
    monkeypatch.setattr(backend.subprocess, 'Popen', lambda *args, **kwargs: calls.append(kwargs))
    monkeypatch.setattr(backend.time, 'sleep', lambda seconds: None)
    assert backend.start() == {'started': True}
    assert calls[0]['env']['TEMP'] == str(tmp_path / 'temp')


def test_invalid_storage_setting_shape_has_actionable_error(monkeypatch, tmp_path):
    import pytest
    from cli_anything.automato.utils.automato_backend import data_root
    monkeypatch.delenv('AUTOMATO_DATA_DIR', raising=False)
    monkeypatch.setenv('AUTOMATO_CONFIG_DIR', str(tmp_path))
    (tmp_path / 'storage-location.json').write_text('[]')
    with pytest.raises(RuntimeError, match='storage setting is invalid'):
        data_root()
