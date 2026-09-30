# Git worktree actions plan

- **Status:** Follow-up locally accepted and installed
- **Date:** 2026-09-30
- **Baseline:** `d08e0d8`
- **Working branch:** `codex/delete-worktree-action`
- **Scope:** Detect primary and linked Git worktrees in the Branches tool, show all local branches
  as `PRIMARY` / `WORKTREE` / `AVAILABLE`, and provide reviewed ordinary or explicitly forced
  linked-worktree removal. A “New Worktree from Here” workflow remains a separate follow-up.

## Objective

Asterlyn currently renders every local ref as a branch. Git already knows whether a local branch is
checked out by the primary worktree or by a linked worktree, but that identity is used only to block
branch deletion. The UI therefore cannot explain why a branch cannot be switched to or deleted, and
it cannot offer the semantically correct operation: removing the linked worktree while retaining the
branch.

The first delivery must:

1. derive worktree identity from Git metadata instead of branch naming conventions;
2. display localized primary, linked, and available checkout states and expose registered paths in
   row titles;
3. show **Delete Worktree…** only for an exact linked-worktree branch;
4. review the exact branch, object, and registered path before removal;
5. warn when the linked worktree is dirty or its branch contains commits not reachable from the
   primary-worktree HEAD;
6. require an explicit **Force Delete Worktree** action for either warning, while locked,
   missing/prunable, primary, current, ambiguous, or stale targets remain non-overridable;
7. retain the local branch and commit objects after ordinary or forced removal, refresh repository
   state, and update the checkout-state badge only after Git confirms success.

## Source of truth and identity

The backend reads `git worktree list --porcelain -z` from the authorized repository. It does not
infer worktree identity from a `codex/` prefix, directory naming, branch subject, UI selection, or
the presence of a sibling folder.

The porcelain records are interpreted as follows:

- the first record is the primary worktree and is never exposed as removable;
- later records are linked worktrees;
- the first record annotates the primary-worktree branch and later records annotate linked branches;
- detached records do not annotate a branch row;
- zero matches mean the branch is ordinary;
- one match enables linked-worktree presentation;
- multiple matches fail closed for mutation, even if they were created with Git override flags;
- `locked` and `prunable` states remain visible as worktree identity but block removal.

The serialized branch summary carries separate primary- and linked-worktree paths. Repository
refresh remains authoritative, so external `git worktree add`,
`remove`, `move`, `lock`, or `prune` changes are reflected by the existing refs refresh path.

## User experience

### Branch list

- Local branch not checked out in any worktree: muted `AVAILABLE` / `未检出` state.
- Branch checked out in the primary worktree: `PRIMARY` / `主工作区` badge and its path.
- Current branch in the open repository: existing independent `HEAD` marker.
- Local branch checked out in one linked worktree: existing branch icon plus a compact localized
  `WORKTREE` / `工作树` badge.
- The accessible row title includes the branch subject and the exact worktree path.
- The badge uses a dedicated semantic style rather than reusing the `HEAD` success color.

### Context menu

For an exact top-level local branch associated with one linked worktree:

- **Switch to…** remains visible but blocked with an exact “checked out in a linked worktree” reason;
- **Rename…** follows the existing backend safety policy and cannot bypass linked checkout checks;
- **Delete Local Branch…** is not offered while the branch is checked out;
- **Delete Worktree…** is offered as the destructive action.

For an ordinary, non-current local branch, the existing **Delete Local Branch…** action remains
unchanged. Tags, remote branches, logical rows spanning multiple Git roots, the primary worktree,
and the current branch never receive **Delete Worktree…**.

### Review dialog

Removal reuses the reviewed branch-mutation dialog lifecycle but has worktree-specific copy. The
review shows:

- the source branch and full ref;
- the exact source object ID;
- the exact registered worktree path;
- the current repository HEAD used to bind the review;
- bounded changed paths and the total dirty-path count;
- the primary-worktree branch/HEAD used for comparison and the count of commits reachable from the
  linked branch but not from that primary HEAD;
- an explicit consequence: the directory is removed, while the local branch, remote branch, and
  commit objects are retained.

The final action is **Delete Worktree** for a clean branch already contained by the primary HEAD.
If dirty paths or unmerged commits are present, the warning is visually prominent and the only
final action is **Force Delete Worktree** / **强制删除工作树**. The dialog states that force discards
uncommitted filesystem changes, while committed history remains reachable through the retained
local branch.

## Backend safety contract

Preparation and execution use the same fail-closed checks:

1. The active window is still authorized for the repository root.
2. The selected full ref still resolves to the reviewed object ID and remains a local branch.
3. The branch is not the branch checked out by the current repository window.
4. Exactly one non-primary porcelain record still associates the branch with the reviewed path.
5. The record is neither locked nor prunable, and the registered directory still exists. These
   structural blockers cannot be forced.
6. `git status --porcelain=v2 -z --untracked-files=normal --ignore-submodules=none` produces a
   bounded review of tracked, staged, untracked, conflicted, and submodule changes.
7. The source object is compared with the primary worktree's exact HEAD using a bounded commit
   count; committed differences are warnings because the local branch is retained.
8. Dirty paths or commits not contained by the primary HEAD require a second backend plan carrying
   explicit force authorization. The review token binds the warnings, comparison HEAD, force bit,
   source ref/object, current HEAD, and exact worktree path.
9. Clean contained targets invoke `git worktree remove <path>`; explicitly authorized warning cases
   invoke `git worktree remove --force <path>`.
10. Preparation and execution both recompute the same review. New changes, commits, checkout
   movement, or comparison-HEAD movement invalidate the confirmation.
11. Git failure retains the worktree and presents the sanitized diagnostic; Asterlyn does not fall
   back to filesystem deletion.

This operation deliberately does not delete the local branch. After successful removal, users may
separately invoke the existing reviewed local-branch deletion if the branch is merged and otherwise
eligible.

## Architecture changes

### Rust repository layer

- Parse bounded NUL-delimited worktree porcelain records into a private registered-worktree model.
- Annotate local `BranchSummary` values with separate primary and linked paths.
- Include porcelain `HEAD` identities, bounded status evidence, and the primary-HEAD comparison in
  a worktree-removal review object.
- Extend the reviewed branch mutation kind with `RemoveWorktree` and its plan with a typed
  worktree review containing bounded warnings and exact force authorization.
- Prepare, tokenize, revalidate, and execute removal inside `asterlyn-git`; Tauri remains an
  authorization and operation-coordination adapter.
- Keep branch deletion, remote deletion, and worktree removal as distinct match arms and
  consequences.

### Typed desktop boundary

- Add `removeWorktree` to the TypeScript/Rust mutation kind.
- Add a typed nullable worktree-removal review and explicit force authorization to requests/plans
  and runtime validation.
- Keep the existing `prepare_branch_mutation` and `execute_branch_mutation` commands; no extra
  desktop command or arbitrary path argument is introduced.
- The frontend submits only branch identity. The backend discovers and returns the path, preventing
  the renderer from choosing a deletion target.

### Frontend feature layer

- Branch presentation consumes primary and linked paths for three-state badges and accessible titles.
- Context policy owns switch blocking and the mutually exclusive worktree/branch delete actions.
- The existing branch mutation controller gains a reusable “requires review” predicate for both
  local-branch deletion and worktree removal.
- The review view renders the worktree path and hides remote-deletion controls for worktree
  removal.
- The controller reparses an explicitly forced request before execution; it never mutates a clean
  plan into a forced command on the renderer alone.
- English and Simplified Chinese copy cover the badge, blocked reason, menu action, review,
  progress, completion, and retained-branch consequence.

### Demo behavior

The demo snapshot includes one linked-worktree branch. Demo removal clears its worktree association
and retains the branch so browser acceptance exercises the same visible state transition without
deleting a host directory.

## Delivery phases

### WT0 — Characterization and plan

- Save this plan before further implementation.
- Add failing focused tests for porcelain parsing, branch annotation, menu selection, badge markup,
  reviewed controller behavior, and protocol validation.

### WT1 — Detect and present linked worktrees

- Add the Rust/TypeScript branch-summary field.
- Parse and associate registered linked worktrees.
- Add badge, title/path presentation, localization, and current-target invalidation.
- Verify ordinary, primary-worktree, and linked-worktree branches receive only their intended
  localized checkout-state presentation.

### WT2 — Reviewed removal

- Add the reviewed removal kind and nullable worktree-review evidence.
- Review dirty/unmerged evidence and enforce locked/prunable/current/primary/exact-match checks.
- Add context policy, menu routing, review copy, execution, reconciliation, and demo behavior.
- Verify the branch remains after successful removal and becomes an ordinary local branch.

### WT3 — Acceptance and local installation

- Run focused frontend and Rust tests while iterating.
- Run the complete frontend script suite, TypeScript/build gates, Rust library tests, formatting,
  strict Clippy, and patch hygiene.
- Build the macOS application, verify its ad-hoc hardened-runtime signature and arm64 architecture,
  archive and hash it, replace the local installation through a recoverable backup, and run the
  installed native smoke test.

### WT4 — Checkout-state clarity and reviewed force removal

- Add primary/linked/available branch presentation without changing `HEAD` semantics.
- Review dirty paths and commits not contained by the primary worktree HEAD.
- Require a newly prepared force-authorized plan before `--force` execution.
- Keep structural blockers non-overridable, retain the branch, rerun the full gates, and replace the
  local installation with a newly accepted package.

## Follow-up: New Worktree from Here

The Android Studio-style creation flow is a compatible follow-up, not a prerequisite for safe
removal. It is a medium-sized incremental change because WT1 supplies identification and WT2
supplies reviewed mutation/reconciliation infrastructure.

A future dialog would include:

- reviewed source branch and exact object;
- optional **New branch** checkbox and validated branch name;
- project name and parent location, with the final path shown before execution;
- directory selection through the native picker rather than free-form arbitrary host access;
- detached creation when no new branch is selected, because Git normally forbids checking the same
  branch out in a second worktree;
- `git worktree add --detach <path> <exact-oid>` or
  `git worktree add -b <validated-name> <path> <exact-oid>`;
- checks that the destination does not exist, is not inside Git metadata, does not overlap an
  authorized open project, and remains unchanged between review and execution;
- optional post-create opening/focusing as a separate user choice.

This follow-up must have its own reviewed creation plan. It must not overload the removal plan or
accept a renderer-selected command line.

## Validation matrix

| Gate | Required result |
| --- | --- |
| Porcelain parser | primary, linked, detached, locked, prunable, spaces, malformed records, and duplicate branch associations covered |
| Rust repository | clean removal succeeds; dirty/unmerged evidence requires explicit force; locked, missing, current, primary, multiple, and stale targets fail closed; branch is retained |
| Context policy | linked row shows worktree removal and no branch deletion; ordinary row keeps branch deletion; logical multi-root rows remain read-only |
| Presentation | localized primary/worktree/available states and path titles render independently of `HEAD` |
| Reviewed controller | warnings render before execution; force reparses and authorizes; no remote option; failed plans remain visible |
| Protocol | typed worktree review and force semantics accept coherent plans and reject mismatches |
| Demo | removal clears only the association and preserves the local branch |
| Frontend regression | `npm run test:scripts`, `npm run check`, and `npm run build` pass without relaxing ownership or bundle budgets |
| Native regression | `cargo test -p asterlyn --lib`, `cargo fmt --all -- --check`, and strict all-target Clippy pass |
| Patch hygiene | `git diff --check` passes; the dirty primary checkout remains untouched |
| Installed acceptance | packaged and installed executable hashes match; signature, architecture, and six-second native smoke pass |

## Rollback and non-goals

- Detection/presentation and mutation are separate rollback units. If removal is reverted, the
  worktree badge may remain useful, but no partially wired destructive menu item may remain.
- No `git worktree prune`, move, repair, lock/unlock, branch deletion, remote deletion, or filesystem
  fallback is added. Force applies only to a reviewed linked-worktree removal with dirty/unmerged
  evidence; it cannot bypass structural identity blockers.
- No branch-name prefix is reserved for worktrees.
- No background worktree watcher or index is introduced; the existing repository refresh lifecycle
  remains authoritative.
- The primary checkout’s unrelated uncommitted files are outside this worktree and remain untouched.

## Completion record

- **Accepted branch:** `codex/delete-worktree-action`; initial implementation commit `a33ee5a` plus
  the checkout-state and force-review follow-up. The exact completion-record commit is reported in
  the handoff because a commit cannot embed its own hash.
- **Frontend:** TypeScript checking, the 765-test script suite, production Vite build, ownership
  budgets, protocol validation, and `git diff --check` passed.
- **Native:** Rust formatting, strict all-target workspace Clippy, and workspace tests passed. The
  `asterlyn-git` crate passed 127 tests; two unrelated operating-system watcher tests remain ignored
  by their existing contract.
- **Worktree coverage:** porcelain paths with spaces, detached records, locked/prunable state,
  malformed UTF-8, duplicate branch associations, primary/linked/available presentation, clean
  removal, dirty and primary-uncontained warning review, stale force-token rejection, exact forced
  removal, locked, missing, current, and stale targets passed. Successful ordinary and forced
  removal retained the local branch.
- **Accepted package:**
  `target/release/bundle/macos/Asterlyn-worktree-safety-20260930-macos-arm64.zip`, 8,961,076 bytes,
  SHA-256 `974ee9f07d741e07127f8118dfca31001c9b44ea5003f9769bf847d010896cc5`.
- **Installed executable:** `/Applications/Asterlyn.app/Contents/MacOS/asterlyn`, 23,662,496 bytes,
  SHA-256 `0405db609df7578984e79094614ca20ddf68f47f9094b5589cb5c94b8a69139e`, exactly matching the
  packaged executable. The arm64 bundle is ad-hoc signed with hardened runtime, passed strict
  signature verification, and rendered the application shell during the six-second isolated native
  smoke from both the build and installed paths.
- **Replaced installation backup:** moved to the recoverable macOS Trash location
  `/Users/gzq/.Trash/Asterlyn.app.backup-worktree-safety-20260930` after installed verification.
- **Host:** macOS 15.6.1 (24G90), Apple Silicon; Node.js 26.8.1, npm 11.19.0, Rust 1.97.1, and Git
  2.48.1. Windows/Linux compilation and installed interaction remain platform-specific follow-up
  gates; this local preview is neither Developer ID signed nor notarized.
