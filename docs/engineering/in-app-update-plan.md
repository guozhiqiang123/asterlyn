# In-app update delivery plan

- **Status:** implemented in the current development revision
- **Updated:** 2026-10-12
- **Scope:** packaged Asterlyn desktop builds on macOS, Windows, and x86_64 Linux

## User contract

Asterlyn uses one application-update state machine for both entry points:

1. A packaged application performs one non-blocking check after its shell is ready. When a newer stable Release has a verified package for the current platform and architecture, Asterlyn opens a confirmation dialog. A failed background check remains silent outside Settings.
2. Settings → Updates can repeat the check, show the selected package and size, open the official Release page, or ask for confirmation before installing the available version.
3. After confirmation, Asterlyn downloads and verifies the package, starts the platform installer, exits, replaces the installed application, and attempts to reopen it. Installation errors remain visible and keep the Release page as the manual fallback.

Checks never block project opening. Drafts, prereleases, malformed versions, unsupported architectures, ambiguous assets, packages larger than 512 MiB, and non-official download URLs cannot become installable updates.

## Native trust boundary

The renderer cannot provide an installer URL, file path, command, version, or digest. It may only request `check_for_app_updates`, `install_app_update`, or ask the operating system to open an already allowlisted Asterlyn Release page.

The native update service independently reloads the latest stable Release immediately before installation and requires all of the following:

- the Release and asset URLs belong to `guozhiqiang123/asterlyn` on GitHub;
- exactly one asset matches the compiled operating system and architecture;
- the asset has a safe basename, a bounded non-zero size, and a GitHub SHA-256 digest;
- the downloaded byte count and locally calculated SHA-256 equal the Release metadata.

The download is written to an application-owned temporary update directory through a partial file. No repository content, Git configuration, project path, or renderer-provided data participates in installer command construction.

## Platform replacement

- **macOS:** mount the downloaded DMG read-only, verify the ad-hoc signature, stage `Asterlyn.app` next to the current bundle, wait for the current process to exit, swap with a rollback copy, verify again, then reopen the installed bundle.
- **Windows x86_64:** wait for `asterlyn.exe` to exit, run the official NSIS package silently, then reopen the installed executable path.
- **Linux x86_64 AppImage:** stage beside the current `APPIMAGE`, wait for exit, replace with a rollback copy, restore executable permissions, and reopen it.
- **Other Linux x86_64 installations:** select Debian or RPM from the package manager available on the host, request operating-system authorization through `pkexec`, install the matching package, and reopen Asterlyn. Unsupported platforms remain manual-only.

## Explicit limitations

The current zero-cost Release policy still publishes an unsigned Windows installer and an ad-hoc-signed, unnotarized macOS application. SHA-256 protects package integrity between Release metadata and the local file; it does not add an independent signing authority if the GitHub repository itself is compromised. Operating-system warnings and authorization prompts remain expected and must not be bypassed.

There is no automatic background installation, downgrade, prerelease channel, differential patch, retry after an uncertain installer outcome, or application-data rollback. The macOS/Linux replacement scripts retain a local application backup only for the bounded file swap and remove it after a verified successful replacement.

## Acceptance gates

- protocol validation rejects incoherent installability or malformed installation results;
- controller tests cover startup prompting, manual checks, confirmation, installation failure, and duplicate-operation suppression;
- Rust tests cover version comparison, platform asset selection, URL/name/digest validation, and platform-script construction;
- `npm run check`, `npm run build`, focused script tests, Rust formatting, and the `asterlyn` library tests pass;
- release documentation and workflow tests continue to prove exact platform artifacts and SHA-256 publication.

The implementation and current automated evidence are recorded in [`../benchmarks/2026-10-12-in-app-update.md`](../benchmarks/2026-10-12-in-app-update.md).
