# Editable Diff and conflict editor acceptance evidence

## Scope

This checkpoint closes ADR-0015. Supported local text changes now use the existing editor-session
buffer in a full-document editable Diff: the repository side is immutable, the worktree side is
editable, and each change has an undoable in-buffer revert control. Conflicted paths appear in a
dedicated Changes group and open a persistent Ours | Result | Theirs editor. Only Result is directly
editable; directional controls apply one reviewed Ours or Theirs chunk into it. Save and Stage keeps
the existing exact conflict revision-token boundary.

Both merge surfaces load on first use. The static Files/Editor surface depends on small lazy ports,
not CodeMirror Merge or the concrete editable/conflict editor implementations. Git Operations also
depends only on narrow editor/session ports rather than importing another feature.

## Functional and safety evidence

- The complete frontend suite passes: **555 tests**, including working-buffer ownership, exact line
  endings, stale completion rejection, conflict grouping, conflict draft preservation, editor
  document identity, feature dependency direction, source ownership, stylesheet ownership, and
  lazy editor boundaries.
- `cargo test -p asterlyn-git` passes **105 tests**. Native coverage includes exact HEAD-side reads,
  untracked empty bases, restart-safe merge/rebase/cherry-pick conflicts, changed-worktree revision
  rejection, literal-path staging, and verified conflict continuation/abort behavior. Temporary Git
  repositories explicitly disable automatic line-ending conversion, so exact-byte assertions do not
  inherit a developer machine or CI runner's global `core.autocrlf` setting.
- `npm run build` passes TypeScript and the production startup budget.
- Conflict resolve start makes Result and both directional controls read-only until success or
  failure. A dirty draft blocks another conflict from replacing it and survives repository refresh
  when the indexed conflict changes externally.
- Conflicted paths cannot be excluded as ordinary commit inputs; they stay in the Conflicts group
  until Git reports no unresolved stages.
- The editable Diff uses CodeMirror Merge as its single line-gutter marker owner while retaining the
  shared overview ruler. This avoids adjacent, differently classified gutter colors for the same
  change. Expanding unchanged lines now changes the merge editor's collapse configuration and mount
  identity, so the control takes effect immediately without reusing a collapsed editor instance.
- Follow-up gutter hardening removed unsupported CSS ordering of `.cm-gutters`, disabled the native
  merge marker whenever the shared marker is installed, and moved left-side line numbers through
  CodeMirror's public after-content gutter contract. Read-only historical split Diffs now use the
  same centered numbers and one semantic marker strip instead of pane labels and colored number
  backgrounds. The conflict editor applies the same gutter contract to both merge projections and
  links their outer scroll owners.
- A 2026-09-21 theme follow-up replaces CodeMirror Merge's faint line fill plus two-pixel intraline
  gradient with the existing opaque semantic added/removed line fills. The shared editor theme is
  installed by editable working Diffs, read-only historical Diffs, and both conflict projections, so
  the correction does not fork those surfaces. Intraline marks become transparent and retain syntax
  color while the complete changed line carries the state background.

## Browser interaction and accessibility evidence

A local production-equivalent component preview was exercised at 1,280 × 720 in the dark theme.
The rendered accessibility tree exposed one `Conflict inputs` region, three textboxes, and named
`Apply this Ours change to Result` / `Apply this Theirs change to Result` buttons. Browser interaction
confirmed that editing the middle textbox changed Result without changing either source, and that a
Theirs arrow replaced Result with the corresponding Theirs chunk while both inputs remained intact.

Visual inspection confirmed equal Ours/Result/Theirs columns, source line numbers adjacent to the
center gutters, themed syntax and change fills, and visible directional controls. CodeMirror retains
keyboard editing, undo/history, find, selection, and focus behavior. This checkpoint did not run a
separate screen-reader session; its accessibility result is therefore structural and keyboard-level,
not a screen-reader certification.

The complete browser demo also opened a real local-change Diff through the lazy boundary: its busy
state cleared, two source documents mounted, and typing changed only the current-file side.

The follow-up browser pass inspected the rendered geometry rather than relying only on a screenshot:
the left line-number and marker gutters ended at the central revert column, the right pair began
immediately after it, and exactly two five-pixel marker gutters existed. Replacing the current side
with 140 lines produced a 2,705 px merge scroll height inside a 336 px surface; the merge container
reported `overflow: auto`, accepted vertical scrolling, and retained visible change markers. A
historical commit Diff exposed the same two centered line-number/marker pairs with no legacy pane
labels. The deterministic demo still has no live conflicted-index fixture, so conflict scrolling is
covered by the shared outer-scroll implementation and focused structure tests rather than a new
end-to-end browser conflict run.

## Build and resource evidence

Local production build on the project Linux host with Vite 8.2.2:

| Artifact | Raw | gzip | Interpretation |
| --- | ---: | ---: | --- |
| application/main JavaScript | 334,358 B | 71,563 B | below the enforced 500,000-byte startup ceiling |
| editable Diff implementation | 6,083 B | 2,200 B | loaded only after an editable local Diff opens |
| conflict editor implementation | 6,952 B | 2,498 B | loaded only after a conflict opens |
| shared indicator and CodeMirror Merge runtime | 54,768 B | 18,146 B | one on-demand dependency shared by Diff and conflict surfaces |

Moving the merge surfaces behind lazy ports initially reduced the same-build application chunk from
372,320 B / 83,730 B gzip to 333,050 B / 71,354 B gzip. The gutter/scroll follow-up leaves it at
334,358 B / 71,563 B gzip, still below the startup ceiling. This is strong startup-transfer evidence,
but no matched process-tree PSS/RSS series was run, so absolute memory impact remains
**inconclusive**. Diff computation remains bounded by the existing document-size policy and a
1,000-unit scan limit with a 250 ms algorithm timeout.

## Known limits

- Binary, invalid-UTF-8, symlink, submodule, read-only, and over-limit inputs fail closed instead of
  pretending to be editable.
- The deterministic browser demo has no live conflicted-index fixture; three-pane interaction was
  verified through an isolated local component preview, while the real Git lifecycle is covered by
  native repository tests.
- This Linux checkpoint did not repeat installed macOS/Windows package testing or a native
  screen-reader pass.
- Applying a side chunk is an in-memory Result edit. Nothing reaches disk or the index until the
  explicit Save and Stage action passes the exact revision-token verification.

## Validation commands

- `npm run check`
- `npm run test:scripts`
- `npm run build`
- `cargo test -p asterlyn-git`
