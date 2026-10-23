# Structured diagnostics hardening plan

- **Status:** Implemented and manually accepted, 2026-10-23; grouped commits authorized.
- **Baseline:** `5b3e03f`, clean working tree.
- **Owner:** Native application diagnostics; domain crates remain independent of Tauri and logging persistence.
- **Goal:** Preserve useful local diagnosis while making logging private, bounded, recoverable, concurrent, and accurate.

## Ordered implementation

| Phase | Priority | Deliverable | Acceptance |
| --- | --- | --- | --- |
| D1 | P1 | Field-aware secret filtering and bounded event preparation | Basic/Bearer headers regardless of case, URL user info, sensitive object keys and query values never survive synthetic-secret tests; deep/wide values are bounded before serialization. |
| D2 | P1/P2 | Recoverable, isolated asynchronous persistence | Log directory failure does not prevent startup; independent sessions cannot rotate each other's files; a failed rotation/write recovers; queues, retries, retention and flush waits have finite limits; health and dropped counts remain observable. |
| D3 | P2/P3 | Accurate ordering and operation lifecycle | Writer assigns monotonically increasing output sequence; plugin activation failures include validation failures; callback delivery failure cannot be recorded as completion; explicit async trace propagation and lifecycle tests. |
| D4 | P2 | Frontend handled-error coverage and correlation | User-visible handled errors and desktop command failures persist with bounded metadata; no command arguments or arbitrary rejected object bodies are logged; diagnostic bridge failure cannot recursively report itself; related records carry a correlation ID. |
| D5 | P3 | Build/session identity, operational guide and delivery | Build identity distinguishes same-version builds; native-ready/frontend-ready and shutdown milestones have precise semantics; documentation describes file discovery, health, loss, crash limits and compatibility; focused/full checks, fresh signed package and installed-log acceptance recorded. |

Implement and verify D1 before D2, then D3–D5. The phases were completed and verified in the working
tree. After manual acceptance on 2026-10-23, the user authorized separate commits for diagnostics,
macOS installation recovery, and Diff connector fixes. Remote publication remains outside this request.

## Design constraints

1. Keep native JSONL and local-only operation. No plugin filesystem logging authority or automatic uploads.
2. Store process output, source, callback bodies, command arguments and environment outside this diagnostic stream. Structured fields are bounded metadata; arbitrary frontend objects are summarized by type/code.
3. Use a single bounded writer per launch, with separate session files and exclusive session ownership. Keep an explicit total retention budget; never delete a live writer's files. Legacy shared logs remain readable during migration.
4. Disk I/O and rotation run on the diagnostics thread. Reserve queue room for error events, retain a bounded retry buffer, and expose all rejected/evicted events in health counters. No unbounded waits or silent permanent disablement.
5. Preserve event timestamps and root trace IDs, assign output sequence at the writer, and carry trace context explicitly across worker boundaries. Thread-local context is only for synchronous scopes.
6. Startup continues if the preferred directory is unavailable. Degraded operation uses bounded memory and a body-free stderr notice, retries persistence, and exposes health without pretending that a directory path guarantees a healthy sink.
7. Shutdown and panic may request a bounded drain. A fatal kill/power loss can lose queued records; do not promise synchronous durability or full process termination from a cancellation request.
8. Keep new user UI out of this change. Logs and existing diagnostic commands are the acceptance interface.

## Verification and evidence

- Focused Rust tests: credential variants, Unicode/depth/width budgets, inaccessible directory recovery, injected rotation failure, independent writers and retention, concurrent output ordering, bounded queue/drop behavior, flush/shutdown, trace/lifecycle semantics.
- Frontend tests: handled error reporting, object privacy, ingress bounds, bridge rejection containment, command correlation and original-error preservation.
- Required repository checks: frontend type check/build, script tests, relevant Rust application/Git tests and formatting.
- Native delivery: build current source, sign the complete bundle, strictly verify, run native acceptance, archive/hash, then use the canonical installer from `local-build.md` for verified ZIP backup, atomic Contents replacement and icon quit/reopen acceptance. Compare accepted/installed executable and inspect the new session log. Use logs rather than screenshots for behavior evidence; retain the existing accessibility smoke check for rendered startup.
- Record functionality, performance/resource bounds, accessibility impact and remaining limitations below. Cross-platform execution evidence must not be inferred from macOS tests.

## Implementation record

- Planning: audit identified seven defects/gaps; original 3 tests and 4 temporary reproduction probes established the baseline. A 1,408-line retained-log sample contained 5 output-sequence inversions.
- D1: complete. Bounded metadata traversal precedes serialization; synthetic Basic/Bearer/header/query/URL and sensitive-key tests pass, including Unicode and a URL truncated before its `@`.
- D2: complete. Background queue/retry bounds, recoverable directory/rotation failures, lifetime owner locks, registration/retention coordination, health counters, bounded drains and isolated session files implemented. A failed partial-line rollback is retried before appending further JSON.
- D3: complete. Writer-only output sequence, separate trace counter, operation terminal-event guard, activation validation failure coverage, callback completion after event publication, and explicit remote-worker trace scope implemented.
- D4: complete. Framework-independent bounded reporter, handled app/context-menu errors, command failure/slow-operation coverage, optional additive context for four plugin/task commands, ingress bounds, rate limits, cumulative health counts and original-error preservation implemented. Frontend architecture gates retain their original dependency rules.
- D5: complete. Build identity, readiness/shutdown semantics, ADR and operations guide updated; signed current-source bundle, native rendered-shell smoke, archive, recoverable installation replacement and installed-log lifecycle/correlation acceptance passed. See the linked evidence below.

### Validation so far

- Rust application library: 154 passed, 3 pre-existing tests ignored (2 OS watcher tests, 1 live public GitHub fixture test).
- Git crate: 147 unit tests plus 9 integration tests passed; doc tests passed.
- Frontend: type check and production build passed; 1,281 script tests passed, including 4 new diagnostics tests and the existing architecture/protocol gates.
- Failure burst (debug/test build, macOS): 2,000 events submitted in 61.95 ms, 64 retained in the retry buffer and 1,936 counted as dropped; removing the obstructing file restored persistence and preserved a subsequent error sentinel. This is a fault/resource-bound probe, not a production throughput SLA.
- Memory: at most 320 queued events plus 64 retry events, bounded metadata nodes/strings and a 32 KiB final JSON cap. Object/allocator overhead is additional; no claim of a fixed total application heap size.
- Accessibility: no new controls, dialogs, focus changes or user-facing diagnostics entry added; native rendered-shell smoke remains a delivery gate.
- Limits: abrupt kill/power loss may lose queued data; unrecognized secrets in free-form text still require support-packet review; whole Gradle workflows use review/run IDs between command traces; Windows/Linux runtime acceptance and real slow-disk/power-loss tests remain outside macOS evidence.

### Native acceptance

- [Recorded evidence](../benchmarks/2026-10-23-diagnostics-hardening.md) includes the accepted artifact/executable hashes, installed lifecycle/health/correlation evidence, resource sample, and limitations.
- Version remains `0.1.19`. Manual acceptance and grouped commits were authorized on 2026-10-23;
  no version bump, tag, push or publication was requested.
