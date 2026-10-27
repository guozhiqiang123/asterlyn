# Packaged analysis implementation checkpoint — 2026-10-27

This is the tested kernel/contract checkpoint for ADR-0036, not acceptance of the complete Android
profile. Native editor, mixed-language and installed-package gates remain in progress.

- SDK 1.14.0 is an exact canonical development artifact, SHA-256
  `3de0a44594d014298b4129c719b84a4544c834966e63c75a090db085fd43e761`.
  Static program/resource/tool/component/model bindings add no descriptor process authority.
- Package tests: 17 pass; model kernel: 9 pass, including shared leases, producer revocation,
  stale generations, limits and retention of a completed leased model beyond its execution deadline.
- Analysis adapter: 6 tests pass (one complete component-receipt test plus five real Node worker
  integration tests). Deduplication, cancellation, output floods/invalid JSON/nonzero exit,
  forbidden environment overrides, source-free progress and post-seal tampering are covered.
- Existing language transport: 16 unit tests pass; three opt-in server tests are separately gated.
- Adapter integration tests complete in under one second on this macOS arm64 host. Model I/O is
  bounded to 8 MiB per artifact and 32 MiB including pending and sealed files. Input is at most
  64 KiB; jobs/leases are bounded in the pure kernel. Actual JVM/installed-app RSS belongs to the
  later profile acceptance, not this kernel result.
- No new UI is introduced by this checkpoint; existing consent and editor keyboard/accessibility
  behavior will be checked with the native/profile gate. No JDK, AGP or JDT is added to host startup.
- Execution is reviewed user-account authority, not an OS sandbox. Unix process groups and
  cooperative owned-Gradle cancellation do not authorize stopping unrelated daemons. Components
  are explicit offline installations with complete, read-only content receipts; activation does
  not silently download them. Windows and Linux native acceptance is not claimed here.

Evidence logs are `/tmp/asterlyn-android-lsp/kernel-stage-tests.log`,
`kernel-stage-clippy.log` and `sdk-contract-tests.log`.
