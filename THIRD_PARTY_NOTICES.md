# Third-party notices

The root MIT License covers original AuTomato code. It does not replace the
licenses of the components below or grant rights to third-party trademarks.

| Component | Use | License and notice |
| --- | --- | --- |
| Electron 39.2.7 | Desktop runtime | MIT; `licenses/Electron.txt`. Runtime distributions also include `LICENSE.electron.txt`. |
| Chromium, Node.js and Electron's bundled dependencies | Runtime components | Their notices are shipped in Electron's `LICENSES.chromium.html` and runtime license files. Keep those files with the distributed runtime. |
| HKUDS/CLI-Anything | Adapted `agent-harness/cli_anything/automato/utils/repl_skin.py` | Apache-2.0; `agent-harness/cli_anything/automato/licenses/CLI-Anything.txt`. Copyright 2026 HKUDS CLI-Anything Team. The AuTomato adaptation is marked in the source. Upstream: https://github.com/HKUDS/CLI-Anything. |
| Click | Optional Python CLI dependency, installed separately | BSD-3-Clause; `licenses/Click.txt`. Its own installed distribution retains its notices. |
| electron-builder | Build tooling | MIT; `licenses/electron-builder.txt`. Build dependencies are declared in the npm lockfile and are not included as an npm installation in the app. |
| NSIS 3.0.4.1 | Windows installer engine and plugins | NSIS's zlib/libpng terms and component-specific terms, including its LZMA compression module, are reproduced in `licenses/NSIS.txt`. Upstream source: https://nsis.sourceforge.io/Download. |

The optional Python harness includes the AuTomato MIT and CLI-Anything
Apache-2.0 texts in its `licenses` package directory. Desktop installers include
this notice and the license directory under the application's `resources`
directory (`Contents/Resources` on macOS). The Mac installer retains the native
Electron runtime's license files when assembling the app.

Higgsfield, Google Flow, Symphony/Seedance, TikTok, CapCut and ClipScript names
and logos identify the linked studios. Those marks and artwork retain their
respective owners' rights and are not relicensed under AuTomato's MIT License.
AuTomato does not claim affiliation with or endorsement by those providers.
