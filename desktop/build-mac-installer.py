"""Bundle a native-on-Mac installer without cross-compiling Electron."""
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'dist/installers/build/win-unpacked/resources'
OUTPUT = ROOT / 'dist/installers/AuTomato-0.3.2-Mac-Installer.zip'


def add(archive, name, data, executable=False):
    info = zipfile.ZipInfo('AuTomato Mac Installer/' + name)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data)


with zipfile.ZipFile(OUTPUT, 'w') as archive:
    script = (ROOT / 'desktop/Install AuTomato.command').read_text(encoding='utf-8').replace('\r\n', '\n')
    add(archive, 'Install AuTomato.command', script.encode('utf-8'), executable=True)
    add(archive, 'payload/app.asar', (BUILD / 'app.asar').read_bytes())
    add(archive, 'payload/automato.icns', (ROOT / 'desktop/assets/installer-icons/icon.icns').read_bytes())
    for name in ('LICENSE', 'THIRD_PARTY_NOTICES.md'):
        add(archive, 'payload/' + name, (BUILD / name).read_bytes())
    for file in (BUILD / 'licenses').rglob('*'):
        if file.is_file():
            add(archive, 'payload/licenses/' + file.relative_to(BUILD / 'licenses').as_posix(), file.read_bytes())
    for file in (BUILD / 'cli-anything').rglob('*'):
        if file.is_file():
            add(archive, 'payload/cli-anything/' + file.relative_to(BUILD / 'cli-anything').as_posix(), file.read_bytes())
    readme = """AuTomato for Mac, 0.3.2

1. Extract this ZIP. Keep the payload folder beside Install AuTomato.command.
2. Close an existing AuTomato instance before installing an update.
3. Open Install AuTomato.command on your Mac. It detects Apple Silicon or Intel,
   downloads Electron 39.2.7 from its official GitHub release, verifies the
   published SHA-256 checksum, assembles AuTomato.app and signs it locally.
4. The app is installed in ~/Applications/AuTomato.app and then opened.

The installer requires internet. It uses macOS-provided curl, ditto, PlistBuddy
and codesign. It needs no paid hosting, developer account or new subscription.
Existing app bundles are moved to a dated backup before replacement. Choose
your data folder on first launch, or change it later in Settings > Storage.
The suggested location is ~/Library/Application Support/AuTomato. Folder changes
copy the workspace after restart and preserve the original.
Installer downloads/staging use ~/Library/Caches/AuTomato-Installer.

This installer was prepared on Windows. Its script syntax, ZIP structure and
payload were checked, but actual installation and website sign-in must be
tested on a Mac. It is not Apple Developer ID signed or notarized. If macOS
blocks the downloaded installer, use its normal Privacy & Security approval
for software you choose to trust. No security setting is changed by the script.

Optional CLI: Python 3.10+ and Click are required. The CLI harness source is in
AuTomato.app/Contents/Resources/cli-anything. Install it into your chosen Python
environment. The CLI discovers ~/Applications/AuTomato.app automatically.
"""
    add(archive, 'READ ME.txt', readme.encode('utf-8'))
print(OUTPUT)
