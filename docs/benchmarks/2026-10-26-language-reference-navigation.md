# Definition and reference selection — 2026-10-26

The [plan](../engineering/2026-10-26-language-reference-navigation-plan.md) was committed as
`1f4d58a` before code. This extends the previous definition-only workflow with real references,
while preserving the independently admitted TS/JS plugin package and execution approval.

## Interaction and scope

- Ctrl/Command-click or F12 from a use opens a single definition. Several definitions require
  choosing. If the definition is exactly the current word's range, query its references rather
  than jumping to itself. A broad enclosing function/body range does not trigger this fallback.
- One use from declaration navigation opens directly; multiple uses open the chooser. Shift+F12
  and Alt+F7 (Option+F7 on macOS) explicitly open reference choices, including a singleton.
- The location picker shows file name, path, line/column and count. File/path filtering is local;
  Up/Down/Home/End, Enter, mouse selection, Escape/source focus and outside dismissal are supported.
  It uses dialog, combobox, listbox/option and live status semantics. The layout remains inside
  the viewport and the result list scrolls. There is no automatic first-result choice.
- Definitions retain the sixteen-choice bound. References scan/retain at most 512 positions, with
  an explicit partial-result indicator. No source previews or arbitrary file reads are performed.
  Results still open only through the guarded authoritative workspace catalog route.

Android Studio and VS Code both distinguish declarations from usages and present choices for
ambiguous targets. Their shortcuts/window forms differ; this is a shared behavior contract,
not a claim to reproduce VS Code's inline editable Peek or Android Studio's full Find Usages tool.
Official sources are linked in the plan. Rust, external-library browsing, Diff/history/conflict
overlays, references paging beyond the bound and location history remain outside this iteration.

## Verification

- Complete script suite: 1320 pass, concurrency four. Eleven focused navigation tests cover
  URI/range/surrogate validation, exact-self detection, 512 reference bounds, existing dirty target,
  active-tab/workspace and competing-open races. Client tests verify current overlays flush before
  references and caller-supplied arbitrary method/context/command payloads cannot reach native.
- Typecheck, production frontend build, original language editor rendering, Rust formatting and
  strict all-target Clippy for `asterlyn` and `asterlyn-language-service` pass.
- Chromium and WebKit execute real Ctrl/Command-click, F12/Shift+F12/Alt+F7, selection and filtering.
  They cover declaration → multiple references, single/empty references, all 512 retained choices,
  clipping feedback, viewport bounds, keyboard/mouse selection, Escape and stale second-stage
  reference responses after edits/tab changes/new queries/disposal. All previous definition and
  dirty-buffer acceptance remains in the same suite.
- The actual native actor resolves a declaration's single use and asserts the declaration itself
  is excluded. The host constructs only `textDocument/references` with `includeDeclaration: false`;
  owner/session/version/position/cancellation guards and request deadlines are unchanged. Actual
  actor acceptance including diagnostics/cleanup took about 0.91 seconds locally.
- Real Asterlyn source: `app.ts` call → exact declaration → cross-file references containing that
  same call. Diagnostics/hover/completion checks remain enabled. The whole real-project acceptance
  took about 2.14 seconds; source bytes are asserted unchanged afterward.

## Resource evidence

One final local run took 4.47 seconds in Chromium and 4.70 seconds in WebKit for the full interaction
suite, including twenty additional navigation/picker cycles per engine. Chromium retained JS heap
increased 220,188 bytes after GC over those cycles. Other runs under compilation load were slower;
these fixture samples do not establish a per-click production latency or aggregate memory ceiling.
Each popup is bounded, issues no requests while filtering and releases external listeners/DOM on
close. Request logs carry kind/outcome/count only; paths, symbols and source content are excluded.

## Native delivery

Clean source `5775daf360e60ca3a0451d067e8b2d1791d69b8a` was freshly built and whole-bundle ad-hoc
signed. Strict verification confirms `dev.asterlyn.desktop`, sealed resources version 2 and app
version 0.1.20. Actual-project native startup and installed logs confirm one healthy LSP contribution
and one language provider. Canonical replacement preserves the application root, retains the old
installation as a verified ZIP and verifies the installed executable against the accepted source.
Initial saved-icon launch and quit/reopen both record frontend readiness with the same build.
[Machine-readable evidence](2026-10-26-language-reference-install.json).

Build ID: `5775daf360e60ca3a0451d067e8b2d1791d69b8a-clean-1792997473967`.
Archive: [`Asterlyn-0.1.20-references-20261026-macos.app.zip`](../../target/release/bundle/macos/Asterlyn-0.1.20-references-20261026-macos.app.zip),
19,989,142 bytes, SHA-256 `3250e6f11f9d85c3b6708e466dbc7fd9eaaa4d982f2d21ea4f5f89f3d2554ff7`.
Installed executable SHA-256: `3439956a4f5a63f233b78f0bbd7048cb26b120e80bb8e23ceb5f1f1970525ee4`.

The final installed session retains two pre-existing `existing_project_directories` invalidPath
startup-data errors; neither frontend readiness nor provider activation failed. This iteration does
not claim to fix the separate recent-project bound issue. The user's manual acceptance and
Windows/Linux desktop interaction acceptance are not claimed.

## Picker footer refinement

The user requested removal of the redundant `2 / 2` footer. Ordinary counts now appear only in
the picker title; filtering does not add a second count. The footer is absent when empty, while
localized no-match and partial-result warnings remain visible. This is presentation-only: query,
filtering, selection, keyboard and resource bounds are unchanged.

Typecheck, production build and 34 ownership/style checks pass. The existing Chromium/WebKit real
gesture suite passes, retaining no-match/512-result warning coverage and keyboard selection.
No new tests are added for this reversible presentation refinement. Fresh clean source `7db7fbf`
passed complete bundle signing/strict verification, actual-project probe, canonical replacement
and both saved-icon launches. The app root is preserved and installed executable matches the
accepted artifact; backups are verified ZIPs. Existing recent-directory startup errors remain
outside this UI refinement. [Exact delivery evidence](2026-10-26-language-picker-footer-install.json).

Archive: [`Asterlyn-0.1.20-picker-footer-20261026-macos.app.zip`](../../target/release/bundle/macos/Asterlyn-0.1.20-picker-footer-20261026-macos.app.zip),
19,990,871 bytes, SHA-256 `1a68839e1fb260c93afa695c3eb87e923a3fe67537557e2bc053952845e795a5`.
