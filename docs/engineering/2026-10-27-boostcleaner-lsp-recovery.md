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

## Kotlin metadata recovery and diagnostic stability gate

A maintained source fork now uses Kotlin 2.3.21 without disabling metadata checks.
The complete compiler component includes its mediated annotations dependency; the
initial incomplete proof was rejected by an actual KAPT run, then independently
rebuilt with all eight runtime inputs. No business dependency or TLS setting changes.

The development 0.3.6 package completes the unchanged real 25-module project in
239.901 s. All five definition/hover/completion groups pass: Java→Java, Kotlin→Java,
Java→Kotlin, coerceAtLeast and minutes. Standard-library results are explicitly
compiled declaration previews with content-addressed identity, not invented source
bodies. Java/Kotlin baselines both have zero errors. Unsaved injected diagnostics
cover their exact new line (Java 14 ms, Kotlin 414 ms); source hashes remain unchanged.
Peak process-tree RSS was 1,689,632 KiB, shutdown 2.514 s.

The same package still fails a mixed fixture intermittently: waiting for debounced
push diagnostics can time out after 20 s despite current semantic answers. Before
installation, replace that wait with a version/digest-checked internal Kotlin pull
request, invalidate unchanged callers when dependency text changes, release closed
Kotlin ownership and keep private versions monotonic across reopen. Extend the
fixture to cover dependency-only diagnostics and closing/discarding errors. Final
component/package identities and installed acceptance remain pending these gates.

## Final pull-diagnostic candidate

The maintained fork uses a semantic source epoch and per-file compiled epochs.
Dependency edits expire binding contexts lazily while preserving unchanged parsed
PSI. Initial source registration does not repeatedly clear the source collection.
The private diagnostic RPC validates open snapshot version/SHA-256 and dependency
epoch before and after compilation. The adapter protects the owning LRU session,
rejects changed workspace revisions and releases closed-file diagnostic ownership.
No new public protocol shape or Android implementation is added to the host.

The exact LSP 0.3.6 archive is 4,649,258 bytes, SHA-256
`03596cc16c0063daca7d87f3b2509f6b1816ae7025ec73db515c803a27dbcada`.
It pins separately verified Kotlin language component 2.3.21.2 (90,232,335 bytes,
SHA-256 `dca2069025626c15dc97c4a83601dbbd8ecd18a90bb5854f45d9617a13c55ef0`)
and complete compiler/KAPT 2.3.21 component (61,104,615 bytes, SHA-256
`28f04ffa1a30c2961cb8c71bf655e046ba39ca6d375d2fe81b99e73c842ae1bb`).
Each language component source rebuild is independent and byte-identical.

All 14 packaged mixed-language checks pass: ready 8.071 s, complete 40.928 s,
peak owned RSS 1,656,080 KiB, shutdown 906 ms, warm paired definitions p50 6 ms /
p95 9 ms. The native inspector/helper/desktop-validator/contribution chain passes.
Host typecheck, production frontend build, all 1,348 script tests and 15 focused
marketplace native tests pass (one live-network test is intentionally ignored).
The ownership gate initially rejected the existing 1,514-line marketplace command
module. Its unchanged test module now resides in `plugin_marketplace/tests.rs`;
module identity/assertions are preserved and no ownership ceiling is weakened.

Final unchanged boostCleaner and canonical installed receipts follow after completion.
Cold full model preparation remains a minutes-long operation; Java type-dependent
queries retry while Kotlin ABI regeneration is pending, with syntax diagnostics
still available. Standard-library declarations are read-only compiled previews.
Existing keyboard/readonly accessibility remains unchanged. Groovy/build scripts,
full cross-language references and a large-project soak guarantee remain outside
this Kotlin/Java recovery milestone.

## Exact package and canonical installation receipts

The final 0.3.6 archive completes the unchanged 25-module boostCleaner run in
273.958 s (ready 266.917 s), with all five definition/hover/completion groups and
both diagnostic checks passing. Baseline errors: Java 0 / Kotlin 0. Injected
errors cover the exact new line, returned in 13 / 390 ms. Kotlin standard-library
coerceAtLeast/minutes resolve to integrity-covered compiled declaration previews.
Peak owned RSS 1,547,936 KiB; shutdown 2.341 s; all source hashes remain unchanged.
Evidence: `real-036-pull.json`, with the complete mixed fixture in
`mixed-036-pull.json` under the case directory.

Fresh host build `9fbe2c45a0e71bc66632815aa7a52c708f1e0fb8` / app 0.1.22
is whole-bundle ad-hoc signed, strict/deep verified, has the expected bundle ID
and a sealed resource record. Executable SHA-256:
`a593a3843f4849cdd6147bf33c19e3d75c8c990c83b17f724e09065f77a0a4fc`.
CRC-verified ZIP: 25,214,355 bytes, SHA-256
`d37ce6cafabe88a2561426256a3ae340c37a6df12c299a1386c984a826b04694`.
The matching boostCleaner startup passes both exact plugin native health checkpoints.

Canonical installer receipt `installed-036.json` preserves app-root inode
203606126/device 16777234, verifies the installed executable matches the accepted
bundle, and stores the previous app as a verified ZIP only. Both icon-bookmark
launches record frontend readiness (PIDs 66308 / 66413). The reopened installed
session also passes the exact Android 0.6.1 and LSP 0.3.6 health predicate in
`installed-036-health.json`; no quarantine or inactive-plugin result is accepted.
Two unrelated stale recent-directory invalidPath errors remain visible in the
startup record and are not represented as language failures or zero-error logs.

macOS remains locked. The rendered-native smoke probe reports WINDOW_MISSING,
so interactive native navigation and visible-shell acceptance remain pending
unlock; neither is claimed from frontend readiness alone. The user has been
asked to unlock, while all independent build/package/install/log gates above
are complete. No remote push/tag/Release or business-project change occurred.

## Unlocked native follow-up — 2026-10-28

The accepted installed executable still matches its frozen SHA. Native boostCleaner
model import succeeds for all 25 modules in 18.627 s. The installed language session
reaches workspace.ready after 296.607 s and publishes zero baseline diagnostics.
A separate existing Android project window then reports an unexpected helper pipe
EOF, followed by intended same-version peer containment. Android 0.6.1 is quarantined
and rolls back to 0.5.10, which cannot satisfy LSP 0.3.6's dependency. Earlier native
lookups returning empty after this incident are not accepted as successful navigation.

No macOS crash report, stderr, protocol diagnostic or resource-limit event identifies
the original helper exit. The reader EOF path can win the process watcher race and
force cleanup before recording Child::try_wait. A minimal supervisor correction
now probes the original exit status for at most about 50 ms before cleanup. It
records an original code/signal, still-running observation or unavailable status,
never relabelling the host's force-stop as the original crash cause. The session-ID
guard, peer containment, resource policy and timeouts are unchanged. A real fixture
exiting 23 must retain that original status while its peer stays usable.

The native rendered smoke gate also fails SHELL_MARKER_MISSING with the desktop
unlocked; it is retained as a failed harness observation, not reported as a pass.
Do not run more app processes against the active installation during the following
controlled single-project recovery. Restore the exact provider with the normal UI
Repair flow, wait for its native checkpoint, then re-enable the dependent LSP.
Final single-project navigation and installation evidence follows after completion.

The exit-observation correction passes all 12 real supervisor integration tests
and the runtime unit tests, plus strict all-target runtime clippy. The fixture's
EOF retains original exit 23; expected replacement, idle exits, multi-window
identity containment and complete process-group shutdown remain covered. No
policy is relaxed. The first Repair attempt with the incompatible active fallback
is rejected; temporarily disabling the dependent LSP permits the exact Android
0.6.1 package revalidation. LSP will be re-enabled only after the provider's
normal pending-version startup checkpoint. No installation JSON is edited.

The native loading response was also swallowed by the frontend session client:
`request_language_service` logged loading while definition lookup displayed an
empty-result warning. The client now preserves typed indexing errors only for
the exact current document/session/version. Existing definition gesture handling
shows informational indexing text; stale errors still disappear and hover /
completion keep their graceful caller handling. Current-error recovery without
re-consent and stale-error rejection are covered; all 1,350 script tests and
typecheck pass. Business source hashes remain unchanged. A user-authorized
temporary unsaved test edit was discarded before further package replacement.

## Final installed native acceptance — 2026-10-28

The recovery milestone is accepted on the canonical installed app 0.1.22, code
revision `ccca8c7989c768234cf04c99774022dffbee286a`. Android Gradle 0.6.1 and LSP
0.3.6 are enabled, active and known-good with no pending replacement. Their exact
package digests remain those recorded above. The final host includes the two
follow-up fixes in `5dcdd3d` (original helper exit observation) and `ccca8c7`
(current-document indexing feedback). All 1,350 frontend script tests, typecheck,
12 supervisor integration tests, runtime unit tests and strict runtime clippy pass.

The final executable SHA-256 is
`1c014eb5830bbde8abb377ba65d48f4e94ce6a676d3816890e38ed7da48ee316`.
Whole-bundle strict/deep signature verification passes. The CRC-verified ZIP is
25,213,333 bytes, SHA-256
`60efb2ab724b0333da69c5cc33e5873086928c466bece6811b380775234d7403`.
The repository installer preserves `/Applications/Asterlyn.app` root inode
203606126/device 16777234 and keeps the prior app as a ZIP. Both icon-bookmark
launches record frontend readiness; the final reopened process is PID 34639.
The same signed bundle passes the rendered native shell smoke with a 30-second
observation budget, run serially before final installation. Earlier failed
six-second/locked smoke receipts remain retained, not overwritten as successes.

Final native session: `session-1793157545192-34639-0`, language session
`language-session-34639-1`. The 25-module model is acquired in 19,500 ms
(sequence 86). `workspace.ready` at sequence 104 follows language session start
by 313,143 ms. A navigation attempt while indexing visibly shows
“Language services are indexing this project. Try again shortly.” Once ready,
actual Ctrl+left-click gestures, verified by both selected saved destination tabs
and native lookup events, succeed in both directions:

- Kotlin `AdsRuntimeState.kt` → the three-argument `SharedPref.getLong` declaration
  in `common/src/main/java/com/swiftcleaner/lib/storage/SharedPref.java`.
  Request/selected sequences: 128/129.
- Java `AppUtils.java:297`, `GlobalConfigNew.INSTANCE.getInstallAttribution()` →
  `common/src/main/java/com/swiftcleaner/lib/storage/GlobalConfigNew.kt`.
  Request/selected sequences: 132/133.

F12 also opens the Kotlin→Java definition. Syntax/semantic diagnostic events
continue after navigation; the original Kotlin file has zero diagnostics.
Existing Java deprecation warnings are not represented as zero diagnostics for
the entire project. All four tracked business-source hashes are unchanged and
the boostCleaner worktree is clean. The user-authorized temporary unsaved edit
has been discarded; no business dependencies or global TLS settings were changed.

Through sequence 136 the final native session contains no plugin unexpected
exit, quarantine, protocol-limit, timeout or resource-limit event. The existing
two stale recent-directory `invalidPath` failures and expected indexing responses
are retained. Local evidence is under
`/tmp/asterlyn-android-lsp/boost-native-20261028/`: `final-installation.json`,
`final-plugin-health.json`, `final-rendered.log`, `accepted-native-session.json`,
`final-native-events.json`, `final-ui-checks.json` and `source-hashes-after.json`.
These local receipts supplement the exact-package mixed/real-project checks above;
they are not uploaded or committed as raw logs.

The optional final standard-library preview UI check was stopped when macOS
locked again after both required gestures. Its definition/hover/completion and
readonly compiled-preview checks passed against this exact packaged backend;
no additional native UI preview pass is claimed. Initial preparation still takes
minutes and observed large-project owned memory is about 1.5 GiB in the packaged
probe. The earlier multi-window helper EOF remains unexplained; this milestone
adds evidence for any recurrence, not a proven fix for that original exit or a
multi-window soak guarantee. No remote push, tag or Release was performed.
