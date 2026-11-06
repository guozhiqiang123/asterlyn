# Editor content context menus

The source editor owns a selection-aware context menu, presented through the existing window menu host. With selected text show Cut, Copy, Paste and Find in Files; without a selection show Paste, Reveal in File Manager and Show History. Show Diff and Rollback appear only for a changed file. Git Blame gutter menus remain independent.

Capture tab/load identity, workspace generation, document and selection before transferring focus. Revalidate before actions and after asynchronous clipboard access, and invalidate on editor changes or disposal. Clipboard edits use normal undoable CodeMirror transactions and retain exact file serialization. Read-only sources keep Copy/Find available and block editing. Native clipboard access is text-only, bounded and invoked only by an explicit action; no clipboard or source contents are logged.

Reuse authorized reveal, file-scoped History, working Diff and reviewed Git restore. Unsaved content is included in change visibility: a dirty tracked source compares its current buffer to HEAD without writing; unsaved-only Rollback confirms and restores the saved buffer as an undoable edit. Existing Git restore safety still requires saving unsaved content before discarding disk changes. Untracked/ignored/read-only or unsupported repository operations explain their unavailable state.

Verify menu models, selected text transfer, failures and late completions, multi-range/UTF-16 edits, read-only/stale identities, exact repository routing, changed-only actions and gutter isolation. Exercise actual CodeMirror/menu integration under Chromium and WebKit; run project check/build/script gates and relevant Rust checks. Finish with a signed native package, canonical overwrite installation and two icon-bookmark starts. Keep changes uncommitted until manual acceptance.

## Acceptance — 2026-11-06

- Both requested menu sets are implemented with English/Chinese labels and existing host menu styling. Clean sources hide Diff/Rollback. Selected text seeds workspace Text search; reveal and History use exact workspace/repository paths, including nested repositories and renamed paths. Staged additions retain the existing reviewed restore route.
- Source menus capture tab/load/workspace/document/selection identity. Cut writes before removing text; failed writes preserve content. Late cut/paste cannot edit another selection or a recycled view. Read-only documents expose Copy/Find and block Cut/Paste. Empty or non-text clipboard contents give feedback. Unsaved-only rollback confirms and restores the saved buffer without changing disk; existing dirty-disk restore remains guarded by the normal save-first policy.
- Type checking and production build pass. All **1,478 script tests** pass, including 11 focused menu/file-policy tests. Strict workspace Clippy and the native clipboard byte-limit/Unicode/line-ending test pass. Clipboard results/writes are limited to 16 MiB, use a blocking worker and contain no payload logging; tests did not overwrite the user's system clipboard.
- Chromium and WebKit tests exercise actual right-click menus, Copy/Cut/Paste/Find, multiple ranges, Unicode/CRLF/BOM preservation through undo, empty vs changed file action sets, exact action routing, rejected paste after same-view tab reuse, clipboard failures, read-only protection, Shift+F10/Escape focus/selection return, and unchanged Git Blame gutter ownership. Screenshots use the actual shared menu/layout/controls styles. No product font or theme styles were changed.
- No extra persistent editor view, polling loop or document cache was added. Menu state lives only for its interaction; selected text is read on demand. No comparative latency/memory benchmark is claimed. The installed process RSS observation is retained in `installed-process.txt`.
- Native macOS arm64 package uses Node 24.19.0 / Rust 1.98.1. Complete ad-hoc signing, strict sealed-bundle verification and ZIP CRC pass. Canonical Contents-only installation preserves `/Applications/Asterlyn.app` identity, confirms executable equality, and records frontend readiness after both icon-bookmark starts.
- Scope: source text and Markdown source editors, including read-only source previews; existing Diff/conflict-specific menus are unchanged. Windows/Linux native clipboard execution is not validated on this macOS host. New native clipboard commands are shell capabilities, not plugin capabilities. Manual acceptance is recorded in the corrected verification below.

Evidence directory: `/Users/gzq/PrivateProjects/asterlyn/.artifacts/editor-context-2m4yt1md/`.

Accepted archive: `/Users/gzq/PrivateProjects/asterlyn/.artifacts/editor-context-2m4yt1md/Asterlyn-editor-context.app.zip`; **25,783,740 bytes**; SHA-256 `165796742691912c117305a05279df14a7127bca031ea1938843bc6d7539fa2a`.

Installed executable SHA-256: `6b942aea092a94a9edc7a3c017e59314921d136e5edf5f2ddcc6eaf332ff6738`; build identity `978e083732444ee1b310f19cbc594b1794810d2a-dirty-1793933483225`. `installed.json` records both successful icon-bookmark sessions and preserved root identity; `signature.log` and `accepted-build.json` record package verification.

## Native right-click regression and correction

User acceptance found that source right-click did nothing in the installed client despite its
executable matching the accepted package. Native reproduction in FilesRecovery/MainActivity.kt
confirmed the failure. The application uses `LazyContextMenuHost`, whose document-capture listener
prevents the system context menu. The new source provider incorrectly treated `defaultPrevented`
as evidence that a feature had consumed the event. Earlier rendered tests instantiated the eager
host directly, omitting this production boundary; startup readiness did not validate menu behavior.

The host now prevents the system fallback during bubbling, after feature handlers and CodeMirror
observers have processed the event. Providers still honor explicitly consumed events, including
language navigation. This also preserves CodeMirror's context-selection bookkeeping for read-only
sources, without special-case editor workarounds. The rendered fixture uses the exact lazy host and
checks both feature-consumed events and native fallback suppression. The language navigation fixture
also uses the production lazy host. `lazy-host-before-fix.log` records the failing regression;
`lazy-host-fixed/` records the corrected production-host, clipboard, same-view, read-only and gutter
checks. The first package receipt above is historical and is superseded by the corrected receipt
below after native menu acceptance.

The production-host regression also exposed native read-only selection collapse when an overlay
takes focus. Menu liveness now checks immutable document identity while focus belongs to the menu;
closing restores the captured selection before invoking an action. Actual edits and asynchronous
clipboard completions still require an exact document and selection match, so target switches remain
rejected. This is tested in the real lazy-host fixture, rather than bypassing the selection contract.

### Corrected package verification

- User manual acceptance passed and local commit was approved on 2026-11-06.
- Type checking and all **1,479 script tests** pass, including exact-selection execution after menu focus transfer.
- The production lazy-host rendered tests pass in Chromium/WebKit, including read-only Copy, consumed-gesture arbitration, fallback native-menu suppression, clipboard edits/undo and same-view target switching.
- The language definition/reference fixture also uses the production lazy host. Real Ctrl/Command navigation and the searchable reference picker pass in both engines. Local feedback-frame p95 is 7.4 ms (Chromium) / 16 ms (WebKit); response-to-result-frame p95 is 14.8 / 14 ms. Chromium's 20-cycle heap sample delta is 195,496 bytes; this is a fixture observation, not a real-project performance guarantee.
- Strict bundle signing, ZIP integrity and canonical installation pass; the installed executable matches the corrected artifact. Both icon-bookmark starts record frontend readiness and the installed app's root identity is preserved.
- macOS initially locked before interactive native acceptance. After user unlock, actual right-button clicks in installed FilesRecovery/MainActivity.kt exposed the exact three-item caret menu and four-item selection menu. Escape dismissed the menu and preserved the selected `class` text; the source remained Saved. `right-click-recovery/native-menu-acceptance.json` records the observations and running build identity. No clipboard write or source edit was performed.

Corrected archive: `/Users/gzq/PrivateProjects/asterlyn/.artifacts/editor-context-2m4yt1md/right-click-recovery/Asterlyn-editor-context-fixed.app.zip`; **25,783,460 bytes**; SHA-256 `ef0062db38f7e62f11bb4580bf3435c004a564e5f0e4aa2e4cce5a7b56050df6`.

Corrected executable SHA-256: `70452517282473844323433351e22539466c7702d9336ffb09ae0cc4af59bec8`; build identity `978e083732444ee1b310f19cbc594b1794810d2a-dirty-1793936800167`. Corrected receipts live under `right-click-recovery/`; they supersede the original package receipt.
