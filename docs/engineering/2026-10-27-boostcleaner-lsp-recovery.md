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

## Reopened incident and correction plan — 2026-10-29

The next user report is reproducible from the retained native log without UI
inference. The installed executable still matches `ccca8c7`; the newer host HEAD
only adds documentation. In that same session, event 146 records the original
Android 0.6.1 helper exit as signal 24 (`SIGXCPU`). Event 147 terminates the
language session, and event 199 rejects LSP reactivation after automatic fallback
to Android 0.5.10. The prior acceptance ended at event 136 and therefore did not
establish continued session health. This later receipt reopens that milestone.

The host incorrectly applies a 60-second *lifetime cumulative* CPU allowance to
long-lived plugin helpers (Unix RLIMIT_CPU, Windows per-process job time). Even
small legitimate work eventually exhausts it. The correction stays generic:

1. Replace the host-imposed lifetime CPU limit with a bounded rolling 60-second
   CPU budget over 60 seconds of monotonic wall time. Read actual process
   user+system CPU on macOS/Linux/Windows; retain memory, request/startup/output,
   process ownership and fail-closed sampling policies. No plugin-specific escape
   hatch, arbitrary lifetime extension or removal of resource supervision.
2. Cover long sessions crossing 60 cumulative CPU seconds, sustained excess,
   window expiry, counter anomalies and bounded sampler storage. Verify real
   process counters and inherited CPU limits plus existing cleanup/peer tests.
3. Build/sign/verify a fresh native package, restore the exact quarantined provider
   through normal verified Repair, install canonically, and recheck real-project
   navigation with exact package health and sustained-session evidence. Preserve
   the SIGXCPU incident and the earlier limited acceptance instead of relabelling
   either as an unexplained plugin defect or a successful soak.

The implementation passes 8 unit tests, 13 supervisor integrations, all 1,350
frontend script tests, typecheck, production frontend build and strict all-target
runtime clippy. Linux x86_64 and Windows GNU x86_64 all-target runtime checks pass;
those are compilation checks, not native-platform execution acceptance.

Two explicitly invoked real-process soak checks exercise actual kernel counters:
65,024 ms of cumulative CPU over 143,791 ms wall time remains active and accepts
a post-soak invocation; a four-thread idle runaway is stopped as `resourceLimit`
after 15,531 ms. The first runaway candidate failed because raw macOS CPU counters
were mislabelled as nanoseconds. That failed receipt is retained; the corrected
Mach-timebase conversion is independently checked against POSIX `getrusage`.
The units follow Apple's [task accounting](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/task.c)
and [rusage projection](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/bsd_kern.c).
No compiler flags, project dependencies or TLS settings change. Local evidence
and canonical installation/navigation receipts follow under
`/tmp/asterlyn-android-lsp/boost-cpu-window-20261029/`.

### Installed recovery follow-up

Fresh host code revision `555898c6b9d5e59ae221f93223106047350c8120` is signed,
strict/deep verified and installed canonically. Executable SHA-256:
`cb8c5b82c2be79c078a9c338e95544b3862f23c4d2579f924d708cf8fc013f83`.
Its CRC-verified ZIP is 25,214,724 bytes, SHA-256
`ad873fd16528e33d0161f05b3b9695b2b1e53db8a2f618e247246028cd467d83`.
Exact Android 0.6.1/LSP 0.3.6 native health, rendered-shell smoke and both stored
icon launches pass. Installation preserves root inode 203606126/device 16777234;
the reopened installed process is PID 43231, session
`session-1793240123275-43231-0`.

The isolated provider was restored through the ordinary verified Repair path:
temporarily disable its consumer, verify Android 0.6.1, restart through its native
health checkpoint, then re-enable the same LSP 0.3.6 package and replace the host.
Installation JSON was never edited. A second recovery prerequisite is visible
in this native session: the old fallback had written a cache rejected by 0.6.1
(`cache-corrupt`, zero tasks, event 23). Without a selected current run configuration,
the model worker rejects the startup request and reports backend failure. This
does not count as successful language initialization. Ordinary task refresh
recovers 13,676 tasks and stores the exact-version cache (events 113/120).
The same language session can retry model acquisition without another consent:
all 25 modules import in 22,187 ms (event 130, generation 9), followed by language
model preparation. No application build, device deployment or business-source
edit is used to restore the task cache. Final native gesture receipts follow
after readiness.

Native acceptance now completes on that installed build. After task-cache
recovery, preparation reaches `workspace.ready` at event 137, 319,610 ms after
the successful model attempt starts (event 127). The actual model selection is
`:app` / `cleanx100Debug`. The old persisted preferred ID names an Adsremoved
configuration absent from the current task list, so the plugin's existing
selection rule uses the first currently valid configuration. No preference or
business file was manually rewritten to force this result.

Actual Ctrl+left-click from the user's `AdLibExtention.kt:14` opens both:

- `AppAds` → `app/src/ads/java/com/swiftcleaner/app/ads/AppAds.kt:23`, the object
  definition (native request/selected/opened events 145/146/147).
- `showNative` → the same file at line 78, the
  `fun showNative(owner: LifecycleOwner, sceneId: String, container: ViewGroup): Job`
  declaration (events 161/162/163).

Selected saved destination tabs corroborate the log outcomes. The original
source publishes zero diagnostics. Android 0.6.1 and LSP 0.3.6 remain enabled,
active and known-good with no pending replacement; the final installed session
has no plugin termination or activation-failure event through event 193.
All four sampled source hashes are unchanged and boostCleaner is Git-clean.

The 55 preparation samples peak at 1,292,160 KiB aggregate descendant RSS;
the two isolated plugin helpers together peak at 29,344 KiB. This is sampled
RSS (including shared pages), not private memory, a cross-platform benchmark or
a long-project soak guarantee. The real 65-second CPU fixture separately covers
the original lifetime-expiry regression. Cold language preparation still takes
about five minutes; an invalid task cache requires the ordinary Gradle refresh.
The generic model-error feedback before that refresh remains less specific than
the task panel's cache warning. It is retained as a known diagnostic limitation.

Final local receipts include `installation.json`, `signature.json`, `archive.json`,
`plugin-health.json`, `rendered.log`, `native-events.json`,
`ui-and-log-acceptance.json`, `native-resource-samples.json`, and source hashes in
the 2026-10-29 case directory. No raw local logs are committed or uploaded.
The install keeps the canonical app-root identity and verified ZIP backup;
no remote push, tag or Release is performed.

## Command-click on a Kotlin declaration — 2026-10-29

The user's exact failing position is the `initialize` declaration in
`app/src/ads/java/com/swiftcleaner/app/ads/AppAds.kt:26`. A direct probe of the
admitted Kotlin 2.3 backend and real AGP model returns an empty definition list
at this declaration, but a valid references request returns
`app/src/main/java/com/swiftcleaner/app/CleanApplication.kt:69`. The function-body
call `AppAdsRuntime.initialize` independently resolves to AppAdsRuntime.kt:43.
Thus the declaration navigation gap is separate from modifier recognition and
from the earlier runtime expiry. Probe receipts are retained under
`/tmp/asterlyn-android-lsp/boost-command-nav-20261029/`.

The host currently asks for references only when a definition exactly points back
to the clicked symbol. Some language servers return no definition for their own
declaration instead. Extend the generic, bounded navigation flow: after a valid,
untruncated empty definition result, try semantic references. One caller opens
directly; multiple callers use the existing picker. Invalid results and indexing
failures must not start this fallback. If neither lookup finds a target, preserve
the original no-definition message. Existing version/session/tab guards still
discard stale responses. No language parser or Kotlin-specific resolver is added
to the host. Rendered Chromium/WebKit checks cover Control and native macOS Meta,
single/multiple/absent references, malformed output, loading and stale responses;
final exact-position native Command-click acceptance follows after packaging.

The focused fix is host revision `3b6a5b7ccdb9c59781ffdcab80f33966ad623deb`.
Typecheck, all 1,350 script tests, production frontend build and rendered
Chromium/WebKit Control/Meta tests pass. The rendered suite includes direct
single-reference navigation, multi-reference selection, a genuinely missing
definition, malformed server output and cancellation during the extra lookup.
The exact Kotlin adapter used by the direct real-project probe matches the
installed 0.3.6 adapter byte for byte; its admitted compiler component is unchanged.

The new signed/strictly verified host executable SHA-256 is
`888feed6ace4f9aec1ffa07cc563240bb2da3dfe98dd5ac5a17f130efb71359a`.
The CRC-verified 25,214,944-byte ZIP has SHA-256
`92d9f1825402cfbd74279431e69cfdb85a9ed9adfe097b2e0062c30b8ac1640e`.
The exact plugin native health and 30-second rendered shell smoke pass before
canonical installation. Both stored-icon launches succeed with frontend readiness;
the reopened installed session is `session-1793242268819-54609-0` (PID 54609).
Root inode/device and ZIP-only recovery remain preserved. The exact-version task
cache restores 13,676 tasks directly without a new task scan. The model imports
25 modules in 17,058 ms before cold language preparation.

Native follow-up exposed a second independent trigger: while task discovery
refreshes, Android's run-configuration snapshot returned null selection despite
retaining 13,676 known task entries. The adapter's next model poll revoked the
otherwise valid model, rejected the null request, and prepared all modules again
after refresh. This is not evidence that the Command modifier was lost. The
intermediate `3b6a5b7` installation alone is therefore not final acceptance.

Android 0.6.2 preserves the retained runnable configuration identity/metadata during
loading, with incomplete descriptors and the original loading status. Run execution
and quick actions still require a ready projection; failed/unavailable discovery
or no retained runnable tasks produces null selection.
An authoritative completed variant change still changes the selection and
revokes the model. Native input/authority checks are unchanged. All 70 Android
tests, typecheck/build and native package inspection are required for the final package.
The host pins this exact package and removes its superseded production archive;
the explicit old-version migration fixture remains. Final native acceptance also
refreshes tasks after readiness and checks that unchanged selection does not
trigger a second model import.

The final Android 0.6.2 candidate passes all 70 tests, typecheck/build and native
inspection: 4,787,501 bytes, SHA-256
`1f04f3da4fd8c58b5a14a94a354614a190791aea212f63b3aa50cf30afffe2c7`.
The host's exact bundled artifact tests and all 1,350 scripts pass again; focused
marketplace migration/admission checks pass 14 tests (one unrelated live-network
test remains intentionally ignored). The correction retains selection only during
healthy refresh loading. Failed discovery disables retained tasks and remains
fail-closed; its labels are never treated as runnable evidence.

### Final installed Command-click receipt

The accepted host code revision is
`8bad30ce95e5f64a6124849420b306647ad02a39` (application 0.1.22), bundled with
Android 0.6.2 and unchanged LSP 0.3.6. The whole bundle passes strict/deep signing
verification, exact-package native health and rendered-shell smoke. Its
CRC-verified archive is
`target/release/bundle/macos/Asterlyn-0.1.22-8bad30c-macos.app.zip`,
25,214,955 bytes, SHA-256
`2b78abf4b6833d1672146c8cd217da98b7389c238676675e0251d4b852865db8`.
The installed executable matches SHA-256
`20becd57536a7d4333032c253123b03c57541208d19fcb3d418889f783c44cdb`.
Canonical replacement preserves inode 203606126/device 16777234 and uses a
verified ZIP backup. Both stored-icon launches confirm frontend readiness;
the reopened installed session is `session-1793243813250-61853-0` (PID 61853).

The Android version change invalidates the previous version-bound task cache.
Ordinary Refresh Gradle tasks restores 13,676 tasks (event 114); no application
build or business-source edit is used. The selected model imports all 25 modules
in 23,624 ms (event 128). Language preparation reaches `workspace.ready` at
event 131, 293,107 ms after the model attempt begins (event 125).

Actual native **Command+left-click** succeeds at both exact positions:

- `AppAds.kt:26`, declaration `initialize`: requests a definition, then semantic
  references, selects its sole caller and opens the saved `CleanApplication.kt`
  target (events 135/136/138/139). The admitted backend's independent probe
  identifies that caller as line 69.
- `AppAds.kt:27`, call `AppAdsRuntime.initialize`: selects the definition and
  opens saved `AppAdsRuntime.kt:43` (events 143/144/145); the highlighted
  declaration line is also visually confirmed.

The receipts combine actual modifier input, selected saved destination tabs,
semantic backend ranges and native navigation events. They do not substitute
an F12 or Ctrl-only check for Command-click. AppAds publishes zero diagnostics;
the other opened files have existing diagnostics, so this is not a claim of
zero diagnostics across the project. All three sampled business-source hashes
remain unchanged and boostCleaner is Git-clean. Both installed plugins remain
enabled, active and known-good with no pending replacement.

The 63 preparation samples peak at 1,400,224 KiB aggregate descendant RSS;
isolated plugin helpers together peak at 44,624 KiB. These are sampled RSS,
including shared pages, rather than private memory or a long-running soak.
The 20-cycle rendered navigation fixture retains 155,432 additional JavaScript
heap bytes in this local Chromium sample; it is not a general leak guarantee.
Rendered Control/Meta and keyboard navigation checks retain existing accessible
status/picker behavior. Cold preparation remains about five minutes, and the
initial generic `android-indexing` response is retained as a feedback limitation.

macOS locked after both required gestures; the user then unlocked it and the
additional refresh-stability acceptance completed in the same installed session.
Refresh is requested at event 159. Loading retains 13,676 tasks (event 166) and
the configuration snapshot (event 167, 1,102 bytes); the former faulty empty
selection snapshot was 71 bytes. The completed scan restores ready tasks and
configurations at events 202/204. Across the 113,814-ms observation through event
212, model acquisition and workspace readiness each remain at one occurrence,
with no new language-state event, model import, reindex, plugin termination or
quarantine. This covers an unchanged-input refresh, not reuse after an actual
variant/build-input change or a failed scan.

After this refresh, actual Command+left-click repeats both successful routes:
the declaration opens saved `CleanApplication.kt:69` (events 206/207/208/209,
highlighted caller visually confirmed), and the body call opens saved
`AppAdsRuntime.kt:43` (events 210/211/212). The three business-source hashes still
match and boostCleaner remains Git-clean. No additional application build,
device deployment or source edit is used for this acceptance. Evidence is retained locally in
`/tmp/asterlyn-android-lsp/boost-command-nav-20261029/`, including the final
installation, package health, signature/archive, rendered-shell, source hashes,
native events, resource samples, `refresh-stability.json` and
`ui-and-log-acceptance.json`. Intermediate
installation/watch receipts are explicitly named as intermediate. No raw local
logs are committed or uploaded, and no remote push, tag or Release is performed.

## Reopened class-reference incident — 2026-10-29 plan

The user next reports `SplashActivity` class-declaration navigation. Native
definition-to-references requests reach the language adapter, which fails them.
The identical admitted backend's direct probe returns 32 workspace references
plus a compiler scratch `file:///dummy.kt` reference. Resolving that non-existent
location aborts the entire canonicalization batch. The method-only checks above
did not cover this case; their successful receipts do not close this incident.

The plugin owns the correction: filter reference results through its existing
imported source-view ownership map before emitting project URIs. Keep semantic
results, current document/model guards and separate dependency-definition
admission. No Kotlin parser, symbol-name fallback or dummy-path special case
belongs in the generic host. Add negative ownership and real-class regression
checks, then pin verified LSP 0.3.7 and deliver a freshly signed canonical local
installation. Acceptance requires the native multiple-reference picker, selected
source opening and class-use-to-definition route with logs and unchanged business
hashes. The plugin's Android acceptance document contains the staged plan;
local evidence is under `boost-class-nav-20261029` in the existing case root.

The LSP 0.3.7 candidate passes all 12 plugin tests, typecheck, deterministic
packaging and native inspection. Its 4,649,739-byte archive SHA-256 is
`ec3e7899064ca67055dcc71370850026cf46110ca919b29d55fda199963db129`.
The real Kotlin probe retains all 32 valid workspace locations exactly, and
`ProcessStateMonitor.kt:37` resolves to `SplashActivity.kt:60`. The host pins
these exact bytes and removes the superseded production archive. No host
navigation behavior or compiler component changes. Final installed native
class-picker and reverse-definition acceptance are still required.

Host typecheck, all 1,350 script tests, production frontend build and the exact
LSP package's isolated activation/projection/review checks pass. Focused native
marketplace admission, sealing and startup-upgrade tests pass 11 tests; one
unrelated live-network test remains intentionally ignored. No Git-domain code
changes. The package correction itself is LSP commit `5e530ec`.

### Installed class-reference acceptance

Host code revision `2b5192ffe4cb0767b8480532ace5a2fc56394f71` is freshly built,
whole-bundle ad-hoc signed and strict/deep verified. Its executable SHA-256 is
`14c0cf77163455f69f5ffe591fcb3fbea3fd4172ba0fff192fc4f2ce4bfc2509`.
Exact Android 0.6.2 / LSP 0.3.7 startup health checkpoints and rendered-shell
smoke pass before canonical installation. Both stored-icon launches report
frontend readiness; the reopened installed process is PID 9501, session
`session-1793254785418-9501-0`. App-root inode 203606126/device 16777234 is
preserved, with verified ZIP-only backup and no stale icon-entry removal needed.

The accepted archive is
`target/release/bundle/macos/Asterlyn-0.1.22-2b5192f-macos.app.zip`,
25,215,069 bytes, SHA-256
`e788fbd3b68ba03a77ff8f8b482e048a008fa6fd877ddb2545fc7fd11b69a67c`;
its complete archive CRC passes. Initial local signature-receipt parsing assumed
`Sealed Resources=` whereas codesign emits `Sealed Resources version=`. Signing
and verification themselves exited successfully; the corrected parser receipt
retains that first assertion failure and the accepted strict result.

The installed session imports 25 modules in 22,498 ms (event 88) and reaches
`workspace.ready` at event 91, 304,727 ms after the model attempt starts. Actual
Command+left-click at `SplashActivity.kt:60` requests a definition then references
(95/96) and presents 32 semantic locations (98), without the scratch location.
The accessible picker exposes `Choose a reference (32)`, a labelled filter and a
selected result. Filtering by `ProcessStateMonitor` and pressing Return opens the
saved source at `ProcessStateMonitor.kt:37` (99/100), with the exact line visibly
selected. Command+left-click on that class use returns to saved
`SplashActivity.kt:60` (104/105/106), again with the declaration visibly selected.
This closes both declaration-to-usages selection and use-to-definition paths;
no F12/Ctrl-only substitute is used for these Command gestures.

Through event 106, no post-readiness backend failure, plugin termination,
quarantine or protocol/resource-limit event occurs. The expected initial
`android-indexing` response and stale recent-directory failures are retained,
not described as zero session errors. `SplashActivity` still has 28 existing
diagnostics, including unresolved generated binding symbols; this class-reference
fix does not repair generated Android bindings or claim all diagnostics are gone.
The three sampled business-source hashes are unchanged and boostCleaner is
Git-clean. Both exact installed plugins remain enabled, active and known-good
with no pending replacement. The directly probed Kotlin adapter bytes match the
checksum-covered backend in this package; the compiler component is unchanged.

The 65 preparation samples peak at 1,805,456 KiB aggregate descendant RSS;
isolated plugin helpers together peak at 33,168 KiB. This is a local sampled RSS
observation, including shared pages, not private memory or a long-session leak
guarantee. The native reference request records 2,656 ms; the standalone semantic
probe records 1,129 ms for references and 4 ms for the reverse class definition.
Cold preparation remains about five minutes. Kotlin's upstream reference search
does not include a complete Java-usage graph, and generic error feedback for
other adapter failures remains a known limitation.

Evidence is retained locally in `boost-class-nav-20261029`: before/after semantic
and native results, package/backend identity, runtime identity, tests, signature,
archive, plugin health, installation, source hashes, resource samples and
`ui-and-log-acceptance.json`. No raw local logs are committed or uploaded.
There is no remote push, tag or Release for this fix.
