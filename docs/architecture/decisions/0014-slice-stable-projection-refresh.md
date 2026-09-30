# ADR-0014: Slice-stable repository projection refresh

## Status

Accepted on 2026-09-20.

## Context

Repository reads were versioned and slice-qualified, but presentation fan-out still treated every
accepted read as a reason to rebuild the complete workbench. Foreground recovery could first reread
local History and then fetch the remote, producing two History replacements. Even an identical
result advanced controller generations, cleared range selection, invalidated an open context menu,
and replaced DOM rows. Files, Changes, and Branches inherited the same failure mode whenever a broad
render followed an otherwise narrow controller update.

Git must remain the source of truth, so avoiding a read is not the same as avoiding an unnecessary
projection write. The system needs to commit authoritative results while independently deciding
which feature projections changed semantically.

## Decision

Repository refresh has two explicit stages:

1. `WindowSession` accepts a versioned Git result and commits its declared canonical slices.
2. `RepositoryIntegrationCoordinator` compares the previous and accepted values for those slices,
   then fans out only semantically changed projection slices.

Repository capability, working tree, HEAD, refs/remotes, History, and operation state have separate
comparison boundaries. Workspace catalog and open-document invalidations remain explicit because
their truth is owned outside `RepositorySnapshot`. An identical Git result may advance the canonical
repository revision, but it does not reinstall feature state or rebuild a surface.

The composition root provides a slice renderer instead of using the complete workbench renderer for
watcher, remote, save, and workspace-mutation reconciliation. Feature controllers remain the owners
of their rows and selections. History snapshot installation is a no-op when root, query, commits,
paging state, and selection are unchanged. Paging and refresh progress update only the History status
node; rows are replaced only after their commit projection changes. Context actions revalidate exact
workspace, commit, parent, subject, and selection identities, so an unrelated History generation no
longer closes a valid menu.

Foreground recovery performs one local pass for workspace catalog, open documents, repository
capability, working tree, and operation state. It then attempts the configured background fetch. An
accepted remote result is the authoritative HEAD/refs/History reconciliation. Only when no remote
result was accepted does recovery perform the local HEAD/refs/History fallback. This preserves fast
local file discovery while preventing the old double History refresh.

**Amendment, 2026-09-30.** A tracked-first revalidation keeps the last accepted untracked rows in
the pending working-tree projection until the matching supplement completes. Pending remains the
canonical safety state, so Git mutations still fail closed; presentation places its compact progress
indicator in a fixed slot inside the first retained group instead of inserting a temporary row or
replacing the groups with a loading surface. Virtual History updates keep the native scrolling host
and its list element mounted, start a paginatable first page on the same invariant full-height
virtual canvas used by later pages, cache the commit-graph projection until history data changes, patch only the
translated row window, and never write a captured `scrollTop` back during a native scrollbar
interaction. History scroll is presentation and pagination intent only:
approaching the bottom may append older commits, while returning to the top never starts a refresh.
Authoritative repository reconciliation owns newly arrived commits instead. Changes keeps its outer
layout, toolbar, scroll host, list, and commit-composer identities across tracked-first and untracked
supplement phases; only the scan notice, changed rows, and derived control state are patched. Context
menus close for direct dismissal intent (outside pointer, wheel/touch scroll, Escape, resize, blur),
or when their feature identity is no longer current; programmatic scroll caused by a projection
refresh is not dismissal intent.

## Consequences

- Stable selections, disclosure, scroll, and context menus survive semantic no-op refreshes.
- User selection intent is projected synchronously before dependent reads begin; branch-row
  acknowledgement is not owned by filtered History or remote-refresh completion.
- External changes still enter canonical state before presentation changes.
- A real remote or local Git change produces one affected-surface update rather than two broad
  workbench replacements.
- Foreground recovery may visibly mark provisional untracked truth, but it does not blank the last
  accepted rows or replace a native scrolling host that the user is manipulating.
- Scroll position never doubles as refresh authorization; refresh comes from explicit or watcher
  reconciliation and is projected without replacing stable interaction containers.
- Slice comparison is bounded by the accepted snapshot. History retains separate paging and
  virtual-mount limits.
- Manual project replacement and Git capability loss may still use a complete render because their
  surface topology changes.
- Cross-platform interactive validation remains required for compositor behavior that unit tests
  cannot observe directly.
