# Checked commit workflow evidence

## Scope and comparison

This correction replaces the visible staged/unstaged workflow in the Changes tool with a compact whole-file commit workflow. Android Studio was used only as interaction-density evidence: Asterlyn retains original markup, icons, styles, wording, and implementation. Refresh, Revert, complete local Diff, tree/flat presentation, recursive expand, and recursive collapse now occupy one toolbar. Versioned and unversioned paths are displayed once, all newly discovered paths are checked by default, and a persisted resizable lower region owns the commit message and action.

Commit inclusion and row selection are deliberately independent. A checkbox changes only the exact whole-file commit set. Clicking or keyboard-activating a row changes one selected path and opens its complete `HEAD`-to-worktree Diff. Group and directory checkboxes are tri-state projections over descendant paths; switching between tree and flat views does not alter inclusion.

## Git transaction boundary

The frontend sends complete last-observed `FileChange` values rather than untrusted path strings alone. Under a canonical-root mutation lock, the Git core repeats full status, requires exact identity equality, rejects active repository operations, conflicts, and submodule changes, and expands current/original rename paths as literal pathspecs. `git commit --only` commits the checked files' current worktree content while unrelated staged entries remain staged. Selected untracked paths receive temporary intent-to-add entries; a spawn, write, wait, hook, or ordinary command failure removes only entries introduced by this request.

After Git returns successfully, Asterlyn verifies that the observed object has the captured `HEAD` as its sole parent, or no parent for a root commit, and that its no-renames changed-path set is a subset of the selected current/original allowlist. It never rolls `HEAD` back after a mismatch because an external Git client may have advanced the same branch. A rejected command with concurrently changed `HEAD` preserves both the ref and index and requires refresh before retry. A successful command whose final state cannot be verified returns no object ID plus a do-not-retry warning, preserves the observed history, and refreshes the workbench. Commit success is also returned separately from a following refresh failure. Existing stage/unstage compatibility commands and all local/remote writes use the same process-local per-root lock.

Revert is intentionally smaller than a general discard/reset feature. It applies only to the selected row after an exact confirmation, blocks a matching dirty editor buffer, repeats backend identity checks, and refuses unborn, untracked, index-added/copied, conflicted, and submodule paths. The supported tracked path is restored from `HEAD` in both index and worktree. No clean or broad reset command is exposed.

## Interaction evidence

The deterministic browser workbench was exercised at its default 1,280 × 720 viewport:

- Five changed paths initially appeared checked and the action read `Commit 5`.
- Unchecking `crates/asterlyn-git/src/repository.rs` changed the action to `Commit 4`; the editor remained on Welcome, proving inclusion did not activate a row.
- Clicking `src/app.ts` opened the complete local Diff in the center editor.
- Tree-to-flat-to-tree switching retained the excluded `repository.rs` state. Folder actions changed ten open disclosures to zero and back to ten.
- A pointer drag increased the commit-composer height from 230 to 263 pixels.
- Entering `Demo checked commit` enabled the exact `Commit 4` action. Activating it removed those four checked paths, retained the one unchecked `repository.rs` change, and added the new commit to history.
- The accessibility tree exposed the six toolbar actions, group/file checkboxes, selected row, commit count, and resizable separator by name.
- The browser console reported no warnings or errors.

This deterministic run verifies state routing and completed pointer interaction. It is not a frame-time measurement and does not replace installed macOS visual acceptance.

## Automated validation

- TypeScript checking passed.
- All 156 frontend and delivery script tests passed in 1,905 milliseconds.
- The production frontend build passed with 221 transformed modules. Its main CSS is 87.67 kB raw and 20.68 kB gzip; the main JavaScript is 668.04 kB raw and 192.04 kB gzip. The existing greater-than-500-kB warning remains.
- The wrapped Rust workspace run passed 14 desktop-library tests, one desktop-binary test, 38 Git-core tests, 23 workspace tests, and all doc tests.
- Strict all-target workspace Clippy, Rust formatting, and diff whitespace checks passed.
- The release executable remained alive for the complete 6,000-millisecond isolated native smoke interval.

The Git tests specifically retain unrelated staged entries while committing a partially staged selected file's worktree content; commit selected untracked content on an unborn branch without absorbing another index entry; clean temporary intent entries after a rejecting hook; reject stale status identity; handle a staged rename and a filename containing literal pathspec syntax; return a complete staged-plus-worktree local Diff; and restore a tracked file while refusing to delete an untracked file. Two deterministic hook tests additionally advance `HEAD` during a rejected command and after a successful commit: the concurrent history is retained in both cases, the first preserves the exact cached diff, and the second returns a warning outcome while retaining both commits and the unrelated staged file.

## Package and conclusion

The local Debian package is `Asterlyn_0.1.0_amd64.deb`, 6,646,092 bytes, with SHA-256 `fe3f8ba6d2ba91f2509caefd019c14a579dcfe266062f146c22ce42172d0d931`. Package metadata reports `asterlyn` 0.1.0 for `amd64`. It is 69,756 bytes, or 1.061%, above the immediately preceding 6,576,336-byte package. Package size is therefore **regressed** for this focused correction; the increase is visible but does not block interaction acceptance.

Interaction and commit-boundary correctness are **improved**: manual staging is no longer part of the ordinary commit path, a file has one visible identity, unchecked index state cannot leak into the selected commit, and destructive Revert fails closed outside its narrow supported set. Runtime memory is **inconclusive** because no normalized process series was run. Remaining limits are whole-file rather than hunk-level inclusion, one selected row for Revert, no amend or commit-and-push composition, no untracked deletion, no conflict-resolution workflow, no submodule mutation routing, and no new installed Windows/macOS interaction evidence. Manual acceptance should first verify compact sizing, checkbox selection, row-to-Diff activation, Revert confirmation, commit preservation of an independently staged file, and both Changes splitters in the packaged Linux application.
