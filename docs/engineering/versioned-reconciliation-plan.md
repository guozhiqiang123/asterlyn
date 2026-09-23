# Versioned reconciliation implementation plan

## Goal

Replace the current collection of watcher refresh paths with the versioned reconciliation model in
ADR-0012. The work is complete only when the invariants below are enforced by code and tests; a
passing happy-path watcher demo is not sufficient.

Status: **implemented and locally accepted on 2026-09-14** in
`codex/watcher-reconciliation-architecture`, based on `65a8800`. The validation and resource record
is [`2026-09-14 versioned workspace reconciliation`](../benchmarks/2026-09-14-versioned-workspace-reconciliation.md).

## Baseline risks to remove

| Risk | Current failure | Required invariant |
| --- | --- | --- |
| Stale repository read | An older complete snapshot can overwrite a later mutation | A read lease may commit only on its captured repository revision |
| Partial fan-out | Canonical state is fully replaced while only named controllers update | Canonical merge and projection use the same exact slice set |
| Read amplification | Any metadata hint reads status, refs, history, remotes, operation, then untracked files | Read work is derived from requested slices; untracked runs only for `workingTree` |
| Transition overlap | A watcher can publish an intermediate Git mutation state | Internal transitions hold a barrier; pending hints resume after settlement |
| Catalog A -> B -> A | The second A can reuse the obsolete first-A promise | Catalog request identity includes a monotonically increasing workspace incarnation |
| Add-only watch plan | Deleted/ignored directories and closed hot documents remain admitted forever | Each owner replaces an exact desired plan; effective OS plan is recomputed |
| Watcher replacement | A tail event from an old worker can carry the owner's current generation | Event and status carry a native watch-instance identity |
| Activation gap | Long catalog reads occur before watching starts | Root watch starts first and expanded plans require one verification pass |
| Capability split brain | Same root can be Git in one state owner and ordinary in another | Capability transition is one atomic full-repository commit and watch-plan change |
| Unbounded recovery | Persistent errors repeatedly schedule all slices | Recovery classes, backoff, budget, suspension, and edge-triggered warnings |
| Ignored open files | Authorized ignored tabs may sit outside the catalog watch plan | Bounded open-document parents are part of the owner plan |
| Weak protocol | Empty or escaping path payloads enter coalescing | Validate cardinality, uniqueness, normalized relative paths, and recovery consistency |

## Delivery sequence

### Phase 1 — Commit boundary and race safety

- Add typed repository read leases and partial-snapshot merge ownership to `RepositorySession`.
- Make `RepositoryIntegrationCoordinator` the only accepted-result commit/fan-out boundary.
- Add a transition barrier with explicit settlement and make the watcher drain await it.
- Retry with bounded exponential delay when a repository revision changes during a read; after
  three retries, wait for new evidence or explicit Refresh instead of self-looping.
- Fix catalog single-flight to bind requests to controller workspace incarnation, not root text.

Exit checks: deterministic watcher-read/mutation races do not roll back canonical or feature state;
metadata-only reconciliation cannot change Changes/Files; A -> B -> A starts a fresh A scan.

### Phase 2 — Native watcher lifecycle and activation

- Allocate a watch instance on native watcher creation and include it in status/events.
- Store exact desired directories and generation per owner; reconcile the effective union on update
  and detach, including Linux `unwatch`.
- Clear the replaced worker's owners before publishing the new instance.
- Start with the root/Git plan before catalog loading; use a `verificationRequired` activation
  response when a plan expands.
- Reconcile backend and frontend Git capability on same-root project reads.

Exit checks: plan shrink, multi-owner union, replacement tail rejection, first-scan event capture,
and ordinary <-> Git transitions pass without reopening the workspace.

### Phase 3 — Event semantics and bounded recovery

- Replace the overflow boolean with explicit recovery classification.
- Validate and bound every event collection and workspace-relative path at the protocol boundary.
- Keep slice specificity when only path targeting is truncated.
- Add watcher health, rolling broad-recovery budget, exponential backoff, and suspension.
- Make focus recovery conditional on health/staleness and add a cooldown.
- Reconfigure the exact owner plan when open text tabs change so ignored documents stay in
  the hot set.

Exit checks: malformed events are rejected; path-list truncation does not read history; a persistent
  error stream performs bounded work and reaches `suspended`; opening/closing an ignored file expands
  and shrinks only that owner's plan.

### Phase 4 — Read decomposition and acceptance

- Add a repository-slice read command/DTO and share unavoidable Git commands inside a read plan.
- Route watcher metadata reconciliation through that API; reserve `read_project_snapshot` for
  activation/manual full refresh and capability verification.
- Record command counts and latency for content, ref, operation, overflow, and focus scenarios.
- Run frontend script tests, type checking, production build, Rust tests, formatting/Clippy, and
  platform-native watcher smoke checks.
- Record functionality, performance, memory/CPU, artifact size, accessibility impact, and known
  limitations in the milestone evidence document.

Exit checks: a refs-only hint starts neither status nor untracked commands; a content edit starts no
history/ref command; all required quality gates and native evidence are recorded.

## Implementation rules

- No controller may install watcher read data directly.
- No automatic recovery loop may enqueue itself without consuming retry budget or observing new
  external evidence.
- No watcher plan update may be expressed as `extend`; owner plans are replacements.
- No new numeric identity field may be named only `generation` unless it is the workspace generation.
- Git and filesystem data remain authoritative; the engine versions acceptance, not repository truth.
- Manual Refresh remains a complete explicit recovery and must work when automatic watching is
  unavailable or suspended.

## Acceptance matrix

| Scenario | Functional assertion | Resource assertion |
| --- | --- | --- |
| Old refs read finishes after commit | Commit snapshot remains canonical everywhere | At most three delayed retries, no untracked scan |
| Content burst | Clean matching tabs and working tree converge | One coalesced tracked read; zero history/ref reads |
| 513 changed paths | All open documents are conservatively checked | Requested slices retained; zero unrelated reads |
| Persistent backend errors | UI reports degraded then suspended | Bounded broad reads and warnings per rolling window |
| Two windows, same root | Independent tabs/generations receive current events | One OS watcher; union shrinks when an owner closes |
| Catalog A -> B -> A | Final A catalog comes from the final activation | Two distinct A requests; obsolete completion ignored |
| Delete/recreate watched directory | New external file is eventually observed | Bounded ancestor/catalog verification, no polling loop |
| Ordinary -> Git -> ordinary | Commands, UI, canonical state, metadata watcher agree | No window reopen and no orphan metadata watches |

## Rollback boundary

The work remains reviewable in four commits matching the phases above. If a phase fails its exit
checks, it is not hidden behind a compatibility flag and the following phase does not begin. The old
add-only plan and full-snapshot watcher path are removed once their replacement tests pass; they are
not retained as a second state machine.
