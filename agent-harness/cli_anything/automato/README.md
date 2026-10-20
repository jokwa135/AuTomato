# AuTomato CLI

Control the real local AuTomato desktop app with structured JSON and live
accessibility references. This harness does not emulate provider APIs.

## Storage

Choose a data folder on first launch, or use Settings > Storage to copy your
workspace to a new empty folder. The original is preserved. The CLI follows
the saved location automatically; `cli-anything-automato --json storage` reports
it. An explicit AUTOMATO_DATA_DIR overrides the saved choice.

## Commands

```powershell
cli-anything-automato --json start
cli-anything-automato --json switch flow
cli-anything-automato --json inspect --limit 150
```

Use refs returned by that inspection:

```text
cli-anything-automato click REF
cli-anything-automato fill REF "text"
cli-anything-automato upload REF ./reference.png
cli-anything-automato scroll 600
cli-anything-automato tabs list
cli-anything-automato panels --sidebar hide --bottom hide
cli-anything-automato panels --sidebar-width 320 --bottom-height 190 --studios-height 70
cli-anything-automato appearance --mode dark --theme everforest
cli-anything-automato preview capture
```

`status`, `studios`, `page`, `assets`, `screenshot`, `preview`, and `quit` have
`--help`. No arguments starts the interactive REPL. `--dry-run` suppresses
actions. Reinspect after navigation or another inspection because refs expire.
Inspect a listed frame with `inspect --frame FRAME_ID` for embedded controls.
Hidden file inputs in the main page are listed with `role: fileinput`; use their
refs with `upload`, without clicking the hidden element.
`upload` selects local files in an existing file input; submitting remains a
separate action. The shelf attach button supports pages with one file input;
use an inspected ref where several inputs exist.

Install the CLI into your own Python environment. The source checkout includes
`Start AuTomato.cmd` to launch the app.
The Windows installer suggests `%LOCALAPPDATA%\Programs\AuTomato`; the CLI reads
the registered installation location, including custom folders, when starting
a new app session. `AUTOMATO_APP_EXECUTABLE` selects a specific
executable for testing. On Mac it discovers `~/Applications/AuTomato.app` and
`/Applications/AuTomato.app`. The Mac installer ZIP includes this Python harness.
Application data, persistent separate provider sessions, assets, downloads and
previews use `%LOCALAPPDATA%\AuTomato` by default on Windows. Override `AUTOMATO_DATA_DIR` to
target an isolated instance. Override `AUTOMATO_APP_ROOT` if the app is moved.
Keep the entire `win-unpacked` directory with the executable.

Drag the shelf's right edge, prompt panel's top edge or studio bar's bottom edge
to resize. Double-click a handle to reset it; focused handles support arrow keys
(Shift for one-pixel adjustments). Sizes and collapse settings persist together.
Appearance is available in the title bar, with theme presets, System/Light/Dark
modes, custom hex colors and fonts. It changes the app shell, leaving provider
websites' own appearance controls available. Preferences stay in the selected data folder.

## Rebuild and installation

The existing project uses Node, Electron 39.2.7 and electron-builder 26.0.12.
`node desktop/build-local.cjs` builds the portable Windows folder from local
Electron files, with build caches inside the checkout. Python 3.10+ and Click 8.1+ are needed
for the harness. Install editable into your chosen Python environment:

```powershell
python -m pip install --no-build-isolation -e ./agent-harness
```

Set UV_CACHE_DIR, TEMP and TMP if you want to customize installation caches. See
the repository README's verification instructions for real application validation. Tests require an app launched
with `AUTOMATO_TEST_MODE=1` and a separate `AUTOMATO_DATA_DIR`; they exercise
local fixture pages without provider submissions.

Website screenshots use Electron's native `capturePage`. `--shell` captures only
the shell and excludes native child website views. Preview bundles contain a
real native website PNG, its dimensions and a SHA-256 fingerprint.

Windows is tested. macOS packaging and provider sign-in are not yet verified.
