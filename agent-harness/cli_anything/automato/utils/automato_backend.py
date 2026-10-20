"""Talk to the actual Electron app through its local OS pipe/socket."""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path


def local_app_data():
    return Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData/Local'))


def configuration_root():
    if sys.platform == 'win32':
        default = local_app_data() / 'AuTomato'
    elif sys.platform == 'darwin':
        default = Path.home() / 'Library/Application Support/AuTomato'
    else:
        default = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'AuTomato'
    return Path(os.environ.get('AUTOMATO_CONFIG_DIR', default))


def data_root():
    if os.environ.get('AUTOMATO_DATA_DIR'):
        return Path(os.environ['AUTOMATO_DATA_DIR'])
    setting = configuration_root() / 'storage-location.json'
    if setting.exists():
        try:
            saved = json.loads(setting.read_text(encoding='utf-8'))
            if not isinstance(saved, dict):
                raise ValueError('Invalid storage setting')
            selected = saved.get('dataDir')
            if not isinstance(selected, str) or not Path(selected).is_absolute():
                raise ValueError('Invalid data folder')
            return Path(selected)
        except (OSError, ValueError, TypeError) as error:
            raise RuntimeError('AuTomato storage setting is invalid. Open the app to check its data folder.') from error
    return configuration_root()


def request(command, args=None):
    discovery = data_root() / 'bridge.json'
    try:
        endpoint = json.loads(discovery.read_text(encoding='utf-8'))['endpoint']
        payload = (json.dumps({'command': command, 'args': args or {}}, ensure_ascii=False) + '\n').encode('utf-8')
        if os.name == 'nt':
            # Windows named pipes are file handles, not network ports.
            with open(endpoint, 'r+b', buffering=0) as pipe:
                pipe.write(payload)
                chunks = bytearray()
                while not chunks.endswith(b'\n'):
                    chunk = pipe.read(65536)
                    if not chunk:
                        raise RuntimeError('AuTomato closed the connection')
                    chunks.extend(chunk)
        else:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(20)
                client.connect(endpoint)
                client.sendall(payload)
                chunks = bytearray()
                while not chunks.endswith(b'\n'):
                    chunk = client.recv(65536)
                    if not chunk:
                        raise RuntimeError('AuTomato closed the connection')
                    chunks.extend(chunk)
        response = json.loads(chunks)
    except (OSError, KeyError, json.JSONDecodeError) as error:
        raise RuntimeError('AuTomato is not reachable. Run cli-anything-automato start first.') from error
    if not response.get('ok'):
        raise RuntimeError(response.get('error', 'AuTomato command failed'))
    return response['result']


def windows_install_location():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato') as key:
            value = winreg.QueryValueEx(key, 'InstallLocation')[0]
            return Path(value) if isinstance(value, str) and Path(value).is_absolute() else None
    except (ImportError, OSError):
        return None


def app_candidates(root, platform=None):
    platform = platform or sys.platform
    if platform == 'darwin':
        return [Path.home() / 'Applications/AuTomato.app/Contents/MacOS/AuTomato',
                Path('/Applications/AuTomato.app/Contents/MacOS/AuTomato'),
                root / 'dist/installers/build/mac-arm64/AuTomato.app/Contents/MacOS/AuTomato',
                root / 'dist/installers/build/mac/AuTomato.app/Contents/MacOS/AuTomato']
    installed = windows_install_location()
    return ([installed / 'AuTomato.exe'] if installed else []) + ([root.parent / 'AuTomato.exe'] if root.name.lower() == 'resources' else []) + [local_app_data() / 'Programs/AuTomato/AuTomato.exe', root / 'dist/automato/win-unpacked/AuTomato.exe']


def start():
    try:
        return request('status')
    except RuntimeError:
        pass
    root = Path(os.environ.get('AUTOMATO_APP_ROOT', Path(__file__).resolve().parents[4]))
    explicit = os.environ.get('AUTOMATO_APP_EXECUTABLE')
    packaged = next((file for file in ([Path(explicit)] if explicit else app_candidates(root)) if file.is_file()), None)
    dev = root / ('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' if sys.platform == 'darwin' else 'node_modules/electron/dist/electron.exe')
    executable = packaged or dev
    args = [str(executable)]
    if packaged is None:
        args.append(str(root / 'desktop/main.cjs'))
    if not executable.exists():
        raise RuntimeError('AuTomato executable not found. Set AUTOMATO_APP_ROOT to the local app folder.')
    env = os.environ.copy()
    env.pop('ELECTRON_RUN_AS_NODE', None)
    # A damaged/unavailable selected folder must not stop the recovery UI launching.
    env['TEMP'] = env['TMP'] = str(configuration_root() / 'temp')
    Path(env['TEMP']).mkdir(parents=True, exist_ok=True)
    with open(os.devnull, 'wb') as quiet:
        subprocess.Popen(args, env=env, stdout=quiet, stderr=quiet, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    for _ in range(100):
        time.sleep(0.2)
        try:
            return request('status')
        except RuntimeError:
            continue
    raise RuntimeError('AuTomato is still starting. Complete storage setup or recovery in the app, or wait for a workspace copy to finish, then retry.')
