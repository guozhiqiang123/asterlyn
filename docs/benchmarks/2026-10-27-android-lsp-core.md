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
- Native library 170 pass / 3 explicitly ignored opt-in tests; host scripts 1,348 pass; strict native
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

Creating/removing Android project markers while a folder is already open requires reopening that
project. Isolated activations currently preserve their existing contribution set on catalog changes;
an SDK descriptor `evidenceKey` alone does not reach that installed-plugin lifecycle. A follow-up
must add a generic, bounded activation-identity contract and selectively recreate only the affected
idle activation; restarting all plugins or adding Android-specific host detection is not acceptable.

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

A changed input or selected configuration revokes the previous native model lease before waiting
for replacement work. Detection uses the bounded 5-second model poll; responses from the old actor
model generation are rejected while importing/indexing the replacement.

## Existing-installation upgrade regression

The first signed startup probe rejected delivery: separate admission of Android 0.6.0 and LSP
0.3.0 collided with the previous process's active 0.5.10/0.2.1 pointers. The installation was not
replaced. Bundled startup now admits the complete verified set atomically, clears only superseded
startup selections, preserves known-good/user-disabled/rollback state, and keeps normal runtime
dependency validation strict. A conflict retains the old valid configuration and logs
`bundle.upgrade.deferred`; it cannot abort basic application startup.

Three native tests use the actual previous/current archives: partial-pending upgrade through normal
activation/health promotion and idempotent restart; disabled choices preserved; incompatible enabled
third-party consumer rejects the entire write. All pass. Final native library: 170 pass / 3 ignored;
marketplace: 23 unit + 1 version-compatibility + 4 persistence tests pass; strict clippy passes.

## Native model identity regression

The resumed desktop probe reached frontend/package health, but actual Android requests failed before
worker launch. The task-cache fingerprint is bare SHA-256 hex, whereas the model grant requires
algorithm-qualified `sha256:` identities. The native input adapter now qualifies its fingerprint;
the model kernel remains strict. A regression feeds the real filesystem fingerprint through
`ModelGrant::admit`, and also verifies that the old bare representation is rejected. Model logs
distinguish `identity-invalid` from revoked authority without recording source, selection or paths.
Direct adapter/actor probes with a simulated model reply do not establish native model admission;
delivery must additionally observe actual `worker.progress` and `model.acquired` events.

After the correction: native library 171 pass / 3 ignored; strict native clippy passes.

## Signed desktop and installed acceptance

Accepted source is `7ae487017dd70dc81661bf6a3ca317ee9d6ac23e` (clean build, host 0.1.22).
The complete macOS bundle was ad-hoc signed with hardened runtime, and strict/deep signature,
bundle identifier and sealed resources checks passed. Executable SHA-256 is
`04b1705c96a6cd6e0c644d11a51413bad94b3d3b97b9befe6477e570e5bb4c75`.
The verified signed ZIP is 25,643,469 bytes, SHA-256
`c5432d1e6b07c421f1c8722362abb87074ea111642a134c10ca70ff406639d1a`.

The actual signed desktop was also exercised against the real AGP 8.12.2/Kotlin 2.2, two-module,
two-flavor Android fixture. Its native input fingerprint, dependency/package authority, supervised
model worker, model artifact lease and Java/Kotlin backend ran together (no simulated ModelAccess).
Structured events confirm compile → model → serialize → `model.acquired` (2,197 bytes, generation 1,
8,633 ms), followed by `workspace.ready` about 16.5 seconds after session start. F12 on
`MainActivity.kt`'s `JavaBridge.label` opened the actual Java declaration; F12 on Java's
`LibraryValue.answer` opened its Kotlin declaration. Destinations were checked through accessibility;
stage/readiness conclusions come from native logs. No source buffers were edited. An isolated HOME
reused the owned retained fixture dependency cache and the reviewed installed package/component
store, avoiding dependence on the user's recently cleared Gradle cache. All seven observed owned
desktop/helper/server processes ended after normal menu Quit. The 226,096 KiB process-tree RSS
reading is an idle sample, not a peak or large-project budget.

Normal-HOME startup then verified exact Android 0.6.0 and LSP 0.3.0 activation plus native known-good
checkpoints. The existing `existing_project_directories` validation errors are outside this language
acceptance; zero application-wide errors is not claimed. The canonical installer replaced only
`/Applications/Asterlyn.app/Contents`, preserving root inode `203606126`, retained a verified ZIP
backup, and matched the installed executable to the accepted signed bundle. Icon-bookmark launch
(PID 48430) and normal Quit/reopen (PID 48536) both recorded frontend readiness for that same build.
Both plugins remain enabled/active/known-good. No tag, push or remote release was performed.

Local receipts: `/tmp/asterlyn-android-lsp/native-model-desktop-acceptance.json`,
`native-model-desktop-processes.json`, `final-plugin-startup.json`, `final-signed-artifact.json`,
`final-signed-archive.json`, `final-installation.json` and `delivery-status.json` in that directory.
