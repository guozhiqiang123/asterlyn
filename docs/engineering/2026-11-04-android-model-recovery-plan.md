# Android model selection and recovery repair

Date: 2026-11-04. Status: planned before implementation. Scope: host, Android Gradle plugin and LSP plugin; small verified commits, no remote publication.

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
| M0 | all repositories | Commit plans before code | in progress |
| M1 | Android Gradle | Synchronize restored/selected Run configuration with authoritative fresh task evidence; prevent stale evidence from selecting a model; asynchronous restore must not overwrite a newer user selection. Test cache invalidation, refresh, changed variants, unchanged variants and disposal. | pending |
| M2 | host | Reconcile declared model state bindings when contributions publish, including refreshed task evidence. Notify only affected live sessions, with bounded coalescing and no cross-window invalidation. Test stale-result rejection and recovery notification. | pending |
| M3 | LSP | Separate model failure/re-evaluation from JVM crash recovery. Recover on authoritative input/selection changes; bounded transient retries only, terminal/security failures do not loop. Preserve documents, cancellation and shutdown ownership. Process-level failure → invalidation → recovery tests. | pending |
| M4 | all repositories | Distinguish selected/dependency variant failures; correlate model attempt, invalidation/recovery cause and generation. Validate privacy, framing and bounded records, tracing disabled/enabled. | pending |
| M5 | integration | Build/inspect exact plugin artifacts, host checks and focused native tests; signed package, canonical installation and two icon-bookmark restarts; verify boostCleaner model acquisition/navigation/recovery from logs. Record timing, memory, limitations and commit evidence. | pending |

Prefer deterministic fixtures for deliberate invalid selections and configuration transitions; do not edit boostCleaner's user-owned flavor/configuration merely to manufacture the incident. Run real-project read-only model/navigation probes against its existing configuration. Release versions are changed only as needed for new immutable local plugin identities; no tag/push is included.

## Acceptance record

Implementation and evidence will be appended per step. Do not mark native or real-project acceptance complete based only on unit tests or task-discovery success.

- M0: plans committed in all three repositories before implementation (`fbcbc0c`, `627f986`, `4221f81`).
- M1: Android Gradle `ee4dd75`; 77 tests, type check and build passed. Fresh discovery reconciles the durable preference; async restore/write races are serialized.
- M2: host adds an optional generic model-input observer, one outstanding background probe per actor at a two-second interval. It compares bounded input/declared-selection identities even without a successful model lease. Changes revoke old results and notify only that actor; unchanged failures never execute analysis. `cargo test -p asterlyn-language-service`, `cargo check -p asterlyn`, and a production-actor Node fixture (failure → changed selection → ready → navigation with one document open) passed. Local native/package acceptance remains M5.
