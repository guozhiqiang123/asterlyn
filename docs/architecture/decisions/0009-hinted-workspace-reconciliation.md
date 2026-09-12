# ADR-0009: Hinted workspace reconciliation

## Status

Accepted on 2026-09-12. The application/session boundary landed in R3 and the first native watcher
slice is accepted as R3.1. R5 continues to own file creation, move, copy, paste, and trash
operations, but no longer owns the watcher foundation. The implementation and resource evidence is
recorded in [`R3.1 native workspace-watch acceptance`](../../benchmarks/2026-09-12-r3-1-native-workspace-watch.md).

## Context

Asterlyn is intended to review code and changes produced both inside and outside its own editor.
Requiring a manual Refresh after another editor, an AI agent, Git, a formatter, or a build task
changes the workspace breaks that primary workflow. Repeatedly polling and rebuilding the complete
workspace, Git status, refs, and history would make the UI current at the cost of unnecessary disk,
process, CPU, and rendering work. It would also discard path-keyed disclosure, selection, and
scroll state if implemented through project reopening.

Linux, macOS, and Windows expose different notification facilities. Their event shapes and failure
modes differ: notifications may be coalesced, duplicated, reordered, delivered for a directory
rather than an exact file, or lost after an overflow. Network and virtual filesystems may not
provide reliable notification at all. A notification therefore cannot be repository truth.

## Decision

Asterlyn uses one Rust-owned watcher service per canonical active workspace, shared by windows
through reference-counted session ownership. The service uses the platform backend selected by a
maintained cross-platform Rust watcher library. A frontend WebView watcher is not the capability
owner.

R3.1 pins `notify` 8.0.0 exactly. The package is CC0-1.0 licensed and the accepted crates.io
checksum is recorded with the package-impact evidence. Version 8.0.0 is intentionally retained
instead of silently moving to the latest release because it preserves the workspace's Rust 1.85
toolchain contract; upgrades require their own compatibility and resource check.

The data flow is:

```text
operating-system notification
        -> WatchService hint
        -> bounded coalescing by canonical workspace/session
        -> typed slice invalidation
        -> authoritative workspace or Git read
        -> feature-owned reconciliation
```

Watcher events are hints only. The current filesystem and system Git remain authoritative. No
event is translated directly into an invented file, status, ref, or commit state.

### Session and invalidation contract

R3 introduces window-scoped `WorkspaceSession` and optional `RepositorySession` application
services before activating native watching. Every asynchronous result carries the session
generation and canonical root. Results from a replaced or closed session are ignored.

The first protocol has these independent invalidation slices:

- `workspaceCatalog`: path existence, kind, or ignored-display membership may have changed.
- `openDocuments`: one or more authorized paths may have changed on disk.
- `workingTree`: tracked, untracked, conflict, and submodule working state may have changed.
- `head`: current branch or checked-out object may have changed.
- `refs`: branch and tag names or targets may have changed.
- `history`: reachable commit topology may have changed.
- `operation`: merge, rebase, cherry-pick, revert, or sequencer state may have changed.

An invalidation contains the canonical workspace identity, a monotonically increasing generation,
one or more slices, optional normalized workspace paths, a cause, and whether the hint stream may
have overflowed. Consumers merge pending invalidations, never broaden them implicitly, and perform
only the reads owned by the requested slices.

Ordinary content changes invalidate matching `openDocuments` and `workingTree`. Create, remove,
rename, `.gitignore`, and `.gitmodules` changes additionally invalidate `workspaceCatalog` because
membership or display policy may have changed. Neither path reloads History, branches, tags, or
remotes. Selected `.git` metadata—including `HEAD`, `index`, refs, `packed-refs`, and operation
marker directories—maps to the corresponding repository slices. Object-store, log, and commit-
message churn is not forwarded as a stream of UI work.

### Scheduling and reconciliation

- Event bursts are merged after 120 ms of quiet, with a bounded maximum wait of 500 ms so
  continuous generators still converge. One event carries at most 512 normalized workspace paths;
  overflow broadens the invalidation to all seven slices.
- At most one reconciliation per slice runs for a session. A newer invalidation is retained and
  runs after the current read rather than racing it.
- Project catalog reconciliation preserves surviving file identity, expanded directories,
  selection, and scroll position.
- Working-tree reconciliation uses the tracked-first Git read, then the cancellable untracked
  supplement. It updates Changes, file/tab colors, and an active working Diff without reloading
  History or refs.
- A clean open document may reload automatically after a verified external revision change. A
  dirty document becomes an explicit external-change conflict and is never overwritten.
- Events caused by Asterlyn's own save or Git operation are not blindly discarded. The application
  records the expected revision and coalesces the event with the operation result, then still
  verifies authoritative state.

### Failure and fallback policy

Watcher startup failure, overflow, resume from sleep, and focus regained after a potentially stale
interval schedule a bounded reconciliation. Overflow broadens to a complete workspace catalog and
tracked-first working-tree read because affected paths are unknown. Manual Refresh remains an
explicit complete reconciliation and recovery control.

Low-frequency polling is permitted only when the watcher is unavailable or the active root is on a
known unreliable network/virtual filesystem. It is a fallback, not the default steady-state path.
Generated and ignored trees such as build outputs, dependency caches, and Git object storage are
filtered as early as correctness allows; filtering cannot exclude tracked files, open documents,
repository metadata, or submodule roots.

Linux watches the workspace root plus the parent directories represented by the authorized project
catalog non-recursively, while watching the selected Git metadata and operation/ref directories at
their required depth. Catalog reconciliation updates this watch plan. This avoids registering every
directory below generated, dependency, and Git-object trees. macOS and Windows use their native
recursive workspace backend plus the same separately resolved Git metadata roots. Multiple windows
showing the same root share the native subscription but retain independent editor and presentation
state. Closing the last owner releases the subscription and all pending work.

Submodule source paths already present in the workspace catalog are covered by the workspace plan,
but independent monitoring of each submodule's external Git metadata is deferred. The low-frequency
polling fallback for unavailable or unreliable native backends is also deferred; the implemented
recovery paths are overflow broadening, focus-regain reconciliation, and explicit Refresh.

## Consequences

External AI/editor changes can become visible without a manual refresh while preserving Git and
filesystem correctness. Status-only activity does not pay for complete history, ref, or project
reconstruction. The design also creates the invalidation seam required by later file operations,
build tasks, language tools, and recoverable Git operations.

The implementation must maintain platform-specific overflow and lifecycle tests and cannot claim
perfect event delivery. On Linux, creating a file below a previously empty directory that is not
yet represented by the bounded catalog may not emit a direct hint; focus regain or explicit Refresh
recovers it and updates the watch plan. Network/virtual filesystems have no accepted polling fallback
yet. Independent submodule Git-metadata observation and editable external-conflict resolution remain
separate capabilities.

## Rejected alternatives

- **Frontend-only watching:** couples authority and lifecycle to a WebView and makes multi-window
  sharing and overflow recovery harder.
- **Continuous full polling:** simple but performs work proportional to project size while idle and
  still needs state-preserving reconciliation.
- **Trusting event payloads as state:** cannot be correct across coalescing, rename, overflow, and
  external Git races.
- **Refreshing the complete repository for every event:** needlessly reloads History and refs and
  recreates the interaction and rendering problems addressed by the refactoring program.
