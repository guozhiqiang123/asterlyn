# On-demand Git Blame gutter evidence

Date: 2026-09-14

Status: locally accepted; installed-package interaction remains for manual acceptance

## Scope and behavior

This focused slice adds one shared line action to ordinary CodeMirror editors and text Diff
editors. Right-clicking either a line number or its code row exposes `Annotate with Git Blame`; a
successful request adds compact date-and-author annotations, and invoking the same action again
hides them.
The action is available independently on both sides of side-by-side Diff and is explicitly disabled
with a reason in unified Diff. No unrelated Android Studio gutter menu actions, language service,
index, cache database, polling task, background Blame scan, or Git mutation is added.

Ordinary files query the saved worktree version in their exact main or submodule Git root. Editing
an annotated buffer immediately removes stale annotations and disables the action until the buffer
is saved. Ordinary folders, ignored files, untracked files, and unavailable Diff sides fail closed
with visible reasons. Working Diff binds its before side to current `HEAD` and its after side to the
worktree. Commit, History, and Push-review Diff bind the before side to the exact first parent and
the after side to the selected commit.

The Git core runs machine-readable `git blame --incremental --no-progress` directly without a
shell. Object IDs and relative paths are validated and the repository root is resolved for each
request. Results retain contiguous hunks rather than expanding one DTO per line. Standard output is
bounded to 16 MiB; a truncated result retains only complete records and reports partial coverage.
Frontend completion requires the same editor, document, revision, side, and request generation.

## Validation

| Check | Absolute result | Conclusion |
| --- | ---: | --- |
| Frontend and architecture script suite | 350 passed | no regression observed |
| Rust workspace | 151 passed; 2 existing native-watcher tests ignored by contract | no regression observed |
| Git parser/repository suite | 72 passed, including incremental metadata reuse and worktree/commit/root-parent Blame | improved |
| TypeScript check | passed | no regression observed |
| Rust formatting | passed | no regression observed |
| Rust workspace Clippy with warnings denied | passed | no regression observed |
| Production frontend build | 326 modules transformed | no regression observed |
| Native release smoke | application remained alive for 6,000 ms | no regression observed |
| Debian metadata | `asterlyn` 0.1.0, `amd64` | passed |

One full script run performed concurrently with Rust compilation had a single timeout in the
existing asynchronous XML-fold fixture. The same four-test folding file then passed three
consecutive isolated runs, and the complete 350-test suite passed when rerun without competing
compilation. This is treated as load-sensitive test timing, not a product regression; no folding
code or timeout was changed.

The deterministic browser journey covered the complete interaction rather than only markup:

- an ordinary TypeScript editor displayed four date-and-author markers, hid them through the same
  checked menu item, and removed all four after an edit;
- reopening the menu for that dirty buffer exposed a focusable, semantically unavailable action
  with the saved-file reason;
- a working side-by-side Diff displayed five before-side and seven after-side markers independently;
- unified Diff exposed the same focusable unavailable menu item with the side-by-side explanation;
- the menu used `menu` and `menuitemcheckbox` semantics, transferred keyboard focus to the action,
  closed on outside input or Escape, and retained text reasons when disabled.

The browser uses synthetic repository data, so it validates presentation, focus, invalidation, and
revision routing rather than native Git output. The Rust integration fixture separately created a
real repository and proved committed lines, uncommitted lines, an exact commit, and the absent
parent of a root commit.

## Output, resource, and package evidence

No dependency was added. The shared gutter implementation remains in the lazy editor graph: a
welcome page does not load CodeMirror, the gutter module, or execute Git Blame. Its production
chunk is 30,560 bytes raw and 9,987 bytes through `gzip -c`. Visible-row lookup is binary search over
hunks and CodeMirror mounts markers only through its gutter viewport. There is no timer, worker,
retained repository index, or per-line result array.

| Output | Previous reference | Current | Normalized movement | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Startup JavaScript | 494,600 B | 517,172 B | +22,572 B / +4.56% | regressed |
| Main CSS | 120,132 B | 121,611 B | +1,479 B / +1.23% | regressed |
| Debian package | 7,891,514 B | 8,023,596 B | +132,082 B / +1.67% | regressed |

The JavaScript/CSS reference is the nearest recorded versioned-reconciliation build rather than a
rebuilt exact-base artifact, so attribution of all frontend movement to this slice is
**inconclusive**. The Debian comparison uses the immediately preceding local package. The native
executable is 22,763,040 bytes. No matched idle/activated process-memory series was run, so memory
movement remains **inconclusive**; structurally, idle memory does not retain Blame data and an active
result is bounded by the 16 MiB transport ceiling plus parsed hunk metadata.

The local unsigned acceptance package is:

- Path: `target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`
- Size: 8,023,596 bytes
- SHA-256: `da82ae3300e548325d4a61af21fbdb0f3a29647b338d9cd61e2ca962abe2c932`

## Limitations and next action

Unified text Diff and image Diff have no source-line Blame gutter. New/ignored files, unsaved
buffers, and a missing side are deliberately unavailable. Commit comparison follows the existing
first-parent Diff contract. The feature has no per-line history dialog, previous-change navigation,
copy action, durable result cache, cancellation command, or background refresh. A result remains
valid only for its mounted document and is discarded on edit, tab deactivation, or remount.

Functionality and interaction are **improved**; production and package size are **regressed**;
memory is **inconclusive**. The next action is manual acceptance of the Debian package, concentrating
on right-click positioning, horizontal space at typical editor widths, long author names, working
and commit Diff revision accuracy, and repeated show/hide behavior. Installed macOS/Windows gutter
interaction and a deliberately oversized Blame-output fixture remain later hardening work.
