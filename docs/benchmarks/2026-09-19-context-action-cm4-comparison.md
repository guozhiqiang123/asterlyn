# CM4 two-commit comparison acceptance — 2026-09-19

## Outcome

H2 now shows **Compare Two Commits…** only for exactly two selected commits from one Git root. The
action opens a feature-owned comparison controller rather than reusing the active commit detail or
the single-commit first-parent Diff state.

The controller starts from the range anchor and active endpoint, asks Git for the exact ancestry
relationship, and automatically places an ancestor before its descendant even when filtered
History hides intermediate commits. Divergent commits retain anchor-to-active direction. Explicit
side swapping is authoritative and retry-safe; it is not automatically reversed again.

The detail pane shows the exact net file range in tree or flat form. Selecting a file opens an
independent `commit-comparison-diff` preview keyed by root, Git root, both object IDs, and path.
Text and supported images reuse the bounded read-only Diff presentation, file/change navigation,
expanded context, source reveal, split/unified preferences, and on-demand Git Blame. Old-side Blame
uses `beforeOid`; new-side Blame uses `afterOid`; added/deleted sides remain honestly unavailable.

## Safety and resource boundaries

- Git accepts only distinct full object IDs that resolve as commits; symbolic revisions are
  rejected.
- Every text/image request must match a current/original path identity from the exact comparison
  range.
- The file range is capped at 20,000 entries and 16 MiB of Git output. Text patches remain capped
  at 4 MiB and images retain existing decode/size limits.
- Controller generations reject stale comparison and file-Diff completions. Workspace replacement,
  a newer comparison, side swapping, or another file selection invalidates the older result.
- Opening the menu and opening the comparison are read-only. `HEAD`, index and worktree state are
  not implicit comparison inputs.

## Automated verification

| Check | Result |
| --- | --- |
| Comparison controller orientation/swap/retry/stale-result tests | 4 passed |
| H2 provider/policy/target tests | 5 passed |
| Full frontend/delivery suite | 437 passed |
| Git core suite | 83 passed |
| TypeScript, protocol generation, Clippy and desktop check | passed |
| Production build | passed |
| Production startup JavaScript | 633,767 B raw / 146,410 B gzip |

The startup increase over the range-action checkpoint is 21,257 B raw / 2,980 B gzip. It contains
the comparison controller, detail presentation, exact Diff routing, localization and composition.
It adds no row-scoped History listeners, polling loop, repository cache, or parallel source-of-truth
state. The existing startup chunk remains above the 500 kB architecture target.

## Browser interaction evidence

At a 1280×720 viewport in the built-in browser demo:

- Shift-selection produced two selected logical commit rows; right-click inside the range retained
  both rows and exposed Compare before the reviewed write actions.
- Compare opened the net two-file tree without changing the active endpoint or executing Git.
- Selecting `repository.rs` opened a split source Diff with the exact short Before/After IDs;
  Next File moved to `diff-editor.ts` inside the comparison range.
- Swap retained the same two-file range, reversed the displayed IDs, changed the relationship copy
  to “descendant before ancestor,” closed the obsolete preview, and restored focus to the Swap
  button after loading.
- `Shift+F10` opened the same H2 menu with Compare present; Escape returned focus to the exact
  invoking commit row.
- English/Simplified Chinese catalog parity, reviewed-literal checks and forced-colors gates passed.

## Known limits

- Comparison is a two-tree net Diff, not a patch series or an explanation of intermediate commits.
- A file absent from the current worktree cannot be opened through **Open Source**, although its
  historical Diff remains available.
- Ranges beyond the explicit file-count/output limits fail as too large; partial file trees are not
  presented.
