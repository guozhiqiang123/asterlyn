# Non-current local branch synchronization plan

## Goal

The Branches navigation must show the last-fetched upstream relationship for every local branch,
not only for `HEAD`. A user may invoke **Update** or **Push** from any exact local-branch row without
temporarily checking out that branch or disturbing the editor and working tree for the active
branch.

This feature does not copy another IDE's implementation or assets. It adopts the familiar product
behavior while preserving Asterlyn's reviewed Git-operation boundary.

## User-visible contract

- A local branch with a configured upstream displays compact incoming and outgoing counts beside
  its name. `↓N` means commits reachable only from the last-fetched upstream; `↑N` means commits
  reachable only from the local branch. Zero counts stay hidden.
- The same divergence suffix is shown in the top-bar branch launcher so both branch entry points
  report one repository truth.
- Every single-repository local branch exposes **Update** and **Push** in its context menu.
- The checked-out branch keeps the existing Update strategy and Push review workflows.
- A non-current branch Update fetches its configured upstream and moves the exact local ref only
  when the result is a fast-forward. An already-current or locally-ahead branch is a successful
  no-op. A divergent branch is rejected and must be checked out for an explicit Merge or Rebase.
- A non-current branch Push opens the existing review dialog with that local ref as the source.
  Commit, changed-file, tag-scope, destination, ordinary/lease, authentication, cancellation, and
  success feedback remain available. The preview token binds the exact source ref and object.
- A branch checked out in another registered worktree may be pushed, because Push does not mutate
  its local ref or files. It cannot be updated from this window because advancing its ref behind
  that worktree would make the other checkout inconsistent.

## Repository data model

`BranchSummary` carries structured `upstreamRemote`, `upstreamRef`, `ahead`, and `behind` fields in
addition to the existing human-readable tracking value. The fields come from one bounded
`for-each-ref` read. Parsing happens in the product-neutral Git crate under the process runner's
stable locale; the renderer never parses Git prose.

Counts describe local ref versus local remote-tracking ref. They change after Fetch/Update/Push or
another authoritative ref refresh. Asterlyn does not poll or contact the network merely to paint a
branch row.

## Update safety boundary

The native branch-update command receives the exact full local ref and expected object from the
selected row. It then:

1. verifies the ref is a local branch, still resolves to the expected commit, has a supported
   upstream, and is not checked out in any registered worktree;
2. fetches only the configured upstream into its exact remote-tracking ref, with cancellation and
   bounded remote-output handling;
3. revalidates branch, upstream, worktree ownership, and fetched target;
4. accepts an already-contained target as a no-op, rejects divergence, and otherwise advances the
   local ref with an exact-old-object `update-ref` compare-and-swap;
5. returns an authoritative repository snapshot for normal reconciliation.

It never checks out, merges, rebases, resets, stashes, writes working-tree files, or retries an
unknown outcome.

## Push safety boundary

The existing Push preview/execution flow gains an optional exact source local ref. Current-branch
callers omit it and retain existing behavior. Non-current callers provide it on preview pagination,
file inspection, and execution. The backend independently resolves and validates that ref each
time; its full name, object, upstream/destination, selected remote, tag scope, and comparison base
are part of the opaque preview token. Execution uses the reviewed object-to-destination refspec and
ordinary Push by default. Stale source movement or upstream changes invalidate the review.

The aggregate file tree describes the exact destination-base-to-reviewed-head result, not merely
the union of paths touched by commits reachable only from the local source. This distinction is
observable when the refs diverge: a remote-only edit will be removed by a force-with-lease push and
must remain visible in review even though no outgoing local commit contains that path. Opening an
aggregate file therefore uses a two-commit comparison between the reviewed destination base and
head. Selecting a specific outgoing commit continues to use that commit's parent comparison. This
keeps file inspection aligned with the file tree and prevents divergent reviews from reporting a
false “no outgoing commit contains this file” error.

## Delivery slices

1. Extend reference parsing and protocol models; add parser and repository tests for every local
   branch's divergence.
2. Add exact non-current fast-forward Update and arbitrary-local-source Push APIs through the Rust,
   Tauri, and typed bridge layers.
3. Add branch-row/top-bar divergence presentation, context policy, localized feedback, and reuse of
   the Push review dialog.
4. Verify focused policy/controller/view tests, TypeScript checks, frontend build, and
   `asterlyn-git` tests. Record manual package acceptance separately when requested.

## Acceptance gates

- Switching the active branch is never part of non-current Update or Push.
- Both counts are correct for behind-only, ahead-only, divergent, no-upstream, and gone-upstream
  fixtures.
- A non-current fast-forward changes only the target local and remote-tracking refs; active `HEAD`,
  index, and working-tree bytes remain unchanged.
- Divergence, stale identity, unsupported remote, active operation, and other-worktree checkout fail
  closed with actionable feedback.
- Push review and execution use the same exact source identity, and a source movement after review
  is rejected.
- The added row metadata remains compact, keyboard accessible, localized in its descriptive text,
  and does not change branch-history selection semantics.
