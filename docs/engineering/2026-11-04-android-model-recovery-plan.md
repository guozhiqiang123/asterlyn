# Android model selection and recovery repair

Date: 2026-11-04. Status: completed for local macOS acceptance; this plan was committed before implementation. Scope: host, Android Gradle plugin and LSP plugin; small verified commits, no remote publication.

## Incident and evidence

Installed host 0.1.25, Android Gradle 0.6.3, LSP 0.3.13; boostCleaner session `session-1793762230786-16269-0`, Android session `language-session-16269-3`.

- 11:21: model acquired (25 modules), then language services ready.
- 13:44:20: `local.properties` written; current flavor is `cleanx103`. Model invalidation/rebuild followed at 13:44:21.
- 13:44:32 and 13:44:42: `model-selection-unavailable`; service became failed.
- 13:44:54 and 13:51:56: task discovery succeeded (13,676 tasks); no subsequent model acquisition or language recovery.
- Persisted preferred Run configuration names an obsolete variant. This is a stale state finding, **not proof of the exact selection passed to the failed worker**. Existing diagnostics conflate missing selected variants and ambiguous/missing dependency variants.

## Invariants

The host stays language/build-system neutral. Gradle/AGP remains authoritative for variants and dependency edges. Never silently substitute another variant for an explicit current choice. Stale task evidence must not authorize an obsolete model selection. Source/build changes revoke old semantic results immediately; they must not be served during recovery. Preserve overlays and existing project edits. No credential, raw Gradle stderr, source text or absolute workspace paths in diagnostics. Detailed module/variant identifiers are bounded, validated, opt-in debug data.

## Steps and gates

| Step | Responsibility | Deliverable / validation | Status |
| --- | --- | --- | --- |
| M0 | all repositories | Commit plans before code | complete |
| M1 | Android Gradle | Synchronize restored/selected Run configuration with authoritative fresh task evidence; prevent stale evidence from selecting a model; asynchronous restore must not overwrite a newer user selection. Test cache invalidation, refresh, changed variants, unchanged variants and disposal. | complete (local macOS) |
| M2 | host | Reconcile declared model state bindings when contributions publish, including refreshed task evidence. Notify only affected live sessions, with bounded coalescing and no cross-window invalidation. Test stale-result rejection and recovery notification. | complete (local macOS) |
| M3 | LSP | Separate model failure/re-evaluation from JVM crash recovery. Recover on authoritative input/selection changes; bounded transient retries only, terminal/security failures do not loop. Preserve documents, cancellation and shutdown ownership. Process-level failure → invalidation → recovery tests. | complete (local macOS) |
| M4 | all repositories | Distinguish selected/dependency variant failures; correlate model attempt, invalidation/recovery cause and generation. Validate privacy, framing and bounded records, tracing disabled/enabled. | complete (local macOS) |
| M5 | integration | Build/inspect exact plugin artifacts, host checks and focused native tests; signed package, canonical installation and two icon-bookmark restarts; verify boostCleaner model acquisition/navigation/recovery from logs. Record timing, memory, limitations and commit evidence. | complete (local macOS) |

Prefer deterministic fixtures for deliberate invalid selections and configuration transitions; do not edit boostCleaner's user-owned flavor/configuration merely to manufacture the incident. Run real-project read-only model/navigation probes against its existing configuration. Release versions are changed only as needed for new immutable local plugin identities; no tag/push is included.

## Acceptance record

Implementation and evidence will be appended per step. Do not mark native or real-project acceptance complete based only on unit tests or task-discovery success.

- M0: plans committed in all three repositories before implementation (`fbcbc0c`, `627f986`, `4221f81`).
- M1: Android Gradle `ee4dd75`; 77 tests, type check and build passed. Fresh discovery reconciles the durable preference; async restore/write races are serialized.
- M2: host adds an optional generic model-input observer, one outstanding background probe per actor at a two-second interval. It compares bounded input/declared-selection identities even without a successful model lease. Changes revoke old results and notify only that actor; unchanged failures never execute analysis. `cargo test -p asterlyn-language-service`, `cargo check -p asterlyn`, and a production-actor Node fixture (failure → changed selection → ready → navigation with one document open) passed. Local native/package acceptance remains M5.
- M3: LSP `78fe3ac`; 32 tests/typecheck passed. Coalesced model invalidations, finite stale/busy retries, terminal no-loop behavior, preserved overlays and host-monitor/source-refresh separation.
- M4: distinct selected/dependency variant codes and bounded debug-only context added through the Java worker, plugin reader, native framing and host log. Native errors now retain fixed machine-readable categories for recovery. Read-only boostCleaner current variant succeeded (25 modules); explicitly obsolete variant failed with exact debug context and ordinary-mode privacy checks. These probes do not establish the exact historical failed input.
- M5 packaging: Android Gradle 0.6.4 (4,790,633 bytes, SHA-256 `5897de800ced074eecedbc8f4ecf7ad8dcb7f82a983d4fa0dbb7485efc01f054`) and LSP 0.3.14 (4,667,877 bytes, SHA-256 `51760a635e03a265f12820cd127c7e3d696c7b48544591ea67765eccf2c81c56`) pass canonical native admission. Host integration gates: 1,441 script tests, 173 native library tests (3 opt-in ignored), complete language-service process-fixture suite and inspector → isolated-helper activation pass. First real-project recovery probe exhausted its 180-second cold-cache deadline while module compilation was still progressing; it is not counted as success. Final package recovery/native installation remain in progress. Unrelated concurrent Git blame edits are excluded from this change and native packaging uses an isolated checkout.
- M5 integration correction: installed native logs exposed a second boundary problem: `reply_to_server` discarded even normalized model failure codes. Preserve only a closed set of fixed model categories in replies; arbitrary/raw/credential-like errors still receive the generic message. A production native actor + exact packaged Android adapter test now proves `model-inputs-changed` retries without any input notification, then a precise terminal selected-variant error stops retries. The earlier package-only RPC tests could not detect that host serialization gap.
- Final package-only real-project recovery passes: failed selection → new input → ready, preserved unsaved overlay, 69 references, cross-module definition, unchanged source files and normal adapter shutdown. Cold cache preparation took 215,617 ms; peak sampled descendant RSS 1,879,088 KiB. This timing excludes the separately measured Gradle model import and does not claim an indexing performance improvement.

- M5 final: [permanent acceptance receipt](../benchmarks/2026-11-04-android-model-recovery.md). Final native actor retains safe retry categories, installed executable is verified, both icon-bookmark starts pass, actual F12 yields 54 filtered references before/after a successful task refresh, durable selection is current, and unchanged refresh causes no model rebuild. Concurrent Git blame changes are preserved by digest in the combined artifact but excluded from these commits. No remote publication or cross-platform runtime claim.
