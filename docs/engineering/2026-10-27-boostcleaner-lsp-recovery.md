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
