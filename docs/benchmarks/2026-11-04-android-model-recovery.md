# Android model recovery acceptance — 2026-11-04

Plan: [selection synchronization and model recovery](../engineering/2026-11-04-android-model-recovery-plan.md). Machine-readable receipt: [JSON](2026-11-04-android-model-recovery.json).

## Delivered behavior

Fresh Android task evidence repairs obsolete persisted Run preferences; late restoration cannot overwrite a newer user choice. The host observes declared model-input/selection identities even after model failure. Changed inputs revoke stale results and notify only the owning actor. The adapter preserves document overlays, coalesces invalidations and retries only explicitly transient model failures within a finite budget. Unchanged terminal errors do not run Gradle repeatedly.

Selected-variant, missing dependency-variant and ambiguous dependency-variant failures now have distinct categories. Native JSON-RPC preserves only fixed safe failure codes, enabling actual adapter retries without exposing raw errors. Debug-only bounded identifiers explain the requested and available variants; ordinary logging excludes that context. SDK, process permissions, server distributions and dependency authorities remain unchanged.

## Verification

- Host: 1,441 script tests, 173 native library tests (3 opt-in ignored), 37 language-service process-fixture tests, and the production native actor with the actual packaged Android adapter (transient model error → retry without notification → precise permanent error). Type checks and production/native builds pass.
- Android Gradle: 79 tests, type check/build, canonical native admission and byte-identical repeated package build.
- LSP: 32 tests, type check/release checks, canonical admission, inspector → isolated helper → desktop contribution activation, and byte-identical repeated package build.
- Existing boostCleaner configuration imports 25 modules. An explicit obsolete variant is rejected with the exact `:app`/requested/available context only in debug mode. Source files/configuration are not edited for fault injection.
- Exact LSP 0.3.14 archive: deliberate model rejection → input invalidation → fully ready, unsaved overlay preserved, 69 references and cross-module definition resolved, source hashes unchanged, adapter shut down normally. Cold preparation after receiving the model: **215,617 ms**; peak sampled descendant RSS: **1,879,088 KiB**. This is not end-to-end desktop startup or physical memory measurement.
- Final installed native app: F12 on `GlobalConfigNew` opens **54** references with imports excluded. Refreshing Gradle tasks succeeds in **11,126 ms** (13,676 tasks); preference becomes `cleanx103Debug`. F12 still opens 54 references afterward. Only one model acquisition occurs across startup, repeated lookup and unchanged task refresh; zero degraded events in the accepted session.
- Chromium/WebKit rendered Git blame checks pass for the concurrent fix preserved in the installed build. No LSP UI styling changed. Native keyboard access and result chooser were verified through accessibility; logs provide model/task evidence.

## Local delivery and limits

Host product commit `f8ed533`, Android Gradle **0.6.4**, LSP **0.3.14**. The artifact also preserves the three concurrent Git blame files recorded by digest in the JSON receipt; those edits are excluded from this task's commits. Its dirty build marker reflects that deliberate combined snapshot and a dependency symlink.

Strict complete-bundle ad-hoc signing, exact-package activation/known-good checks and canonical Contents-only replacement pass. Installed executable SHA-256: `0f0f70f337b91f3cea566460f52d51f8144bacb9410c19f43e52219e8500db00`. The installed root inode remains `203606126`. Both stored-icon-bookmark launches reach frontend readiness (PIDs 59826 and 59929). The signed accepted artifact is retained as a ZIP; previous installations are ZIP backups, with no unpacked application backup or global LaunchServices reset.

The first 180-second cold probe timed out while compilation progressed and is not counted as acceptance. Native integration also exposed the previously masked model error code; the serialization boundary was corrected and tested before final installation. Cold indexing speed and long-running memory behavior remain separate optimization work. Unchanged terminal/environment failures wait for new inputs or explicit restart. Stale recent-project directory validation errors are recorded separately; no Windows/Linux runtime or remote publication is claimed.
