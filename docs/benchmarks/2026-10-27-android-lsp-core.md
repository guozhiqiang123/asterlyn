# Android LSP core — 2026-10-27

Asterlyn 0.1.22 keeps model/backend algorithms in the independent plugins. The generic host owns
reviewed programs, component/tool receipts, bounded asynchronous model work, leases, live authority,
versioned language transport and data-only dependency-source previews. SDK 1.14.0 is a canonical
development artifact, not a published SDK Release.

## Accepted chain

- Android plugin 0.6.0: real AGP V2 selected-variant module/dependency model, stable post-cleanup paths,
  Android boot classpath and matching local SDK source directories. Archive 4,787,380 bytes, SHA-256
  `23b3a596f4b412260c88bb8fc4169427c649b8108dab43470831181949547f1c`.
- LSP plugin 0.3.0: Java/Kotlin packaged backend; private module views, exact KAPT metadata/JDT
  declaration mapping, current-version dirty diagnostics, at most two lazy module-specific Kotlin
  JVMs, controlled backend recovery and SDK content-addressed readonly previews. Archive 5,073,150
  bytes, SHA-256 `fb68e35395f1d8c16b271b819d40a4701c6ecdfc2969e6b09b23dc10d34e14e2`.
- Complete real Android fixture assertions: Java→Kotlin / Kotlin→Java, both dirty method signatures,
  hover/completion, version-bound diagnostics, demo/prod model replacement retaining dirty buffers,
  illegal library→app reference rejected, and force-killed Kotlin backend recovery. The actual archive
  is extracted to a Chinese/space-containing directory for the same test. Observed child processes
  stop after shutdown. No IDE asset extraction, project source edits or processor execution.
- Native production actor: Java cross-module navigation, SDK source result validation, versioned dirty
  diagnostics and document responsiveness while model work is pending. Existing native TS/Rust
  independent-session test passes in 14.48 s. Actual isolated helper→desktop validator→registry→
  TS/Rust/Android editor bindings and distinct execution reviews pass.
- Native library 167 pass / 3 explicitly ignored opt-in tests; host scripts 1,347 pass; strict native
  clippy and frontend production build pass. Android tests 69 pass, LSP tests 6 pass. Native package
  inspector accepts both exact final artifacts and rejects incompatible older hosts.

## Performance / memory / accessibility

Final packaged real Android run: ready 8.217 s; full edits/model replacement/crash/restart/cleanup
41.899 s; owned process-tree peak RSS 1,284,096 KiB; shutdown 827 ms. Twenty warmed Java→Kotlin plus
Kotlin→Java pairs: p50 8 ms / p95 19 ms. First completion after ABI rebuilding is about 4.4 s. These
are fixture samples, not a large-project SLA. JDT heap is capped at 1,024 MiB, each of at most two
Kotlin backends at 1,024 MiB; transient compiler work is additional. No language JVM starts from
metadata activation. Worker/lease/model disk bounds are in the kernel checkpoint.

Chromium and WebKit rendered tests pass Ctrl/Command click, F12, references picker keyboard/filter/
Escape, stale-result handling, dirty target selection and readonly SDK preview focus/text protection.
Chromium retained JS heap delta over 20 picker/navigation cycles is about 210 KiB in a local sample.
Native validation uses logs and real stdio requests; foreground screenshots are not acceptance evidence.

## Limits and follow-up

Java/Kotlin core is usable; Groovy, Gradle DSL, XML/resources, Compose/processor support and complete
cross-module/cross-language usages aggregation remain separate stages. Pure JVM/composite builds
are rejected until their model identity is supported. New unopened files created externally require
a model/session refresh; opened new files and changes to existing source views are handled. SDK/
dependency source previews allow selection/copy, without saving or continued semantic navigation.
Kotlin language features follow the reviewed fwcd compiler. Windows/Linux runtime acceptance and
large-project CPU/retained-memory soak tests are not claimed.

The user's Gradle dependency cache was cleared during validation; old boostCleaner model paths were
invalidated. Earlier real model/Java probes are historical only. Dependency recovery hit repository/
proxy failures; the final independent real Android fixture uses stable caches. Missing dependencies
remain an offline import failure until the project's normal sync/build restores them. No artifact
with a different hash is substituted for the same Maven coordinate/version.

Detailed plugin receipts/source/license provenance: [LSP acceptance](../../../asterlyn-plugin-lsp/docs/android-acceptance-2026-10-27.md),
[Android model acceptance](../../../asterlyn-plugin-android-gradle/docs/android-model-fixture-evidence.md).
Local structured evidence is under `/tmp/asterlyn-android-lsp`. Signed build/install receipts follow below.

The desktop boundary also maps the new profile-neutral native indexing state to the existing
informational loading UI (retaining legacy Rust compatibility), so clicking during initial model
work does not produce an operation-failed toast. Focused state-projection regression passes.
