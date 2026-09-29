# Architecture audit remediation plan

- **Status:** Completed locally on 2026-09-29; cross-platform installed-package checks remain release gates.
- **Baseline:** `2b225f2`, with a clean working tree before this plan was added.
- **Scope:** Close the credential, workspace-mutation recovery, terminal-flow-control, lifecycle, and
  test-contract findings from the 2026-09-28 architecture audit. This is corrective hardening, not a
  feature expansion or framework migration.

## Outcome

Asterlyn is ready to resume ordinary capability work only when all of the following are true:

1. Saving an HTTPS token cannot invoke or persist through an arbitrary repository-configured Git
   credential helper, and no credential-helper diagnostic can echo submitted secret material.
2. Every retained workspace-mutation recovery record has a visible, restart-safe resolution path;
   copy and move can be rolled back or finalized, while an uncertain Trash operation can be
   inspected and explicitly acknowledged after authoritative reconciliation.
3. Terminal output has a bounded native-to-WebView queue, coalesced delivery, explicit truncation
   semantics, and no silent startup loss.
4. Canonical workspace identity is enforced at the terminal-session boundary and the complete Rust
   workspace test gate is green on macOS.
5. Every window-global listener and observer created during startup has an explicit disposal owner.

## Non-negotiable rules

1. Git and the authorized filesystem remain the only domain sources of truth. Recovery UI presents
   evidence and invokes exact recovery operations; it does not speculate about file or Git state.
2. Secret-bearing commands never return raw child stderr, stdout, arguments, environment, or helper
   configuration to the frontend.
3. Recovery actions revalidate the canonical workspace, recovery identifier, recorded phase, current
   path identities, and fingerprints under the shared workspace write lock.
4. Terminal flow control is bounded at the producer/transport boundary, not only by xterm scrollback.
   Dropped output is reported once with a typed event and a monotonic sequence discontinuity policy.
5. Each phase begins with focused failing/characterization tests and remains independently
   revertible. Protocol changes update runtime validation, the demo bridge, localization, and
   generated command inventories in the same phase.
6. Existing feature ownership and dependency-direction gates remain absolute. No new state is added
   to `AppState`, and `AsterlynApp` receives only composition callbacks and runtime ownership.

## Delivery sequence

### AR1 — Secure credential persistence

**Problem:** `credential.helper` is currently considered safe when any non-empty value is visible to
Git. A repository-local `store --file=...`, shell helper, or unknown helper may therefore receive a
PAT even though the UI promises system credential storage.

**Implementation:**

1. Ignore the configured helper chain for token persistence and discover only supported installed
   platform helpers. Reject shell helpers, `store`, repository-local overrides, empty-reset chains,
   and unknown helpers by never selecting them.
2. Run `git credential fill/approve` with an explicit accepted helper override so a later local
   configuration race cannot substitute another helper between review and execution.
3. Replace raw helper stderr propagation with fixed, typed secret-free failures; clear all temporary
   input/output buffers that may contain credentials on every exit path.
4. Update the authentication copy so it describes the enforced behavior rather than an intention.

**Acceptance:** focused Git tests cover local plaintext and shell helpers, allowed platform helpers,
configuration changes between status and save, helper failure that echoes the token, and successful
secret-free status refresh. Existing remote operations remain non-interactive.

### AR2 — Close workspace-mutation recovery

**Problem:** create/copy/move/Trash execution can retain a recovery manifest, but production code can
only list it. `recoveryId` is reduced to a generic error and there is no inspect, rollback, finalize,
or acknowledge workflow.

**Implementation:**

1. Extend recovery summaries with the minimum evidence required for a user decision: operation,
   source, destination, phase, observed path state, and supported actions. Do not expose host-only
   recovery paths to the frontend.
2. Add exact backend commands:
   - `rollback_workspace_mutation` for recoverable copy/move phases;
   - `finalize_workspace_mutation` when the destination is verified and held source data may be
     removed;
   - `acknowledge_workspace_mutation_recovery` for Trash or manually resolved uncertain states.
3. Revalidate recovery manifests and filesystem identity under `WorkspaceWriteRegistry`; never delete
   a path merely because its string matches a recorded path.
4. Add a feature-owned recovery controller/dialog loaded on project activation and immediately after
   an uncertain outcome. Resolution performs authoritative catalog, document, and working-tree
   reconciliation before reporting completion.
5. Keep recovery records after failed or stale resolution; remove them only after a verified terminal
   state or explicit acknowledgement of an inherently external Trash result.

**Acceptance:** fault-injection tests cover copy verification failure, move source-hold failure,
case-only rename uncertainty, partial batch Trash, restart discovery, stale/tampered manifests,
rollback/finalize idempotency, dirty editor protection, and accepted projection reconciliation.

### AR3 — Bound terminal output end to end

**Problem:** fixed-size PTY reads are emitted one event at a time without an acknowledged queue or
total budget. High-throughput output can saturate Tauri/WebView delivery; startup output beyond the
frontend buffer is silently discarded.

**Implementation:**

1. Introduce one bounded per-session native output pump. Coalesce bytes into delivery frames and cap
   queued bytes and frames independently.
2. When pressure exceeds the queue budget, retain a bounded tail, record the omitted byte count, and
   emit one typed truncation event before the next retained output. Preserve monotonically increasing
   event sequence numbers.
3. Make Tauri event-delivery failure terminate or mark the session transport failed instead of
   ignoring the result indefinitely.
4. Buffer startup output in the same native queue so the frontend no longer has a separate silent
   drop policy. The frontend renders an explicit localized truncation marker.
5. Keep input, resize, close, ownership, and xterm scrollback limits unchanged.

**Acceptance:** deterministic stress tests exercise output larger than the queue, a slow consumer,
hidden terminal output, startup output before `startTerminal` resolves, close during pressure, and
sequence/truncation ordering without unbounded allocation.

### AR4 — Canonical identity and global lifecycle cleanup

1. Make `TerminalSessions::remove_owner_if_root_changed` compare canonical identities or accept an
   explicit canonical-root type. Cover `/var` versus `/private/var` and symlink aliases.
2. Give the bootstrap layer ownership of `ThemedSelectHost` and dispose it through the same pagehide
   lifecycle as `AsterlynApp`; ensure repeated initialization cannot retain duplicate listeners or
   document observers.
3. Add focused tests for idempotent disposal and same-root terminal retention.

**Acceptance:** the formerly failing terminal test passes without platform-specific path assumptions;
window-global lifecycle tests enumerate the themed-select host alongside shell, chrome, dialogs, and
context-menu ownership.

### AR5 — Composition and repository ownership follow-up

This phase is deliberately after the correctness fixes. It does not mechanically split files.

1. Extract the credential capability from `repository.rs` behind a private Git credential service
   whose only public values are secret-free status and typed failure.
2. Move the workspace-mutation recovery presentation into the Files feature runtime rather than
   growing `AsterlynApp`.
3. Record a new non-growing Rust ownership inventory for production files above 1,500 lines and name
   the first cohesive extraction from `repository.rs`.
4. Lower the `src/app.ts` ceiling only when the recovery runtime replaces existing composition logic;
   do not move lines into forwarding wrappers.

**Acceptance:** dependency-direction tests remain green, no feature cross-imports are introduced,
and both oversized modules receive lower or newly enforced non-growing ceilings.

## Validation matrix

Every phase runs its focused tests plus the applicable rows below. AR5 and final acceptance run all
rows.

| Gate | Required result |
| --- | --- |
| TypeScript check | `npm run check` passes |
| Frontend scripts | `npm run test:scripts` passes with new protocol, controller, lifecycle, and stress tests |
| Production build | `npm run build` passes and the main application chunk remains below 500 kB raw |
| Rust formatting | `cargo fmt --all -- --check` passes |
| Rust tests | `cargo test --workspace` passes on the implementation host; platform-sensitive cases run on macOS, Linux, and Windows CI |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` passes where the component is installed |
| Dependency review | npm production audit and Rust advisory audit are recorded; unavailable tools are an explicit release limitation |
| Patch hygiene | `git diff --check` passes and unrelated working-tree changes remain untouched |

## Rollback and evidence

- AR1, AR2, AR3, and AR4 are separate rollback units. A protocol addition may remain unused while its
  matching feature phase is reverted, but no UI may call a partially implemented recovery command.
- Recovery record schemas are versioned additively. Readers fail closed on unknown versions and do
  not delete unreadable records.
- Final acceptance is recorded in a dated benchmark document with test counts, bundle movement,
  terminal stress budgets, recovery fault evidence, and remaining platform limits.

## Completion record

AR1–AR5 were implemented in order. The credential boundary now selects only an installed supported
platform helper; workspace mutation records have restart-safe rollback/finalize/acknowledge paths;
terminal transport is bounded with explicit truncation; canonical root aliases and window-global
lifecycle disposal are covered; and credential policy plus Files recovery presentation have cohesive
owners outside the repository/application composition roots. The Rust ownership inventory records
every production source above 1,500 lines with a non-growing ceiling.

Local validation and remaining platform limits are recorded in
[`2026-09-29 architecture audit remediation evidence`](../benchmarks/2026-09-29-architecture-audit-remediation.md).
