# Diff action controls visual polish plan

- **Status:** Planned
- **Date:** 2026-10-09

## Objective

Make every inline Diff action remain legible above change connectors, and give split, unified, and
two-pane Diff views one consistent interaction language without changing their existing decision
semantics.

## Behavior contract

- Apply, Ignore, and Rollback controls use the product accent blue as their default surface while
  retaining the existing 26-pixel geometry, four-pixel corner radius, and icon sizing.
- Hover, keyboard focus, selected, and disabled states remain visually distinct in both dark and
  light themes. Connector fills must not reduce the contrast of the button glyphs.
- Split conflict controls continue to use horizontal double chevrons pointing from Ours or Theirs
  toward Result.
- Unified conflict cards use vertical double chevrons: Ours points down toward Result and Theirs
  points up toward Result. Ignore remains the close icon.
- The two-pane divider keeps its full five-pixel drag target at all times, but its one-pixel visual
  line is hidden while idle and appears only while hovered, keyboard-focused, or dragged.
- The read-only two-pane Diff and editable two-pane Diff follow the same divider visibility rule.

## Implementation plan

1. Promote the shared Diff action control surface to the accent color and define shared hover,
   selected, focus-visible, and disabled presentations.
2. Add reusable vertical double-chevron icons to the icon registry and action presentation type,
   then assign them to the two unified conflict source directions.
3. Separate the two-pane splitter's persistent hit target from its transient visual indicator and
   remove the read-only splitter's always-visible background.
4. Extend source-level regression tests to lock the shared blue control surface, unified directional
   icons, and hover-only splitter behavior.

## Acceptance criteria

- All split Apply/Ignore controls, two-pane Rollback controls, and unified Apply/Ignore controls
  render on blue surfaces with unchanged dimensions and rounded corners.
- Unified Ours uses a double-down icon and Unified Theirs uses a double-up icon.
- Moving the pointer away from either two-pane divider hides its line without shrinking or
  disabling the drag target; hovering or dragging reveals the line.
- Existing conflict resolution, rollback, keyboard access, navigation, scrolling, and resizing
  behavior remains unchanged.
- Focused regression tests, the complete script suite, TypeScript check, production build, and
  native rendered smoke test pass before packaging the app for acceptance.
