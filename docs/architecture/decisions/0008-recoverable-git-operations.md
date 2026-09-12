# ADR-0008: Reviewed and recoverable Git operation lifecycle

- **Status:** Implemented for merge, cherry-pick, rebase, and bounded squash
- **Date:** 2026-09-12

## Context

Asterlyn's existing checked commit, tracked-file revert, branch, fetch, update, and push paths use
literal arguments, canonical repository roots, narrow policies, precondition checks, and canonical
post-operation refresh. That foundation is suitable for bounded mutations that complete in one
command.

Merge, rebase, cherry-pick, and squash are different. Conflicts and pauses are expected states;
users must be able to inspect files, restart Asterlyn, continue, skip where Git permits it, or abort.
External Git processes may also change refs, the index, or worktree while a confirmation dialog is
open. Treating these operations as a button followed by a generic command error would be unsafe and
would leave the frontend inventing repository state.

## Decision

Introduce a product-neutral Git operation capability and an application-level
`GitOperationCoordinator`. Every multi-step mutation follows this lifecycle:

```text
inspect -> prepare reviewed plan -> confirm -> execute
                                      |        |
                                      |        +-> completed
                                      |        +-> conflicted/paused -> continue | skip | abort
                                      |        +-> uncertain -> reconcile, never retry automatically
                                      +-> stale plan -> reject and prepare again
```

The prepared plan contains the canonical repository identity, operation kind, start `HEAD`, target
objects and refs, required cleanliness policy, affected-root policy, allowed action set, and an
opaque confirmation token derived from those preconditions. Execution reopens the repository and
revalidates every precondition. User-visible labels never substitute for exact object IDs or full
refs.

An `OperationSnapshot` is a query model rather than parallel repository truth. It reports the
detected operation kind, phase, original and current objects where Git exposes them, conflict file
identities, progress summary, and currently permitted actions. It is rebuilt from Git refs, index,
worktree, and operation metadata after every action and on application startup. Asterlyn does not
create a second database that claims an operation succeeded.

The application coordinator owns per-canonical-root mutation serialization, cancellation policy,
task supervision, and read-model invalidations. Tauri command handlers validate transport data and
delegate to the coordinator. Pure Git mutation methods cannot rely on a lock that exists only in a
Tauri command.

Cancellation is cooperative before a mutation begins. Once Git may have changed repository or
remote state, cancellation produces an uncertain outcome and forces reconciliation; Asterlyn never
automatically repeats or rolls back an externally visible Git command. Abort and skip are explicit
Git operation actions, not cancellation shortcuts.

## Initial operation order

1. Merge establishes conflict discovery, continue where required, and abort.
2. Single and multi-commit cherry-pick add continue, skip, and abort over the same state model.
3. Rebase adds reviewed upstream/onto plans and restart-safe progress.
4. Squash is implemented as an explicitly reviewed history-rewrite workflow only after rebase and
   force-with-lease evidence is mature.

The first conflict UI may list and open conflicted files before editable three-way resolution is
available, but its state and actions must already use this lifecycle.

## Implemented boundary

R4 implements the lifecycle with system Git as the only durable operation store. The public query
model is rebuilt from worktree-specific Git metadata, index stages, current refs, and `HEAD` during
startup, refresh, mutation completion, and watcher reconciliation. Asterlyn-created Merge,
Cherry-pick, and Rebase commands use exact reviewed object IDs; a non-zero Git result that leaves a
matching operation marker is accepted as a paused observation rather than misreported as an
ordinary failure. Continue, Skip, and Abort are derived from the reconstructed kind and unresolved
index state.

Squash is intentionally non-interactive and bounded to at most 1,000 commits after a selected
first-parent ancestor. It creates one commit from the reviewed `HEAD` tree and message, then updates
the checked-out branch only if that ref still equals the reviewed old `HEAD`. It does not run reset,
rewrite another branch, or automatically push rewritten history.

Text conflict resolution is bounded to four MiB per side. The revision token covers the path's base,
ours, and theirs stage objects plus current worktree bytes. Before staging, the core rechecks that
token and rejects absolute, ambiguous, escaping, or symbolic-link paths; afterward it verifies the
stage-zero blob. Binary and over-limit conflict editing is not claimed. Resolving a conflict returns
only tracked state plus the operation snapshot and cannot trigger a complete history/ref read.

Pre-start cancellation is checked both before and after read-only plan revalidation. Once system
Git starts, Asterlyn does not terminate or retry a local mutation because repository state may have
changed; explicit Abort is the recovery action when Git exposes it. Tests cover restart recovery,
stale `HEAD`, changed conflict content, dirty, detached and unborn states, initialized submodule
identity, pre-start cancellation, Merge continue/abort, Cherry-pick order/skip/continue, Rebase
continue/abort, and exact-lease Squash.

## Invariants

1. System Git remains the canonical write implementation.
2. All process invocation uses argument arrays with non-interactive, credential-safe policy.
3. A prepared plan cannot execute after its exact refs, objects, index/worktree preconditions, or
   repository identity become stale.
4. Conflict and paused states are successful observations, not generic command failures.
5. Continue, skip, and abort are available only when the current `OperationSnapshot` permits them.
6. An externally changed ref is never rolled back by Asterlyn.
7. An uncertain result is reconciled and shown to the user; it is never retried automatically.
8. Mutation outcomes declare invalidated status, ref, history, remote, and operation slices.

## Consequences

- Complex Git workflows share one safety and recovery model.
- The operation coordinator becomes an application service rather than Tauri transport logic.
- More typed models and integration fixtures are required before the first merge button ships.
- Conflict editing can evolve independently behind the operation/file identity contract.
- Simple existing operations can migrate to the coordinator incrementally without changing their
  proven Git command semantics.

## Revisit triggers

- System Git cannot expose reliable state for a required operation on the oldest supported version.
- Worktrees sharing one Git directory require a broader lock identity than canonical worktree root.
- Cross-process coordination becomes necessary after measured external-tool races.
- Interactive rebase requires a supervised sequence-editor protocol beyond the initial reviewed
  squash workflow.
