# Adaptive language-analysis resources and terminal progress

Date: 2026-11-04. Plan precedes implementation.

## Evidence and outcome

FilesRecovery's `launcher-module-rebuild` worktree builds successfully with its Gradle JVM configured for a 6 GiB maximum heap. Its 19-module LSP model loads in 17,262 ms. The independent KAPT bridge reproduction fails in `:app` after 33,545 ms with `OutOfMemoryError: Java heap space`: the plugin hard-codes a 768 MiB compiler heap. Background ABI failure leaves a 5/19 sources progress snapshot and `java-analysis-awaiting-kotlin`; the footer continues timing although compiler work has ended. Evidence: `/tmp/asterlyn-filesrecovery-long-index/diagnosis.json`.

The completed change must allow larger projects within an explicit resource budget, preserve successful cached work, classify exhausted compiler failures and finish the progress state. Project sources, dependencies and Gradle settings are not changed. Host ownership remains generic; Android/Kotlin compilation policy remains in the independent LSP package.

## Stages

| Stage | Implementation | Verification |
| --- | --- | --- |
| R0 | Record host/plugin plans before code; commit the plugin documentation as required by its AGENTS.md | Scoped status/diff; preserve all unrelated pending work |
| R1 | Native generic weighted memory admission shared by language sessions, bounded cancellable FIFO waiting, scoped leases, process-tree memory observation and per-project Auto/custom memory preference | Accounting/fairness/cancellation/oversized-request tests, safe persistence, machine sizing fallback, native wire tests |
| R2 | Pass host policy through the existing packaged initialization boundary and use fixed private resource-reserve/release messages; expose Auto and supported project memory choices in language status | Generated native bindings, current-workspace authorization, localized accessible controls, restart only the current project's language sessions |
| R3 | LSP chooses initial compiler heap from input size and host budget; one OOM-specific escalation within the project ceiling; heavy jobs consume weighted leases; retain successful immutable artifacts and reuse the same materialized inputs during retry | Deterministic low-budget/OOM/cancel tests, concurrency and cache tests, unchanged artifact identity when only memory settings change |
| R4 | Separate running, waiting, partial-ready and terminal ABI failure. Emit fixed metadata for job start/end, heap, cache, retry and failure. Stop elapsed time on settled failure and show an actionable resource error without treating it as a broken project | Adapter/native/frontend recovery and stale-event tests; no source, compiler argv or raw stderr in normal logs |
| R5 | Build/inspect a fresh immutable LSP package; real FilesRecovery cold/warm indexing and navigation; signed independent native artifact and canonical local replacement | Exact digest/known-good activation, actual current variant, completion or explicit bounded failure, restart/cache behavior, memory sample, two icon-bookmark starts |

## Resource policy

- Auto derives a conservative total language-analysis budget from physical memory, with a portable fallback. It is an admission budget rather than an OS sandbox or a guarantee that JVM non-heap memory equals `-Xmx`. Observe actual owned process trees and delay new work under pressure. Keep the isolated descriptor helper's separate security limit unchanged.
- Each project can retain Auto or an explicit compiler maximum. Validate supported values against the host budget and directory identity; changing this preference does not broaden execution authority or alter project files. Heap values are ceilings, not eager allocations, and cannot be copied from Gradle to every JVM indiscriminately.
- The plugin reserves compiler heap plus overhead before each attempt and releases the lease in `finally`; native session termination releases all remaining reservations and waiting tickets. New windows share one pool. Oversized requests and expired waits produce fixed actionable failures, never an infinite spinner.
- Initial heap and parallelism are decisions of the plugin's current source/dependency workload. Escalate only a positively classified compiler OOM, at most once, under the user/Auto ceiling. Queue a larger retry without retaining its previous lease. Cancellation, compiler semantic errors and source changes do not trigger a memory escalation.
- Completed modules retain the existing content-addressed cache validity rules. Memory policy does not change semantic artifact keys. A retry reuses the captured sources and argument file, and never reruns already successful jobs. Source edits, tools, variant and dependency identity remain authoritative invalidators.
- Reusing Gradle-produced project classes requires authoritative variant/source/output freshness; file timestamps alone are insufficient. This milestone improves existing verified artifact reuse and retry scheduling. It must not add an unsafe shortcut that serves stale classes. Further producer-certified output reuse remains an explicit follow-up, separate from this incident's resource/state repair.

## Delivery and scope

No remote tags, pushes or releases are authorized by this task. Plugin implementation stages follow its scoped commit rules. The host contains earlier uncommitted task-sync, project failure tips, Git blame and Changes-menu work; do not stage or revert them. Commit only this task's explicit, independently reviewable stages where required. Native installation uses an independent accepted bundle to avoid concurrent build/verification interference, and the canonical installer retains ZIP backups and the installed application root identity.

## Execution record

R1–R4 implemented. Native resources are business-neutral in `asterlyn-language-service::application::resources`, with platform observations in `asterlyn-process::memory`. One manager-wide weighted FIFO pool covers language windows. Queue tickets and grants are owner-scoped, cancellation-safe, bounded to 120 seconds; actor termination releases all remaining ownership. The isolated descriptor helper security cap is unchanged.

The native project setting is keyed by canonical directory identity, stored atomically outside project files and exposed through the current-workspace command boundary. The language-status panel offers Auto and supported ceilings; saving restarts only this runtime's project services. New sessions in other windows read the persisted setting. Active sessions retain their reviewed snapshot until restarted. Policy changes do not invalidate execution consent or immutable artifact keys.

On this 16 GiB Mac: Auto shared admission budget 8 GiB, compiler maximum 4 GiB, supported project choices 1/2/4/6 GiB. The plugin starts small or medium closures at 768/1024 MiB and large closures at 2048 MiB, clamped to the current ceiling. One positively classified heap OOM may retry at the ceiling; ambiguous exit137, compiler errors, cancellation and timeout never trigger a memory escalation. A 512 MiB overhead reservation accompanies each compiler. Actual group RSS is sampled outside actors and delays new admission when it exceeds reserved usage. This is a soft admission policy, not an OS sandbox or a promise about exact JVM RSS/available system RAM.

Terminal ABI failure is retained for its source revision. Same-buffer reopen does not endlessly retry a failed generation; changed inputs/model or an explicit retry may recover. Partial Java remains usable while the Kotlin preparation failure is settled, timers stop, and resource exhaustion emits one localized actionable error tip per episode. Normal logs contain fixed categories; opt-in tracing adds bounded heap, attempt, cache, duration and admission metadata, never raw stderr/source/compiler argv.

## Verification

- Native language service: 42 actor/unit tests plus 3 auxiliary integration tests pass with the explicit Node fixture. Process crate: 6 tests pass. Type checks, frontend build and native compile pass. Generated language bindings drift check and 41 focused desktop protocol/lifecycle/failure-copy checks pass. Chromium and WebKit verify waiting, terminal partial failure, resource selection, keyboard focus, timer cleanup and inherited 12px controls. Private native resource channel is exercised through a real Node actor.
- Plugin: 36 tests, type check, native archive inspector and isolated helper-to-host activation pass. Final local package **0.3.16**, 4,669,338 bytes, SHA-256 `f5d4d19781bd7e19e3351fd8b538b66d7e8b1e32f6478e93c93ec637bf309b77`. Intermediate locally admitted 0.3.15 remains immutable and is superseded. Scoped commits follow the plugin plan-first requirement; no remote publication.
- Real FilesRecovery worktree, selected `:app / pr061826BillingFsiLauncherDebug`, 19 modules: old 768 MiB probe failed with heap OOM after 33,545ms. Adaptive source preparation completed in 123,988ms. Cache-enabled cold/warm source preparation measured 128,807 / 480ms; warm used 19 hits and zero compiler launches. Raising only the ceiling to 6 GiB also retained all 19 hits with zero compilation (480ms).
- Full packaged backend cold: Ready 172,905ms; Kotlin definition MainActivity-to-BaseActivity 368ms; peak sampled owned RSS 2,103,216 KiB. Same package/model/cache reopen: Ready 35,144ms, definition 321ms, 19 cache hits, peak 2,024,912 KiB. Zero stderr and unchanged project sources in both runs. These measurements include Java/Kotlin backend startup and are distinct from ABI cache time.
- Installed native 0.3.15 smoke also reached Ready in 175,892ms with actual generic admission grants in the log; a native reference request returned 32 results in 332ms. Final 0.3.16 adds the tested override boundary: a 999-source closure may start at 1 GiB and retry at an explicitly selected 6 GiB, rather than stopping at a doubled 2 GiB. Final signed artifact and installation receipts are recorded below.

Evidence scratch: `/tmp/asterlyn-adaptive-resources/`; immutable accepted native candidate: `.artifacts/adaptive-lsp-resources-final-axaa7l4r/`.

## Limits and follow-ups

Native platform acceptance is macOS arm64; portable code and fallback policies do not imply Windows/Linux runtime acceptance. Existing long-lived Kotlin and Java server heap profiles remain separate from the adaptive compiler ceiling. Reusing Gradle project classes still requires producer-certified freshness, and broader incremental semantic JVM persistence remains outside this repair. The shared pool covers language work, not all user applications or the Gradle daemon. Measurements under one real project's workload do not establish a universal latency or memory guarantee.


## Final local delivery

R5 complete. Final LSP 0.3.16 was admitted and marked known-good by the production isolated helper. The independent signed bundle at `.artifacts/adaptive-lsp-resources-final-axaa7l4r/Asterlyn.app` passed strict bundle verification and exact-package frontend startup before canonical installation. Installed executable SHA-256 `f248c5ff8a830da8cb80d6b70bca548941f94438dfa8f88338a5470d79cc08bd` matches the accepted signed candidate. Installer receipts record two successful icon-bookmark starts with frontend readiness; the application root was retained and the previous installation is a ZIP backup.

Final installed session `session-1793792411810-47229-0` exercised native project memory selection at 6 GiB, atomic persistence, service restart, and restoration to Auto with no residual override or repeated project approval. After the reset and reuse of already completed modules, session `language-session-47229-5` reached Ready in 139322ms; this is a lifecycle/recovery measurement, not a fresh cold-start benchmark. Resource admission/compiler metadata is in the log. Debug tracing was switched off after acceptance. Receipts and benchmark JSON copies are alongside the signed artifact; `native-acceptance.json` captures final Ready and the resource-setting outcome.

Plugin scoped commits: `7722c9a` (plan), `abd9c76` (adaptive compiler/admission/terminal failure), `7b9c7d2` (packaging/acceptance tools), `b56232d` (use the actual reviewed ceiling for the single OOM retry). The user accepted staged commits after local validation. Host commits are scoped to language-service diagnostics, resource policy, UI integration and the coordinated plugin packages; unrelated pending work is not staged or reverted.
