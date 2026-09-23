# ADR-0012: Versioned workspace reconciliation

## Status

Accepted on 2026-09-14. This decision supersedes the scheduling, overflow, watcher-plan, and
same-root capability-transition details in ADR-0009. ADR-0009 remains the decision that native
events are hints and filesystem/Git reads are authoritative. ADR-0017 later made ignored documents
editable without changing the bounded hot-set watcher rule recorded here.

## Context

The first watcher slice established typed invalidations, but its implementation still allowed
several independent asynchronous paths to replace or project repository state:

- a watcher metadata read installed a complete snapshot while notifying only the slices named by
  the hint;
- an older read could finish after a newer mutation result and overwrite the canonical session;
- any metadata hint performed the complete tracked snapshot and then started an untracked scan;
- project-catalog single-flight was keyed only by the root, so an A -> B -> A transition could
  reuse the first A request;
- the native shared watcher retained the union of every directory ever requested and could not
  shrink an individual window's plan;
- watcher replacement did not expose an instance identity, so tail events from the replaced worker
  could look current;
- ordinary-folder/Git transitions at the same root were updated independently in the backend
  authorization, frontend workspace session, repository session, and watcher metadata plan;
- overflow, root-level ambiguity, and path-list truncation all meant "refresh everything", with no
  health state, retry budget, or circuit breaker;
- ignored read-only documents could be authorized and opened without their parent directory being
  retained in the watch plan.

These are state-model defects, not isolated event-mapping bugs. More filters or special-case refresh
calls would add another producer without defining which result is allowed to become current.

## Decision

Asterlyn uses one window-scoped reconciliation engine as the only commit boundary for asynchronous
workspace and repository reads. Feature controllers receive projections only after the engine has
accepted a commit.

### Named identities and clocks

Every asynchronous reconciliation is bound to five explicit values. Bare, interchangeable
`generation: number` fields are not sufficient.

1. **Workspace generation** changes whenever the canonical root changes or the session is cleared.
2. **Repository revision** changes after every accepted canonical repository commit, including a
   Git capability appearance or disappearance.
3. **Read lease** records the workspace identity, the repository revision observed before a read,
   and the exact requested slices. A result is rejected if the workspace or base revision changed.
4. **Backend repository observation** orders same-root capability reads before they may change
   command authorization. An older backend read cannot restore an obsolete Git/non-Git capability
   after a newer observation.
5. **Watch instance** is allocated by the native service whenever the operating-system watcher is
   replaced. Events are accepted only for the current workspace generation and watch instance.

Operation generation remains a cancellation identity for user workflows; it is not reused as a
repository revision or watcher identity.

### Linearized commit and projection

The engine applies these rules atomically:

- A mutation result commits first and then fans out exactly its declared slices.
- A read result based on an obsolete repository revision does not commit. Its invalidation is
  merged back into pending work and read again from the newer base with exponential delay. Three
  self-retries are permitted; continued conflict defers until new external evidence or Refresh.
- A partial repository read merges only the fields owned by its requested slices. It cannot replace
  unrelated fields from the full DTO it happened to receive.
- A Git capability appearance or disappearance is a full repository capability transition. The
  backend authorization, frontend workspace capability, canonical repository, feature projections,
  and watcher metadata plan move together.
- One accepted canonical commit produces one projection plan. No controller may install a newer
  snapshot while another controller retains fields from an older commit for the same invalidated
  slice.
- An active internal transition is a reconciliation barrier. Hints continue to coalesce, but their
  authoritative read waits until the transition publishes or abandons its result. Ending a barrier
  wakes the pending drain; it never busy-loops.

The repository-slice ownership is:

| Slice | Canonical repository fields |
| --- | --- |
| `repositoryCapability` | presence/absence of the repository and `gitDir` identity |
| `workingTree` | `changes` and `untrackedState` |
| `head` | `branch` |
| `refs` | `branches`, `remotes`, and discovered Git-root membership |
| `history` | `commits` |
| `operation` | `operation` |

`workspaceCatalog` and `openDocuments` do not authorize replacement of repository fields.
Capability transitions are the only exception and always fan out the complete repository slice set.

### Read planning

The engine derives a read plan from the invalidation instead of using the invalidation only after a
complete read:

- `workingTree` reads tracked status first and starts one cancellable untracked supplement only
  when that slice is requested;
- `head`, `refs`, `history`, and `operation` use repository read APIs that return only their required
  model groups, combining shared Git commands within one read plan;
- `workspaceCatalog` performs one catalog request for the exact workspace incarnation;
- `openDocuments` rereads only matching open paths, or every open path when path identity is
  uncertain;
- a full manual refresh is an explicit complete plan, not the accidental implementation of a
  narrow hint.

Single-flight keys include workspace generation and request kind. An invalidation arriving during a
matching request is retained as a dirty-after-read flag; it cannot disappear into the active promise.

### Native watcher ownership and activation

The native service maintains an exact desired plan per owner:

```text
canonical root
  -> owner window
       -> workspace generation
       -> exact catalog directories
       -> exact open-document parent directories
  -> effective union installed in the OS watcher
```

Changing or removing an owner recomputes the union. Linux adds and removes non-recursive watches;
macOS and Windows replace the admission allowlist used by their recursive root watch. A directory
deleted from the plan is not silently retained. A newly created replacement directory is admitted
through its watched ancestor, followed by catalog reconciliation and plan installation. The native
service retains at most 512 inactive known-directory tombstones for this recreation handshake; they
are not installed OS watches while absent.

Watcher activation is a handshake:

1. install a root/Git-metadata watcher before starting the potentially long catalog scan;
2. buffer or coalesce events under the returned watch instance;
3. install the exact catalog and open-document plan;
4. perform one verification pass if the plan expanded while the catalog scan was running;
5. mark the watch healthy.

The frontend buffers at most 64 instance-qualified events during this handshake. Crossing that
bound cannot silently lose state: it becomes one budgeted complete verification.

Open ignored documents form a bounded hot set. Their authorized parent directories are included
even when they are absent from the default watcher catalog. Closing the last such tab removes its
owner-specific directory on the next plan update.

### Event validity, recovery classes, and health

The protocol rejects empty slice/cause lists, duplicate or unknown values, absolute paths, parent
traversal, backslash-rooted paths, NULs, overlong paths, and over-limit arrays.

Recovery is classified instead of represented by one overloaded boolean:

- `none`: exact or safely coalesced paths;
- `pathsTruncated`: requested slices remain valid but path targeting is lost;
- `backendOverflow`: notification loss is possible, so a bounded complete local verification is
  required;
- `rootAmbiguous`: a root-level event requires catalog, documents, and capability verification but
  does not imply that every Git history field changed.

The frontend watcher health state is `starting | healthy | degraded | suspended | unavailable`.
Broad recovery has exponential backoff, a rolling-window budget, and one pending recovery slot.
Exceeding the budget suspends automatic broad reads and leaves manual Refresh available. A later
successful verification or a new watch instance closes the circuit. Warnings are edge-triggered so
a persistent backend error cannot create an endless warning/render loop.

Focus recovery consults watch health and time since the last accepted commit. A short blur/focus does
not reconstruct local state. Remote Fetch remains a separate policy decision and cannot manufacture
a local invalidation.

## Consequences

- Async results have a mechanically testable acceptance rule; older reads cannot roll back a newer
  mutation or a newer scan.
- Typed slices reduce actual Git/filesystem work as well as downstream rendering.
- Multi-window sharing remains efficient while every owner can shrink its plan independently.
- Watcher faults converge or suspend within a bounded amount of automatic work instead of forming a
  self-sustaining loop.
- The implementation adds explicit leases, watcher instances, health transitions, and partial-read
  DTOs. This is deliberate complexity replacing implicit races and duplicated state ownership.

## Required evidence

Acceptance requires deterministic fixtures for stale read versus mutation, A -> B -> A catalog
requests, same-root Git capability transitions, watcher replacement tail events, per-owner plan
shrink, deleted/recreated Linux directories, ignored open-document coverage, path overflow versus
backend overflow, persistent-error circuit breaking, and focus recovery. Cross-platform native
smoke evidence and CPU/memory/read-count bounds are recorded with the implementation milestone.

The accepted implementation evidence is recorded in
[`2026-09-14 versioned workspace reconciliation`](../../benchmarks/2026-09-14-versioned-workspace-reconciliation.md).
