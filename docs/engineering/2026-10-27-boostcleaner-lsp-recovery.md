# boostCleaner Android LSP recovery

Scope: the real `/Users/gzq/AndroidStudioProjects/boostCleaner` project, Java/Kotlin semantic
features through the installed application. Preserve its source/build files, dependency versions,
TLS verification and user-wide network configuration.

## Diagnosis and sequence

1. Reproduce offline failure and identify the exact failing configuration and repository through
   scrubbed, bounded evidence. Distinguish unavailable main dependencies from test-only resolution.
2. Use AGP's published `InjectedProperties.PROPERTY_BUILD_MODEL_V2_ONLY`
   (`android.injected.build.model.v2=true`). `invoked.from.ide` alone does not select IDE model sync
   behavior. Keep strict main-artifact unresolved validation; never claim incomplete main models ready.
3. Publish a fresh local Android plugin patch identity, inspect its complete archive and update the
   bundled host pin. Prove real missing-test dependencies are isolated while missing-main dependencies
   still reject admission. Do not invent an unpublished JUnit artifact, change the business project's
   dependencies, disable certificates or redirect arbitrary dependencies to another repository.
4. Test the exact packaged provider and LSP backend on boostCleaner: current variant, real module
   graph, Java/Kotlin definitions, hover/completion and current-version dirty diagnostics without
   writing source edits. Record timing, resource samples and cancellation/process cleanup.
5. Build/sign/verify and use the canonical installer. Verify the real project's installed model
   worker and language readiness from logs, then navigation destinations and icon quit/reopen.
   Commit implementation and evidence separately; no remote publication.

Initial controlled probes: normal provider fails on
`:clean:cleanx100DebugUnitTestCompileClasspath` / `junit:junit:4.14-SNAPSHOT`. Online fallback
reaches AppLovin Maven and fails TLS. Google Maven and Maven Central validate TLS normally.
The existing local proxy reproduces the AppLovin handshake failure, so certificate weakening is
not a recovery strategy. With the proper AGP v2 mode, the unchanged real project exports 25 main
modules, 1,438 compile entries and zero main unresolved dependencies in about 9.9 seconds offline.
This establishes a model probe only; semantic and installed acceptance remain required below.

References: [AGP injected properties](https://android.googlesource.com/platform/tools/base/+/77b69cf85219f333699ba865d83ad999cbd8e077/build-system/gradle-core/src/main/java/com/android/build/gradle/options/BooleanOption.kt),
[Gradle network configuration](https://docs.gradle.org/current/userguide/networking.html).

Evidence directory: `/tmp/asterlyn-android-lsp/boost-recovery-20261027`.

## Generic native response handling

LSP ContentModified (`-32801`) means that the source context is no longer current. The native
actor maps only this response code to the existing informational loading/retry message. Existing
document-version/model-generation rejection still runs first; unrelated server errors remain
failures. Android compiler/Gradle decisions stay in the plugins.

Validation: focused response-code isolation test; all 172 native lib tests passed (3 ignored);
strict native lib clippy passed, using an isolated target/TMPDIR. This establishes host response
handling only; final plugin and installed-project acceptance remain required.

Reference: [LSP response errors](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.18/specification.md).

## Packaged language recovery

Android provider 0.6.1 imports all 25 modules and 1,438 compile entries without unresolved main
artifacts. LSP 0.3.4 adds lazy closed-file Kotlin compilation, complete initial private overlays,
version/context-checked diagnostic caching, effective KAPT source digests and current Java syntax
feedback while Kotlin ABI is rebuilding. Generic native handling contains no Android compiler logic.

Bundled LSP archive: 5,078,737 bytes, SHA-256
`9f8c14cd4bf9f8d581af2dc43e88fe400a543a0aa946dd6bb9398107c306c561`.
The exact extracted archive passes all 12 mixed fixture checks, including unsaved signatures in both
language directions, dirty diagnostics, saved-buffer reopening, variant/model replacement, module
isolation and owned Kotlin crash recovery. Java syntax feedback while Kotlin is invalid took 37 ms.
Native inspector/helper/desktop-validator/contribution routing also passes. Real-project final
measurements and canonical installed acceptance are appended after completion.

## Real-project findings and final candidate

The complete 0.3.4 adapter run reached readiness in 252.128 s and passed three actual-source
definition/hover/completion groups: Java→Java common storage, Kotlin→Java common storage and
Java→Kotlin app configuration. The stricter baseline-then-edit diagnostic-position check rejected
its Java syntax result. The real common-module reproduction isolated incremental JDT parser state: a
new syntax error on line 21 was returned on the original class at line 5.

LSP 0.3.5 parses current captured text with a fresh JDT ASTParser only for partial syntax reports,
using project compiler options without binding resolution. Full semantic diagnostics retain their
existing path. The exact bridge rebuild is 8,274 bytes, SHA-256
`efbc2e3cd3bc835a08e17f6ce5410b9d46374e1ab220b303d5d87932781c67d0`.
The reproduced common-module case now has zero baseline errors and five injected errors at the
correct line, returned in 13 ms; business sources remain unchanged.

Final bundled LSP 0.3.5: 5,079,800 bytes, SHA-256
`8a5a04a17d391197e69fd8012a29fc7979fcaada6f0a27ed6b79342fbdb50d8c`.
Final acceptance below uses this archive, not a source-only backend or the previous candidate.

The canonical 0.3.4 intermediate installation preserved app-root inode 203606126 and passed two
icon-bookmark launches with frontend_ready. In that installed boostCleaner session, task discovery
returned 13,676 tasks in 16.313 s and the native model worker exported 25 modules in 24.441 s. Actual
Ctrl-clicks from AdsRuntimeState.kt/getLong and RecommendConfig.java/getInt both opened the real
common SharedPref.java. This is navigation evidence for the preceding candidate; the final Java
syntax correction requires its own installed identity and startup receipt.

Health probes must open a matching Android project: a metadata-only activation with zero Android
contributions is abandoned rather than promoted. This is intentionally not a health checkpoint for
a new provider. On boostCleaner both exact packages passed activation and their native checkpoints.
One concurrent Rust build/import probe exceeded the development harness's original five-minute
budget; its failure is retained. A separate complete run is measured without that competing build.
The bounded ten-minute acceptance budget is not a product startup SLA.

## Additional compatibility gate: Kotlin 2.3 metadata

The 0.3.5 full 25-module run passes actual-source Java→Java, Kotlin→Java and Java→Kotlin definition,
hover/completion and exact-line unsaved diagnostics. Java baseline is clean; Kotlin has ten baseline
diagnostics. A direct module-closure probe (without KAPT) identifies a separate blocker: the real
project selects kotlin-stdlib 2.3.21 / metadata 2.3.0, while fwcd's compiler 2.1.0 accepts at most
2.2.0 metadata. Java getLong/setLong mapping works, but coerceAtLeast/minutes do not resolve. This
is not accepted as normal Kotlin support merely because application-defined navigation passes.

Follow-up sequence before closing real-project acceptance:

1. Build the pinned MIT fwcd source against published, version-matched Kotlin 2.3.21 compiler/runtime
   artifacts in an independent directory. Preserve lazy compilation, URI encoding and exact-version
   diagnostic guards; record every source/artifact digest, licenses and deterministic build steps.
2. Keep the compiler/server behind the plugin's on-demand verified analysis-component boundary.
   Do not add Kotlin/Gradle algorithms or runtime dependencies to the lightweight desktop host,
   source tools from an IDE, change business dependencies, or disable metadata/TLS validation.
3. Freeze a new local component/plugin identity. Test baseline diagnostics and standard-library
   definition/hover/completion as well as Java interoperability and all existing dirty-buffer,
   module-isolation and recovery gates. Unknown newer language formats must remain explicit.
4. Repeat complete packaged 25-module and installed boostCleaner acceptance, then update receipts,
   sign/install canonically and commit the implementation/evidence in steps. Current 0.3.5 package
   evidence is intermediate; screen lock currently prevents further native input verification.
