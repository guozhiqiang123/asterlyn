# LSP activation regression — 2026-10-26

## Observed failure

Testing the Asterlyn repository in the installed application did not activate its language service.
Persisted logs show the native `dev.asterlyn.lsp` helper returning one contribution, followed by
`activate_installed_plugin_runtime` failing with `invalid runtime contribution kind`. The local
installation index then marked the immutable LSP 0.1.0 package as quarantined; later sessions
correctly refused to retry that quarantined version, so no language execution review appeared.

The frontend type union and contribution projector already supported `languageService`, but the
separate runtime desktop-result validator still allowed only the four older contribution kinds.
The previous mocked-runtime tests bypassed this exact desktop boundary. A new regression test
reproduced the installed error before the fix.

## Correction and recovery

- One constant list now defines both the frontend contribution-kind type and runtime allowlist.
  It includes the native `languageService` tag and continues rejecting unknown kinds and SDK
  spelling aliases such as `language-service` at the wire boundary.
- A real bundled-package acceptance command now runs the native package inspector and isolated
  helper, then routes its activation through the production desktop validator, contribution
  projection/registry and current-project buffer binding, all the way to execution review.
  `npm run test:lsp:activation` is included in preview and release quality jobs.
- Provider availability changes emit `language.provider.changed` metadata, without file paths or
  source text, so future reports can distinguish a missing provider from server startup failure.
- Recovery is limited to the user's falsely quarantined `dev.asterlyn.lsp` 0.1.0 package. Its retained
  archive SHA-256, immutable content digest, identity and installed resource tree are verified before
  using the existing `PluginInstallationStore::repair_quarantined_version` transition while the old
  app is stopped. No general quarantine policy is disabled and no automatic repair loop is added.
  Exact package SHA-256 remains
  `2a3cec68eb06fd13ece09f3935e15fda30ef853ee4d240c4c3bf9d1e82cbe6d9`.

## Validation

- The desktop-boundary regression fails with the original code and passes after correction.
- Focused protocol/runtime/controller/release-workflow tests: 47 pass.
- Complete script suite, concurrency 4: 1308 pass.
- Typecheck and production frontend build pass; rendered CodeMirror regression passes.
- Actual Asterlyn workspace, using an unsaved overlay of
  `src/features/files-editor/text-blame-availability.ts`: diagnostic 2322, useful hover, definition,
  and completion all pass in approximately 1.4 seconds. Disk bytes are checked unchanged afterward.
- Native bundled-package → real isolated helper → desktop validator → contribution registry →
  editable buffer → execution review passes. Execution approval is deliberately declined in this
  automated bridge test; actual LSP transport is exercised separately against the real workspace.
- Fixed native build `c322d41` passed strict signing, actual-project native application startup,
  canonical replacement and two saved-icon launches. App root identity is preserved; the installed
  executable SHA-256 matches the accepted signed source. Installed logs record LSP activation with
  one contribution and `language.provider.changed` with one registered provider. The installation
  index is `knownGood`, and the invalid-contribution-kind error is absent from the new session.
- Exact immutable package was recovered through the existing native store transition from
  `quarantined` to `pendingRestart` (generation 41 → 42), then activated and confirmed healthy.
  [Machine-readable evidence](2026-10-26-language-services-activation-evidence.json) records the
  repair, build, archive/executable hashes and installed-log session. No server execution approval
  was automatically granted during application verification.

The first provider still supports TS/JS-family ordinary editable files. Rust files and historical,
Diff and conflict surfaces do not receive this first-provider overlay. Native server execution
still requires the application's host-owned approval.
