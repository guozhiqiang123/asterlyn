# Unpushed HEAD commit actions plan

- **Status:** Implemented
- **Date:** 2026-10-13

## Goal

Add `Undo Commit…` and `Drop Commit…` to the History commit context menu only when the selected
top-level commit is the checked-out branch's latest commit and Git reports it as unpublished in the
last-fetched remote-tracking state.

`Undo Commit` moves the branch to the commit's sole parent with mixed-reset semantics, leaving the
commit's file changes unstaged in the current worktree. `Drop Commit` moves the branch to the same
parent with hard-reset semantics and discards the commit's file changes. Asterlyn does not reproduce
JetBrains changelists or `Track context`: there is no local-changelist/context-restoration model to
target, so Undo returns changes directly to the one current worktree.

## Safety boundary

- Show the actions only for the project repository's exact `HEAD`, only when that commit has exactly
  one parent and its History row is marked outgoing.
- Require a checked-out local branch, no repository operation, no unsaved editor buffer, and a clean
  index/worktree before review.
- Prepare the action natively from the selected full HEAD object ID. Re-read symbolic `HEAD`, the
  sole parent, cleanliness, and the configured upstream (or all remote-tracking refs when no upstream
  exists) rather than trusting the renderer's outgoing flag.
- Bind action kind, branch ref, HEAD, parent, and publication basis into the reviewed token. Execute
  only after regenerating the same plan. Never fetch, push, retry, or choose another parent.
- Keep both operations explicit in the native boundary: `undoCommit` always uses mixed semantics;
  `dropCommit` always uses hard semantics. The generic Reset mode chooser is not reused as product
  meaning.

## Delivery slices

1. Add native prepare/execute commands and integration tests for Undo, Drop, pushed HEAD rejection,
   dirty state, merge/root commits, and stale review rejection.
2. Add the reviewed confirmation presentation and localized copy, then route eligible History menu
   actions through it.
3. Add policy/action/controller/protocol tests, update the History interaction contract, and run the
   focused and full validation gates.

## Acceptance

- An unpublished, clean, single-parent HEAD exposes both actions; pushed commits, older commits,
  nested-repository commits, roots, and merges do not.
- Undo leaves HEAD at the parent, preserves the former commit content, and leaves it unstaged.
- Drop leaves HEAD and files exactly at the parent.
- A changed HEAD, publication state, parent, branch, or worktree after review rejects execution.
- Closing or cancelling the dialog performs no mutation; failures remain visible and actionable.

## Validation record

- The frontend/delivery suite passes all 961 tests, including menu policy, exact action routing,
  confirmation presentation, protocol generation, localization, and ownership budgets.
- The full Rust workspace test suite passes. Native Git fixtures prove mixed Undo, hard Drop,
  pushed/dirty/root/merge rejection, local-only branch support, and stale-HEAD rejection.
- TypeScript checking and the production Vite build pass; both existing oversized source ceilings
  remain non-growing by moving the Git implementation and demo adapter into feature-owned modules.
