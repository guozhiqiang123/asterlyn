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

## Native actor and read-only source checkpoint

The native command layer now binds a packaged profile to the exact producer, tools/components and
window-owned contribution selection. Model work runs outside the language actor; live authority and
model generations are rechecked while the actor continues processing document messages. Package and
tool integrity is revalidated at actual worker launch, not by repeatedly hashing complete components
on the 250 ms authority tick or 5 s model poll. Shutdown signals all owned groups and bounds force
cleanup; a ready model handle also rechecks producer authority without requiring a new request.

- Host script suite: 1,347 pass; native library: 167 pass, 3 explicitly ignored opt-in gates.
- Native clippy with warnings denied passes. Frontend production build passes.
- A real packaged Java adapter, real AGP two-module Android model and production native actor prove
  nonblocking startup/open during delayed model work, cross-module definition and version-2 unsaved
  diagnostics. A separate SDK-source run passes in 6.01 s including startup and shutdown: JDT SDK
  content crosses the native content-hash/range validator and remains a data-only source preview.
- Native per-source/aggregate limits are 512 KiB / 2 MiB, with SHA-256 content addressing and UTF-16
  range validation. The preview has no disk-save or project-file identity. Rendered keyboard and
  full mixed-language package/installation acceptance are recorded with the later delivery gate.

Logs: `final-host-scripts.log`, `final-native-tests.log`, `final-native-clippy.log`,
`native-java-actor-test.log`, `native-sdk-source-test.log` under the same temporary evidence root.
