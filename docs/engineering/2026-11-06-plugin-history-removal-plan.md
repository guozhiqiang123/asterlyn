# Plugin history package removal

Add an explicit per-version Delete action to Installed plugin settings. Users choose historical packages to remove; no automatic deletion or change to enablement, settings, workspace trust or project files.

Protect active, pending and current known-good recovery selections, pending/active runtime states, the final retained version, and exact packages still used by any window's plugin or language process. Native policy is authoritative; the UI presents disabled actions and requires an exact-version confirmation. Deleting history never requests a restart.

Delete the immutable marketplace version directory (extracted content and archive) using a staged rename, commit the exact id/version/digest index mutation, then reclaim the staged directory. Restore staging if index mutation fails. Startup cleanup restores pre-commit tombstones still referenced by the index and removes post-commit debris, never following symlinks. Disk-cleanup errors are reported and retried by existing startup cleanup. Dependency selection must remain valid when cleanup changes it; unchanged selections can still clean history while an existing runtime failure has degraded the dependency graph. Keep the host's bundled resources untouched.

Implement domain/index policy, guarded native disk transaction and crash recovery, typed desktop command, localized settings controls, and demo parity. Add focused policy/identity/dependency, filesystem/failure/recovery/symlink, and UI confirmation tests. Verify check/build/script gates, Rust tests/Clippy, and native log/rendered acceptance using disposable fixture packages. Do not delete the user's real historical packages during validation. Follow canonical signed packaging/Contents-only installation and two icon-bookmark reopen checks. Record acceptance below before completion.

## Acceptance — 2026-11-06

- User manual acceptance passed; approved for local commit on 2026-11-06.
- Implemented host-owned Delete actions with localized exact-version confirmation and cancellation; current/pending/recovery/final versions are disabled. A successful removal needs no restart and retains enablement, plugin settings, execution consent and project files.
- Domain/dependency tests pass (26 marketplace unit tests, 5 dependency tests and 5 marketplace integration tests), including unchanged selection during crash recovery. Both runtime-use guard tests and four native filesystem tests pass: actual archive/extraction reclamation, failed-index restoration, startup tombstone recovery and symlink boundaries.
- `npm run check`, all 1,467 script tests, production build and strict workspace Clippy pass. Portable language-service gates pass (61 core, 3 process, 44 actor/recovery, 5 workspace-symbol tests, plus native binding verification).
- Chromium and WebKit rendered checks pass at 700/1100 px: exact confirmation/cancellation, protected current version, post-delete row removal, no horizontal overflow and no new restart banner. Host typography is retained. Controls use native button semantics, disabled protection, alert confirmation and cancellation focus.
- File reclamation runs on a blocking worker after releasing marketplace/activation/session locks, so recursive disk cleanup does not block the UI or retain a full package copy in memory. No comparative latency/memory benchmark is claimed; the installed process observation is retained in `final/installed-process.txt`.
- Native macOS arm64 build uses Node 24.19.0 and Rust 1.98.1. Complete ad-hoc signature and strict verification pass. The canonical installer preserved `/Applications/Asterlyn.app` identity and verified executable equality, then completed two icon-bookmark launches with persisted frontend readiness. No real user history package was deleted during validation.
- Windows/Linux native execution is not validated on this macOS host. If post-commit disk removal fails, the UI reports the error and startup retries the tombstone; there is no automatic history purge.

Local evidence directory: `/Users/gzq/PrivateProjects/asterlyn/.artifacts/plugin-history-mozvrx2k/`.

Accepted archive: `/Users/gzq/PrivateProjects/asterlyn/.artifacts/plugin-history-mozvrx2k/final/Asterlyn-history-removal.app.zip`; **25,723,941 bytes**; SHA-256 `9c5dfcd71af4ba6f354c1699cd3d5dc8b3fb86f0b2bd0da73c40ed2466c07a82`.

Installed executable SHA-256: `4886b380c99f9ea5fe989d65c6a604280fdd5d2c60a12a2daa8efb2dc8e2c117`. Build identity: `8172658abee60cb5bfbd95303a4552714ee34720-dirty-1793931885510`. Installation receipt: `final/installed.json`; signature/archive receipts: `final/signature.log`, `final/accepted-build.json`.
