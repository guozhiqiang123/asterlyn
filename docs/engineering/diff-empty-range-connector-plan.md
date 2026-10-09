# Diff empty-range connector plan

- **Status:** Planned
- **Date:** 2026-10-09

## Problem

Pure additions and deletions contain a zero-length range on the empty side of the Diff. The current
geometry measures that range with `coordsAtPos` as though it occupied a complete code line, and the
connector path then forces every edge to be at least two pixels tall. The waveform therefore opens
from a false line-sized rectangle and becomes a wedge or bulb inside CodeMirror's alignment space.

The alignment space itself is intentional: it keeps the first unchanged line after a change at the
same vertical position in both editors and is required by linked scrolling. Removing it would trade
the visual artifact for incorrect line correspondence.

## Behavior contract

- A non-empty source range continues to connect its complete first-to-last rendered line bounds.
- A zero-length source range is represented by a compact anchor at the document boundary where the
  addition or deletion occurs.
- At a line boundary, the anchor uses the bottom edge of the preceding rendered line, before any
  MergeView alignment spacer. At document start it uses the first line's top edge; an in-line anchor
  uses the caret's vertical center.
- The connector tapers to zero height at an empty side instead of inventing a minimum-thickness
  rectangle. The non-empty side still covers the full changed block.
- Existing MergeView spacers, line-number alignment, folding, action placement, resizing, and linked
  scrolling remain unchanged.
- Anchors outside the visible viewport remain unpainted, matching existing connector clipping.

## Implementation plan

1. Give the shared Diff geometry a dedicated zero-range measurement path based on CodeMirror line
   blocks and document coordinates, avoiding DOM-class queries and spacer implementation details.
2. Allow the SVG connector builder to form a zero-height cusp on either edge while retaining normal
   block geometry for modifications.
3. Add geometry regressions for compact addition and deletion anchors, document boundaries, and
   unchanged normal block paths.
4. Run the focused geometry suite, complete script suite, TypeScript check, production build, and
   native rendered smoke test before packaging the app for acceptance.

## Acceptance criteria

- A pure addition tapers to one insertion anchor on Before and spans the full added block on After.
- A pure deletion spans the full removed block on Before and tapers to one deletion anchor on After.
- No false one-line-high connector block appears inside an otherwise empty alignment region.
- Modification and conflict connectors retain their existing full-height appearance.
- Lines following the change remain vertically aligned in both panes.
