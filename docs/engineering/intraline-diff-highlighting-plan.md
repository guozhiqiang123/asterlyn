# Intraline Diff highlighting plan

- **Status:** Implemented
- **Date:** 2026-09-28

## Objective

Make text Diffs expose both the changed lines and the exact changed text inside those lines. The
result should follow the information hierarchy used by the IntelliJ/Android Studio Diff viewer while
remaining native to Asterlyn's CodeMirror architecture:

1. a low-emphasis whole-line or whole-block background establishes change geometry;
2. a stronger inline background identifies the exact inserted, removed, or replaced text; and
3. split and unified layouts keep their distinct semantics instead of forcing one renderer onto both.

This work covers editable working Diffs, read-only patch Diffs, and the MergeView projections used by
the conflict editor. It does not add syntax-aware or AST-aware comparison and does not copy JetBrains
implementation code.

## Current state

- Editable and conflict Diffs use `@codemirror/merge` over complete documents. CodeMirror already
  computes inline changes, but the shared editor theme intentionally makes its `cm-changedText`
  decoration transparent.
- Read-only Diffs parse a bounded Git unified patch into synthetic source documents. Their inline
  comparison only retains one middle range after removing a shared prefix and suffix, and changed
  lines are paired solely by array offset.
- The color registry already has added and removed line/inline colors, but no editor-level modified
  line or modified inline token.

## Research basis and stack fit

JetBrains documents two separate parts of the Diff contract:

- Added lines are green, modified lines are blue, and deleted lines use the removed/deleted color.
- Difference granularity is configurable as Words, Lines, Characters, None, with an additional Split
  changes option for breaking large blocks into smaller change groups.
- Side-by-side and unified viewers are distinct layouts, and corresponding side-by-side lines may be
  vertically aligned with empty padding.

Source: [JetBrains Diff Viewer for files](https://www.jetbrains.com/help/idea/differences-viewer.html).
The reference screenshot is consistent with the Words presentation: a low-emphasis line background
shows the change block and a stronger inline background shows the replaced word or expression.

The current stack can implement that visual hierarchy without replacing either renderer:

- `@codemirror/merge` already exposes presentation-oriented character ranges through
  `presentableDiff` and live editable chunks through `getChunks`.
- The editable and conflict views can add semantic decorations over those live chunks while leaving
  CodeMirror responsible for editing, undo, chunk updates, and revert controls.
- The read-only viewer can apply the same character comparison to its bounded Git patch projection,
  but must align changed lines itself because it does not own the complete old and new documents.

This implementation deliberately fixes the product at word-oriented highlighting for now. Adding a
Words / Lines / Characters / None preference is a separate product-control change, not required to
make the changed content visible.

## Target presentation contract

### Split view

- A one-sided insertion is green and a one-sided deletion uses the removed color.
- A row with source text on both sides is a blue modified row on both sides.
- A replacement range with text on both sides uses the stronger modified color.
- An insertion or deletion inside an otherwise modified row keeps its added or removed inline color.
- Empty alignment rows remain neutral spacers.

### Unified view

- Removed rows and their inline ranges use removed colors.
- Added rows and their inline ranges use added colors.
- Unified rendering does not convert a removed/added pair into a blue line because both revisions are
  represented as separate rows.

### Comparison behavior

- Inline changes use `@codemirror/merge`'s bounded `presentableDiff`, which supports multiple ranges
  and presentation-oriented word-boundary cleanup.
- Read-only replacement blocks use a bounded dynamic line alignment before inline comparison so an
  inserted line does not shift every later old/new pair.
- Oversized alignment matrices fall back to stable offset pairing. The character diff retains a scan
  limit and timeout and may fall back to coarse ranges rather than blocking the UI.
- Showing whitespace remains a display preference; it does not become an ignore-whitespace policy in
  this slice.

## Implementation sequence

1. Add semantic modified line and inline colors for both themes.
2. Add a shared MergeView decoration extension that classifies live CodeMirror chunks and paints
   exact inline ranges for editable and conflict Diffs.
3. Replace the read-only prefix/suffix comparator with `presentableDiff`, add typed inline ranges, and
   introduce bounded line alignment for changed blocks.
4. Render modified rows and typed inline ranges in the read-only split viewer while preserving the
   unified viewer's removed/added semantics.
5. Expand parser, line-alignment, theme, and integration tests; run the complete frontend script,
   type-check, and production-build gates.
6. Record final validation here and amend the documentation map. Historical benchmark records remain
   unchanged because they describe the behavior accepted at their original checkpoint.

## Acceptance matrix

- One replacement, multiple separated replacements, insertion-only text, and deletion-only text in a
  modified line each receive the correct exact ranges.
- A fully replaced line still receives an inline range even without a common prefix or suffix.
- Leading and middle inserted lines do not mispair all later modified lines.
- Split read-only, unified read-only, split editable, unified editable, and conflict MergeViews retain
  their documented color semantics.
- Dark and light themes define opaque, visibly distinct modified line fills and stronger inline fills.
- Unicode text, long lines, no-newline markers, navigation blocks, gutters, source line numbers,
  collapse/expand behavior, and editable undo/revert ownership remain intact.

## Validation record

- Semantic coverage includes full replacements, multiple separated replacements, insertion-only and
  deletion-only text, leading and middle inserted-line alignment, unified semantics, Unicode, and
  long lines.
- Theme coverage checks opaque modified-line colors in dark and light modes and stronger inline
  added, removed, and modified layers without gradient underlines.
- Integration coverage checks that editable working Diffs and conflict MergeViews install the shared
  live-chunk highlighter.
- `npm run test:scripts`: passed all 659 tests.
- `npm run check`: passed TypeScript type-checking.
- `npm run build`: passed; Vite transformed 458 modules and produced the production bundle.
- `git diff --check`: passed.
