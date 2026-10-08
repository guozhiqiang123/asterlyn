# Three-pane conflict scroll synchronization fix

## Problem

The conflict editor renders the left pair and the incoming pane in two independent CodeMirror
`MergeView` scroll containers. Their vertical positions are linked through the duplicated Result
document so panes with different diff spacer heights can still align the same Result line.

The document-linked update is currently deferred with `requestAnimationFrame`. During continuous
wheel or trackpad input, the source container is painted at its new position while the incoming pane
is still waiting for the next frame, so the third pane visibly trails the other two even when every
unchanged section is expanded.

## Plan

1. Keep document-position mapping as the vertical source of truth; do not replace it with raw pixel
   or scroll-percentage mapping.
2. Make only document-linked vertical mirroring run in the current scroll event, before the next
   paint. Keep the existing frame coalescing for other linked-scroll users.
3. Preserve feedback suppression so a programmatic mirror event cannot reverse ownership or create
   a scroll loop.
4. Add focused regression coverage proving a document-linked target updates immediately without
   waiting for the frame scheduler, including reverse-direction scrolling.
5. Run focused linked-scroll tests, the complete script suite, type checking, and the native rendered
   smoke test before installing the acceptance build.

## Acceptance criteria

- Continuous upward and downward scrolling keeps the incoming pane on the same Result document
  anchor as the first two panes with no one-frame visual lag.
- Unequal diff spacer heights remain supported.
- Horizontal scroll ownership and non-conflict linked-scroll behavior remain unchanged.
- Programmatic mirror events do not cause feedback loops.
