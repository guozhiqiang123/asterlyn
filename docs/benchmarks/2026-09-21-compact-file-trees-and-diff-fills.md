# Compact file trees, Diff fills, and Unversioned Trash evidence

- **Date:** 2026-09-21
- **Status:** locally accepted; installed native system-Trash behavior remains a manual platform check
- **Scope:** shared compact file-tree projection, CodeMirror Merge full-line backgrounds, and persistent Unversioned Trash review mounting

## Accepted behavior

- Project Files, Changes, commit details, commit comparisons, and projected commit-folder details use
  one pure `compactDirectoryChain` projection. A consecutive unary directory chain such as
  `docs/refactor/rebuild` occupies one row; branching stops compaction. The terminal directory owns
  disclosure and context actions, while Project Files still recognizes an intermediate represented
  path for selection, reveal, focus, and scroll targeting.
- All three primary file-tree surfaces use a 25-pixel shared row-height constant and a 12-pixel
  indentation token. Directory rows include localized recursive file counts. Project file and folder
  labels use the same configured UI size. Project and Changes virtualization calculations consume the
  same row-height constant used by CSS.
- CodeMirror Merge changed lines use the existing opaque semantic added and removed backgrounds.
  The package's default intraline underline gradient is disabled, while syntax foreground colors and
  full-line state remain visible. The one shared editor theme covers editable, historical, and
  conflict Diff surfaces.
- **Move All Unversioned Files to Trash…** once again opens its required destructive confirmation
  after the application shell has been replaced. The window-scoped runtime reattaches its persistent
  host before rendering; exact-path validation, dirty-buffer blocking, editor leases, system Trash,
  reconciliation, and untracked rescanning remain unchanged.

## Automated evidence

| Gate | Result |
| --- | --- |
| TypeScript check | passed |
| Complete frontend/delivery script suite | 567 passed |
| Production frontend build | passed; startup bundle remains below its enforced budget |
| `cargo test -p asterlyn-git` | 105 passed |
| Focused compact-tree tests | unary chains, branching boundaries, terminal disclosure keys, localized counts, and virtual row heights passed |
| Focused Trash tests | detached-host restoration and exact group mutation lifecycle passed |
| Theme tests | opaque added/removed tokens and MergeView full-line selectors without underline gradients passed |
| Ownership gates | `app.ts` remains below its reviewed ceiling; feature and stylesheet ownership passed |

## Browser interaction and accessibility evidence

The deterministic local preview showed compact paths including `crates/asterlyn-git/src` in Project
Files, Changes, and commit details. Measured project folder and file rows were both 25 pixels high and
both used the configured 13-pixel UI font. Expanding and collapsing the compact terminal path changed
its `aria-expanded` state from false to true and back without losing the row. The accessibility tree
retained tree/treeitem roles, named disclosure buttons, recursive file counts, selected file state,
and exact file actions.

A real local-change MergeView reported `rgb(91, 45, 50)` for the removed-line background and
`rgb(41, 68, 54)` for the added-line background. Its `.cm-changedText` span reported no background
image, confirming that the underline gradient was removed. The browser console contained no warning
or error during the accepted pass.

## Performance, memory, and known limits

Unary-directory compaction reduces mounted rows for deep path-only chains and preserves the existing
200-row virtual mount budgets, but no normalized latency or process-memory series was run. Performance
and memory impact are therefore **inconclusive**, not claimed as an improvement.

Disclosure remains session presentation state. Compact rows deliberately target the terminal
directory; intermediate path segments are represented for selection/reveal, not exposed as separate
context-menu targets until the chain branches. System Trash remains recoverable but non-atomic across
multiple platform calls. The browser demo cannot perform a real platform Trash move, so an installed
macOS, Windows, or Linux package must still verify the final operating-system integration and partial-
failure message.

## Validation commands

- `npm run check`
- `npm run test:scripts`
- `npm run build`
- `cargo test -p asterlyn-git`
