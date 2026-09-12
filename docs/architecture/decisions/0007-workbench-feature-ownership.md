# ADR-0007: Feature-owned workbench state and scoped rendering

- **Status:** Accepted for the architecture-refactoring sequence
- **Date:** 2026-09-12

## Context

The first Git and editor vertical slices proved the product direction, but their orchestration grew
inside one `AsterlynApp`. The application object now owns workspace activation, project files,
editor tabs, search, replacement, Git status, branches, history, commit details, remote operations,
push review, settings, window lifecycle, and most DOM rendering. Several views replace complete
HTML subtrees and bind row listeners again after a local state change.

This shape has already made unrelated state visible to every feature and has caused avoidable
scroll restoration, focus restoration, stale-result checks, and broad rendering. Adding file
mutation, conflict resolution, merge, rebase, cherry-pick, or squash directly to the same object
would increase coupling faster than capability breadth.

Changing Tauri, CodeMirror, or the framework-light TypeScript presentation would not by itself
correct ownership. The migration must preserve current behavior while establishing boundaries that
can be measured and rolled back independently.

## Decision

Each workbench feature owns one cohesive state and rendering boundary. Initial features are Files,
Editor, Changes and Commit, Git History and Details, Git Branches, Remote Operations, Search and
Replacement, Settings, and the Shell. A feature owns:

- serializable feature state and pure state transitions;
- typed actions and typed outputs to other features;
- request generations, cancellation handles, and stale-result rejection;
- one or more stable DOM hosts, scoped rendering, delegated events, and disposal;
- selectors that derive presentation without becoming repository truth.

`AsterlynApp` becomes the composition root. It activates a window session, wires feature actions,
and routes cross-feature events. It does not inspect another feature's DOM or duplicate its state.
Cross-feature communication uses typed events such as `active-file-changed`,
`repository-slices-invalidated`, and `commit-selection-changed`. Event payloads contain stable
identities, not elements, row indexes, or framework objects.

Stable list hosts survive selection and detail updates. A feature may replace row projection when
its query, ordering, repository identity, or loaded page window changes; selection alone updates
the relevant row attributes and details host. High-cardinality lists use one delegated event
boundary and add viewport virtualization before their mounted row count exceeds the architecture
gate.

CodeMirror remains behind the existing editor adapter. Tauri remains a shell and transport adapter.
No frontend framework migration is part of this decision. CSS is split by design foundations,
shell layout, reusable controls, and feature ownership, without changing current visual behavior as
part of extraction.

The migration proceeds through characterization tests and vertical extractions. The first
reference extraction is Git History list presentation because it exercises stable scrolling,
keyboard selection, graph rendering, paging, and asynchronous details without changing Git domain
semantics.

## Invariants

1. Repository and filesystem data remain canonical outside presentation state.
2. DOM, CodeMirror, and Tauri objects never enter serializable feature state.
3. One state field has one owner. Derived read models may be shared but not mutated by consumers.
4. A late asynchronous result must match window, workspace, repository generation, request
   generation, and selected identity before it is accepted.
5. Feature disposal removes every listener, observer, timer, and cancellable task it owns.
6. Selecting a commit or file cannot replace an unchanged scroll container.
7. Extraction commits preserve behavior and visual contracts unless a separately documented defect
   correction is included.

## Migration and rollback

Extract one feature at a time behind its existing DOM host. Keep the previous action entry points in
the composition root until deterministic tests demonstrate parity, then remove the old rendering
and listener code. Each extraction is independently revertible and does not migrate persisted user
or repository data.

The application source-size gate is applied to new work immediately. Existing oversized files are
burned down by capability extraction rather than arbitrary line moves.

## Consequences

- Local changes stop requiring broad workbench rerenders.
- Features can gain focused tests without booting the whole application.
- Cross-feature behavior becomes explicit and reviewable.
- Temporary adapter methods and duplicated projections may exist during a vertical extraction, but
  every temporary bridge must have an owning migration item.
- The composition root remains framework-light; future framework adoption is optional and must
  still preserve these ownership boundaries.

## Revisit triggers

- Two editor groups require a hierarchy above a single Editor feature.
- Feature event ordering becomes ambiguous enough to require a transactional dispatcher.
- Measured DOM performance remains unacceptable after scoped rendering and virtualization.
- A frontend framework replacement demonstrates lower lifecycle complexity without moving domain
  ownership into framework components.
