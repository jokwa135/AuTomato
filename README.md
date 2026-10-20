<img src="desktop/assets/automato.png" alt="AuTomato" width="100">

# AuTomato

A local desktop workspace for Higgsfield, Flow, Symphony, TikTok Studio,
CapCut Web and ClipScript. It displays the real websites in native Electron
views, with separate provider sessions, popup tabs, a shared asset shelf,
resizable panels and appearance controls.

The optional Python CLI lets agents inspect accessibility nodes, navigate,
click, type, attach files and capture the actual website. It connects over a
local named pipe on Windows or Unix socket on macOS. No cloud server or
provider API is required by AuTomato. Provider websites still require internet
and their own accounts.

## Install

Download the packages from this repository's Releases page.

- **Windows x64:** extract the Windows Installer ZIP and run
  `Install AuTomato Windows.cmd` with the setup EXE beside it. The installer
  suggests `%LOCALAPPDATA%\Programs\AuTomato` and lets you choose another
  writable folder on any drive. Open `Start AuTomato.cmd` in that folder after setup. Windows installation and the
  installed app's CLI were tested.
- **macOS:** extract the Mac Installer ZIP and open
  `Install AuTomato.command`. It detects Intel or Apple Silicon, downloads the
  matching official Electron runtime, verifies its published checksum and
  assembles `~/Applications/AuTomato.app`. **Actual Mac installation and
  execution remain unverified.** This is an installer script, not a tested DMG.

The release packages are unsigned by a commercial Windows certificate or Apple
Developer ID, and the Mac app is not notarized. The Mac script signs the app
locally on the target computer.

## Local data

First launch asks you to choose your data folder. **Settings → Storage** shows
the selected location and lets you change it. Choose an empty folder; AuTomato
restarts, copies sessions, assets, downloads and preferences, verifies copied
files and keeps the original workspace. Nothing is deleted from the original.

If a copy is interrupted, storage recovery lets you keep using the original
folder or choose another empty destination. Temporary problems can be retried;
conflicting destination files are preserved rather than overwritten. A damaged
location setting or unavailable drive opens recovery so you can select your
existing workspace or start separately in an empty folder. The previous setting
is backed up before saving a replacement.

Windows initially suggests `%LOCALAPPDATA%\AuTomato`; macOS suggests
`~/Library/Application Support/AuTomato`. A small location setting remains in
that default directory so the app and CLI can discover the selected workspace.
`AUTOMATO_DATA_DIR` explicitly overrides the saved choice and bypasses first
launch setup. Storage changes are disabled while that override is active.
`AUTOMATO_CONFIG_DIR` selects a separate location-setting directory for tests.
Application data and exports can use any writable drive, including the system drive.

When upgrading from a release that stored its location setting elsewhere, use
the first-launch picker to select your existing AuTomato workspace. It is opened
in place, with no copy or deletion. `AUTOMATO_CONFIG_DIR` can also point at an
existing configuration directory when launching both the app and CLI.

Each studio uses its own persistent browser session. Sign in inside AuTomato;
provider cookies and site data persist where the website permits. There is no
browser-cookie import, password import or built-in password vault. Existing
browser profiles are never read automatically. Authentication remains user
controlled, and providers can expire or revoke sessions.

This repository contains application source and bundled brand/provider icons.
It excludes browser profiles, personal files, downloaded media, imported assets,
cloud experiments, build output, logs, credentials and local automation state.
The ClipScript URL is a configured studio destination.

## Run from source

Use Node.js 22+ and npm. Clone into a folder of your choice. In the repository's
PowerShell terminal, keep dependency and Electron caches inside the checkout:

```powershell
$env:TEMP = $env:TMP = Join-Path $PWD '.tmp'
$env:npm_config_cache = Join-Path $PWD '.npm-cache'
$env:ELECTRON_CACHE = Join-Path $PWD '.electron-cache'
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
npm ci
npm start
```

Clear `ELECTRON_RUN_AS_NODE` first if your terminal sets it. `Start AuTomato.cmd`
uses a portable build when present, otherwise the local development Electron.

```powershell
npm run pack           # portable Windows app
npm run installer:win  # Windows setup EXE; build tools download into the repo cache
```

Installer output is under `dist/installers`. To assemble the Mac installer kit
after the Windows release build, point `AUTOMATO_BUILD_PYTHON` at Python 3.10+
and run `npm run installer:mac`. This produces the script/payload ZIP; it does
not cross-compile or validate a running Mac app. The Mac script downloads its
native runtime on the target Mac.

## Agent CLI

Python 3.10+ is required separately. Install `agent-harness` into a Python
environment on your chosen drive:

```text
python -m pip install --no-build-isolation -e ./agent-harness
cli-anything-automato --json start
cli-anything-automato --json switch flow
cli-anything-automato --json inspect --limit 150
cli-anything-automato --json storage
cli-anything-automato --json click REF
cli-anything-automato --json fill REF "Your text"
```

Use a ref from the latest inspection. `upload` attaches files and does not
submit them. Generation and posting are separate website actions. No arguments
starts the REPL; `--help` lists commands. Set `AUTOMATO_APP_ROOT` to this checkout
when running an installed CLI against a separate source folder, or use
`AUTOMATO_APP_EXECUTABLE` for a specific app binary.

See [CLI documentation](agent-harness/cli_anything/automato/README.md) and
[the agent skill](skills/cli-anything-automato/SKILL.md).

## Verification

```text
node --test desktop/tests/bridge.test.cjs desktop/tests/preferences.test.cjs desktop/tests/storage.test.cjs
```

For the CLI suite, install pytest into the chosen Python environment, select a
fresh `AUTOMATO_DATA_DIR` under the checkout's ignored `output` directory,
set `AUTOMATO_TEST_MODE=1` and `CLI_ANYTHING_FORCE_INSTALLED=1`, then start the
app using the installed CLI. Keep the fixture window visible while testing:

```text
python -m pytest agent-harness/cli_anything/automato/tests -v -s --tb=short -p no:cacheprovider
cli-anything-automato --json quit
```

The Windows update passed 22 CLI checks and 16 Node checks. The successful full
CLI run used the packaged Windows app launched through Playwright's Electron driver.
Standalone launch runs showed intermittent viewport/capture test failures in
this Windows environment; unattended GUI reliability is not fully verified.
These checks use local fixture pages; they do not verify provider sign-in,
generation or posting.
The real-control resize/appearance checks are exported from
`desktop/tests/resize.e2e.cjs` for a Playwright Electron launcher.
`desktop/tests/storage.e2e.cjs` exports `verifyStorage` to test first-launch
selection, cancellation, folder validation and restart migration using only
synthetic cookies and files in an isolated profile. It confirms the copied
session, assets and preferences and verifies the originals remain intact.
Its `verifyRecovery` export tests interrupted-copy recovery, damaged settings,
unavailable drives, setting backups and transfer retry against the source app
or a packaged Windows executable, using synthetic data only.

## License and contributions

AuTomato's original code is available under the [MIT License](LICENSE).
Third-party code, runtime components and provider branding retain their own
terms; see [third-party notices](THIRD_PARTY_NOTICES.md). License texts are also
included in the installer payloads.

See [contributions.md](contributions.md) for contributor credits and how to
contribute. Codex is credited for AI-assisted implementation and verification.
