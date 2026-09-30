# Git worktree actions plan

- **Status:** Implemented and locally accepted
- **Date:** 2026-09-30
- **Baseline:** `d08e0d8`
- **Working branch:** `codex/delete-worktree-action`
- **Scope:** Detect linked Git worktrees in the Branches tool, identify them visibly, and provide a
  reviewed, safe removal action from the branch context menu. A “New Worktree from Here” workflow
  is designed as a follow-up but is not part of the first implementation without explicit approval.

## Objective

Asterlyn currently renders every local ref as a branch. Git already knows whether a local branch is
checked out by the primary worktree or by a linked worktree, but that identity is used only to block
branch deletion. The UI therefore cannot explain why a branch cannot be switched to or deleted, and
it cannot offer the semantically correct operation: removing the linked worktree while retaining the
branch.

The first delivery must:

1. derive worktree identity from Git metadata instead of branch naming conventions;
2. display a localized `WORKTREE` / `工作树` badge and expose the registered path in the row title;
3. show **Delete Worktree…** only for an exact linked-worktree branch;
4. review the exact branch, object, and registered path before removal;
5. refuse to remove the primary worktree, the currently open worktree, a dirty worktree, a locked
   worktree, a missing/prunable worktree, or a target that changed after review;
6. run ordinary `git worktree remove` without `--force`, retain the local branch and commit objects,
   refresh repository state, and remove the badge only after Git confirms success.

## Source of truth and identity

The backend reads `git worktree list --porcelain -z` from the authorized repository. It does not
infer worktree identity from a `codex/` prefix, directory naming, branch subject, UI selection, or
the presence of a sibling folder.

The porcelain records are interpreted as follows:

- the first record is the primary worktree and is never exposed as removable;
- later records are linked worktrees;
- a linked record with `branch refs/heads/<name>` may annotate the matching local branch with its
  exact registered path;
- detached records do not annotate a branch row;
- zero matches mean the branch is ordinary;
- one match enables linked-worktree presentation;
- multiple matches fail closed for mutation, even if they were created with Git override flags;
- `locked` and `prunable` states remain visible as worktree identity but block removal.

The serialized branch summary gains only the linked-worktree path. The primary-worktree path is not
placed on branch rows. Repository refresh remains authoritative, so external `git worktree add`,
`remove`, `move`, `lock`, or `prune` changes are reflected by the existing refs refresh path.

## User experience

### Branch list

- Ordinary local branch: existing branch icon and no badge.
- Current branch in the open repository: existing `HEAD` marker.
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
- an explicit consequence: the directory is removed, while the local branch, remote branch, and
  commit objects are retained.

The final action is labeled **Delete Worktree** / **删除工作树**. It is never a one-click destructive
menu action.

## Backend safety contract

Preparation and execution use the same fail-closed checks:

1. The active window is still authorized for the repository root.
2. The selected full ref still resolves to the reviewed object ID and remains a local branch.
3. The branch is not the branch checked out by the current repository window.
4. Exactly one non-primary porcelain record still associates the branch with the reviewed path.
5. The record is neither locked nor prunable, and the registered directory still exists.
6. `git status --porcelain=v2 -z --untracked-files=normal --ignore-submodules=none` in that
   worktree is empty. Tracked, staged, untracked, conflicted, and submodule changes all block.
7. The review token still matches the source ref, object, current HEAD, worktree path, and removal
   kind immediately before execution.
8. Execution invokes ordinary `git worktree remove <exact-registered-path>` without `--force`.
9. Git failure retains the worktree and presents the sanitized diagnostic; Asterlyn does not fall
   back to filesystem deletion.

This operation deliberately does not delete the local branch. After successful removal, users may
separately invoke the existing reviewed local-branch deletion if the branch is merged and otherwise
eligible.

## Architecture changes

### Rust repository layer

- Parse bounded NUL-delimited worktree porcelain records into a private registered-worktree model.
- Annotate local `BranchSummary` values with `linked_worktree_path` only for one exact linked match.
- Extend the reviewed branch mutation kind with `RemoveWorktree` and its plan with
  `worktree_path`.
- Prepare, tokenize, revalidate, and execute removal inside `asterlyn-git`; Tauri remains an
  authorization and operation-coordination adapter.
- Keep branch deletion, remote deletion, and worktree removal as distinct match arms and
  consequences.

### Typed desktop boundary

- Add `removeWorktree` to the TypeScript/Rust mutation kind.
- Add nullable `worktreePath` to the reviewed plan and runtime validator.
- Keep the existing `prepare_branch_mutation` and `execute_branch_mutation` commands; no extra
  desktop command or arbitrary path argument is introduced.
- The frontend submits only branch identity. The backend discovers and returns the path, preventing
  the renderer from choosing a deletion target.

### Frontend feature layer

- Branch presentation consumes `linkedWorktreePath` for the badge and accessible title.
- Context policy owns switch blocking and the mutually exclusive worktree/branch delete actions.
- The existing branch mutation controller gains a reusable “requires review” predicate for both
  local-branch deletion and worktree removal.
- The review view renders the worktree path and hides remote-deletion controls for worktree
  removal.
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
- Verify ordinary branches and the primary worktree remain visually unchanged.

### WT2 — Reviewed removal

- Add the reviewed removal kind and nullable plan path.
- Enforce clean/locked/prunable/current/primary/exact-match checks.
- Add context policy, menu routing, review copy, execution, reconciliation, and demo behavior.
- Verify the branch remains after successful removal and becomes an ordinary local branch.

### WT3 — Acceptance and local installation

- Run focused frontend and Rust tests while iterating.
- Run the complete frontend script suite, TypeScript/build gates, Rust library tests, formatting,
  strict Clippy, and patch hygiene.
- Build the macOS application, verify its ad-hoc hardened-runtime signature and arm64 architecture,
  archive and hash it, replace the local installation through a recoverable backup, and run the
  installed native smoke test.

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
| Rust repository | clean removal succeeds and retains branch; dirty, untracked, locked, missing, current, primary, multiple, and stale targets fail closed |
| Context policy | linked row shows worktree removal and no branch deletion; ordinary row keeps branch deletion; logical multi-root rows remain read-only |
| Presentation | localized badge and path title render without changing ordinary branch/HEAD semantics |
| Reviewed controller | removal prepares immediately, waits for explicit confirmation, renders no remote option, and retains failed plans |
| Protocol | valid nullable path accepted; unknown kinds, missing path for removal, and path on unrelated kinds rejected |
| Demo | removal clears only the association and preserves the local branch |
| Frontend regression | `npm run test:scripts`, `npm run check`, and `npm run build` pass without relaxing ownership or bundle budgets |
| Native regression | `cargo test -p asterlyn --lib`, `cargo fmt --all -- --check`, and strict all-target Clippy pass |
| Patch hygiene | `git diff --check` passes; the dirty primary checkout remains untouched |
| Installed acceptance | packaged and installed executable hashes match; signature, architecture, and six-second native smoke pass |

## Rollback and non-goals

- Detection/presentation and mutation are separate rollback units. If removal is reverted, the
  worktree badge may remain useful, but no partially wired destructive menu item may remain.
- No `git worktree prune`, move, repair, lock/unlock, forced removal, branch deletion, remote
  deletion, or filesystem fallback is added in this delivery.
- No branch-name prefix is reserved for worktrees.
- No background worktree watcher or index is introduced; the existing repository refresh lifecycle
  remains authoritative.
- The primary checkout’s unrelated uncommitted files are outside this worktree and remain untouched.

## Completion record

- **Accepted branch:** `codex/delete-worktree-action`; implementation commit `a33ee5a`. The exact
  completion-record commit is reported in the handoff because a commit cannot embed its own hash.
- **Frontend:** TypeScript checking, the 762-test script suite, production Vite build, ownership
  budgets, protocol validation, and `git diff --check` passed.
- **Native:** Rust formatting, strict all-target workspace Clippy, and workspace tests passed. The
  `asterlyn-git` crate passed 126 tests; two unrelated operating-system watcher tests remain ignored
  by their existing contract.
- **Worktree coverage:** porcelain paths with spaces, detached records, locked/prunable state,
  malformed UTF-8, duplicate branch associations, clean removal, dirty/untracked invalidation,
  locked, missing, current, and stale targets passed. Successful removal retained the local branch.
- **Accepted package:**
  `target/release/bundle/macos/Asterlyn-worktree-actions-20260930-macos-arm64.zip`, 8,936,497 bytes,
  SHA-256 `fe236f20ac18e36dd9b8460f5ba68cc023cda9643dfb71fc289cf4d30af82ed3`.
- **Installed executable:** `/Applications/Asterlyn.app/Contents/MacOS/asterlyn`, 23,613,376 bytes,
  SHA-256 `f5a2f78368a3eef5cfd8d9a63ee3c5ac44cebeb44cfed0815700634fd1d21d0b`, exactly matching the
  packaged executable. The arm64 bundle is ad-hoc signed with hardened runtime, passed strict
  signature verification, and remained alive for the six-second isolated native smoke.
- **Previous installation backup:**
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20260930-worktree-actions-preinstall/Asterlyn.app`.
- **Host:** macOS 15.6.1 (24G90), Apple Silicon; Node.js 26.8.1, npm 11.19.0, Rust 1.97.1, and Git
  2.48.1. Windows/Linux compilation and installed interaction remain platform-specific follow-up
  gates; this local preview is neither Developer ID signed nor notarized.
