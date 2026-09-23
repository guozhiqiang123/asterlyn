# Temporal presentation and editor change-indicator acceptance evidence

## Scope

This checkpoint closes ADR-0016. History rows, commit details, branch details, and Push review use
one localized calendar/elapsed-time policy. Git Blame is the documented dense-table exception: it
shows `yyyy-MM-dd HH:mm` in a complete left-aligned column and the author in a right-aligned column.

The ordinary editor and the editable side of a working Diff now share one CodeMirror change
indicator extension. Added, modified, and deleted regions receive semantic left-gutter marks;
deletions use a visible minus notch. The overview ruler beside the right scrollbar renders the same
classification and each marker moves keyboard focus and the viewport to its change. Ordinary files
compare against a bounded exact-identity `HEAD` baseline, so saving a worktree change does not erase
its marker. Editable Diff reuses its existing repository source and issues no extra baseline read.

## Functional and safety evidence

- The complete frontend suite passes: **548 tests**. New focused coverage verifies localized Today,
  just-now/seconds/minutes/hours thresholds, exact older timestamps, the Git Blame exception,
  CRLF normalization, added/modified/deleted classification, baseline read deduplication, moved-HEAD
  stale-result rejection, unsupported-path fail-closed behavior, feature runtime disposal, and the
  existing source-ownership ceiling.
- `npm run check` and `npm run build` pass with TypeScript 7.0.2 and Vite 8.2.2.
- The baseline controller compares repository root, `HEAD`, path/original path, index/worktree
  status, conflict state, and submodule state before retaining a result. Repository replacement or
  relevant status movement removes the entry; an older promise cannot reinstall it.
- Baseline reads remain lazy: an unmodified, deleted, conflicted, submodule, unopened, ordinary
  folder, or non-main-root editor issues no new request and falls back to its persisted content.
- The active CodeMirror state, selection, undo history, and scroll state survive a baseline update;
  the controller updates only the indicator field.

No Rust or desktop-protocol source changed, so the native Git suite was not repeated for this
frontend-only checkpoint. The already accepted bounded `readWorkingDiffBase` boundary remains the
sole native source for ordinary-editor baselines.

## Browser interaction and visual evidence

The deterministic browser repository was exercised at the app's default viewport and dark theme:

- opening `src/app.ts` as a local editable Diff mounted two CodeMirror editors, exactly one change
  gutter on the editable side, and one modified overview marker;
- activating the ordinary source tab retained one gutter and one overview marker derived from the
  Git baseline;
- clicking an overview marker focused the editor and selected/scrolled to its corresponding active
  line;
- Git Blame produced `2026-09-08 11:50`; the timestamp's client and scroll widths were both 134 px
  (no clipping), computed alignment was left for time and right for author, and the marker used a
  two-column grid; and
- browser logs contained no warnings or errors after the Diff, source, overview-navigation, and
  Git Blame journeys.

The browser demo's older History and commit-detail values rendered as `yyyy/MM/dd HH:mm`. Relative
Today/elapsed forms use a deterministic clock in focused tests because the demo fixture intentionally
contains historical dates.

## Performance and bundle evidence

A production build emitted:

| Artifact | Raw | gzip | Interpretation |
| --- | ---: | ---: | --- |
| application/main JavaScript | 333.55 kB | 71.62 kB | below the enforced 500 kB startup ceiling |
| shared change-indicator chunk | 3.17 kB | 1.39 kB | loaded with CodeMirror, absent from the static shell |
| text-editor chunk | 11.47 kB | 4.19 kB | retained lazy editor ownership |
| editable-Diff chunk | 5.52 kB | 1.99 kB | shared indicator plus existing editable merge behavior |
| temporal formatter chunk | 1.05 kB | 0.54 kB | one shared formatting implementation |

Ten direct indicator calculations over a 100,000-line, 1,088,889-byte document containing one
replacement and one insertion had a **38.45 ms median** and **74.14 ms maximum** on the local Linux
host. This is below the existing two-MiB editor limit and uses the same 1,000-unit scan limit and
250 ms detailed-diff timeout as the editable merge surface. Incremental CodeMirror document changes
use `Chunk.updateB` rather than rebuilding the whole comparison.

No matched process-tree PSS/RSS series was run, so memory impact remains **inconclusive**. The
controller retains baselines only for changed files that an editor actually requests and releases
them on repository replacement or runtime disposal.

## Known limits

- The optional ordinary-editor local-Diff/rollback popover is not included. Gutter marks are
  informational; overview marks navigate. Editable Diff retains its existing explicit, undoable
  per-chunk rollback controls.
- The deterministic demo contains only compact change regions. Long-file overview position and
  click targeting are covered by line/offset tests and the bounded 100,000-line performance probe,
  not a separate installed-app fixture.
- This checkpoint did not repeat installed macOS/Windows visual testing or a native screen-reader
  pass. Browser acceptance covers semantic buttons, focus transfer, titles, and contrast tokens.

## Validation commands

- `npm run check`
- `npm run test:scripts`
- `npm run build`

### 2026-09-23 source-reveal frame follow-up

Working-Diff source reveal now activates the first ordinary-editor change block after opening the
source file. The shared indicator extension scrolls to the block and restores the complete focus
frame for both this route and overview-marker activation; edits or a replacement baseline clear a
stale frame. The follow-up style pass replaces the asymmetric three-pixel left edge with the same
one-pixel bright edge used on the right, top, and bottom. Focused line-range tests cover multi-line
and clamped single-line frames, and the complete frontend validation remains the acceptance gate.
