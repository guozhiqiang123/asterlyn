# ADR-0009: Hinted workspace reconciliation

## Status

Accepted on 2026-09-12. The application/session boundary lands in R3; native watcher activation and
cross-platform fault evidence follow as a dedicated Stage 3 capability slice. R5 continues to own
file creation, move, copy, paste, and trash operations, but no longer owns the watcher foundation.

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

Ordinary source-file events normally invalidate `workspaceCatalog`, matching `openDocuments`, and
`workingTree`. They do not reload History, branches, tags, or remotes. Selected `.git` metadata—
including `HEAD`, `index`, refs, `packed-refs`, and operation marker directories—maps to the
corresponding repository slices. Object-store churn is not forwarded as a stream of UI work.

### Scheduling and reconciliation

- Event bursts are merged for approximately 80–150 ms, with a bounded maximum wait of roughly
  500 ms so continuous generators still converge.
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

Submodules receive independent canonical watcher roots and repository identities. Multiple windows
showing the same root share the native subscription but retain independent editor and presentation
state. Closing the last owner releases the subscription and all pending work.

## Consequences

External AI/editor changes can become visible without a manual refresh while preserving Git and
filesystem correctness. Status-only activity does not pay for complete history, ref, or project
reconstruction. The design also creates the invalidation seam required by later file operations,
build tasks, language tools, and recoverable Git operations.

The implementation must maintain platform-specific overflow and lifecycle tests and cannot claim
perfect event delivery. Network filesystems may converge more slowly through the fallback path.
Editable external-conflict resolution remains a separate editor capability.

## Rejected alternatives

- **Frontend-only watching:** couples authority and lifecycle to a WebView and makes multi-window
  sharing and overflow recovery harder.
- **Continuous full polling:** simple but performs work proportional to project size while idle and
  still needs state-preserving reconciliation.
- **Trusting event payloads as state:** cannot be correct across coalescing, rename, overflow, and
  external Git races.
- **Refreshing the complete repository for every event:** needlessly reloads History and refs and
  recreates the interaction and rendering problems addressed by the refactoring program.
