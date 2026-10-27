# Plugin dependency/model foundation local delivery

Date: 2026-10-27. This evidence closes the delivered C1 enablement dependency and records C2a/C3a foundations; it does not close Android LSP semantics.

## Commits

- Host documentation: `6b7df57`; required dependency lifecycle/SDK: `03a7a5f`; model metadata kernel: `2f9e3ad`; health-aware startup acceptance: `17ce03f`; final native enablement projection/session cleanup: `f19ba2c`.
- LSP documentation: `2141ba0`; package 0.2.1 dependency declaration: `c3afed5`.
- Android documentation: `cff4e79`; model contract and real AGP development probe: `73db9e7`.
- Local commits only; no push, tag or remote release.

## Validation

- `npm run check`, frontend build and native Tauri app build passed. All script tests: 1,344 passed.
- Native library: 163 passed, 3 existing ignored. Actual TS/Rust independent actor/session test explicitly passed against the host source workspace (37.45 s), using the real 0.2.1 server resources.
- Dependency kernel 5, installation library 22 plus 5 integration, package admission 15, model-job kernel 8 tests passed. Relevant Rust all-target Clippy with `-D warnings` passed.
- Android plugin check/build and 67 tests passed; LSP plugin check/build, 5 tests, archive packaging/inspection passed. SDK 1.13.0 exact vendor bytes verified by the repository suite.
- Required-provider disable/uninstall and incompatible selection are rejected; enabled inactive/quarantined consumers retain the lock; closing consumers releases it. Missing dependencies/cycles never partially publish. Cross-window enablement and management status use the native store.
- Final native store: LSP 0.2.1 and Android Gradle 0.5.10 are enabled/known-good, no pending selection. LSP's persisted dependency floor is >=0.5.10, <1.0.0.
- Frontend registration alone was an insufficient first probe: it killed the new plugin before its health checkpoint and caused quarantine/fallback. The exact package was reverified through archive/content/receipt checks and repaired through the native store API with the app stopped. The new repository acceptance probe waits for actual native known-good state and passed. No JSON health flags were edited manually.

## Signed artifact

Accepted source revision: `f19ba2ca76fb7d9b0725ff53b56ab3e35ff1750f`, clean build. App version remains 0.1.21; bundled LSP is 0.2.1.

- Archive: `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.21-macos.app.zip`
- Bytes: 20,065,578
- SHA-256: `6634d6dd5e69166a6ee9b54e9ff50ddcb00c23d6aa73df2d9ca99d6e06907a8f`
- Installed executable SHA-256: `a768ebb704f46c3149dcc4cb171ff1010eccd73d996af99b801e1be15a0b18e9`

The whole bundle was ad-hoc signed after bundling. Strict deep verification passed with `Identifier=dev.asterlyn.desktop`, `Signature=adhoc`, and `Sealed Resources version=2 rules=13 files=6`. Installed signature and executable digest were rechecked. This is a local, unnotarized macOS artifact, not cross-platform or published Release acceptance.

Installer preserved `/Applications/Asterlyn.app` inode `203606126` and exchanged only Contents. The previous installation is retained as a verified ZIP:
`/Users/gzq/Library/Application Support/Asterlyn/archived-install-backups/Asterlyn-1793072503267-40f6e16c-7392-4430-af3d-1d9c736ea93e.app.zip`
SHA-256 `8a7f8328529b8e58c4c593a39367d5a1e63fdac3899fa3cc7472552b4e6a1e4d`. Launchpad kept item 145; 89 unrelated entries were preserved. No expanded application backup was created.

| Check | PID | Log session | Result |
| --- | ---: | --- | --- |
| First icon launch | 77406 | `session-1793072508711-77406-0` | frontend ready |
| Quit then icon reopen | 77502 | `session-1793072510885-77502-0` | frontend ready |

Exact-plugin/source-project smoke: `session-1793072417651-76926-0`, build `f19ba2ca76fb7d9b0725ff53b56ab3e35ff1750f-clean-1793072324372`. Frontend ready and LSP 0.2.1 native health checkpoint confirmed. The two pre-existing `existing_project_directories` invalidPath command failures remain; no plugin/language failure was observed in this run.

One restored-session RSS sample: root 88,976 KiB, reachable tree 95,120 KiB across 2 processes. It is not a peak, PSS or cold/warm distribution, and may exclude OS-reparented WebKit processes. Model-kernel-only resource data and the actual AGP probe are recorded separately. The owned probe Gradle daemon was sampled at 34,400 KiB idle RSS, then stopped by its exact owned PID; its detached worktree was removed and the original boostCleaner tracked state remained clean. JVM/model extraction peak memory remains unmeasured.

Toolchain: rustc=rustc 1.97.1 (8bab26f4f 2026-07-14), cargo=cargo 1.97.1 (c980f4866 2026-06-30), node=v26.8.1, macOS=15.6.1, arch=arm64.

## Remaining gates

C2b/C2c supervised auxiliary execution, sealed disk artifacts and SDK model service transport are not connected. C3a proves a single real AGP module model; dependency variants, composite builds, generated sources and full cancellation cleanup remain. C4 Java/Kotlin/Groovy backend consumption and mixed unsaved overlays have not passed acceptance. No Android profile is advertised. Kotlin distribution/adoption terms remain unresolved. The host contains no new JVM/AGP/JDT distribution; the model kernel is currently a separately tested foundation outside the application startup path. UI reason/disabled/accessible-description semantics are covered automatically; no new native screen-reader manual acceptance was performed.
