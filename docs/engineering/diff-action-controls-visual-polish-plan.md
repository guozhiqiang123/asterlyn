# Diff action controls visual polish plan

- **Status:** Implemented
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

## Verification

- Focused style and unified-conflict regressions: 29 passed, 0 failed.
- Complete script suite: 908 passed, 0 failed.
- TypeScript check and production web build: passed.
- macOS release bundle build: passed.
- Native rendered-shell smoke test: passed.

## Connector boundary correction — 2026-10-23

The two-pane connection fill could leave a gap along the left action-gutter border in a bordered
host. Page-coordinate measurements included the host border, but SVG absolute positioning applied
that border a second time. A real Chromium fixture reproduced a 1.0037px displacement with a 1px
host border; WebKit showed the same behavior in an isolated layout probe.

Overlay clipping still uses viewport/page coordinates. CSS positioning now uses the host padding
origin, accounting for border and host scroll offsets. This changes neither button dimensions nor
revert behavior, keyboard/focus semantics, connector colors, or document projection.

Rendered acceptance checks both connector edges and SVG frame coordinates within 0.05 CSS pixels,
across light/dark themes and 0/1/2px host borders in Chromium and WebKit. The test failed on the
original implementation before this correction. Verification and fresh local-package evidence are
recorded below. The extra measurements are constant per coalesced overlay frame;
no timers, document traversals, persistent state or per-block resources were added.

### Correction verification

- Before the fix, the new rendered assertion failed at a 1.0037px left gap for a light-theme host with a 1px border.
- After the fix, Chromium and WebKit passed all 12 theme/border combinations, including both connector endpoints and the SVG frame's horizontal/vertical origins.
- Existing Diff regressions passed (fold expansion anchoring, footer alignment, splitters, clickable revert and long-file scroll/resize); conflict rendered regression passed 32 scenarios across both engines.
- Geometry tests: 7 passed. Complete script suite: 1,281 passed. Type check and production build passed.
- Accessibility: no control, focus, keyboard or pointer-target geometry changed. Performance/memory: constant origin arithmetic per coalesced frame, with no additional retained resources. Target-specific transformed/zoomed host layouts beyond the existing rendered fixtures remain outside this acceptance.

- Fresh version `0.1.19` native bundle passed ad-hoc signing, strict identity/resource verification and signed-executable rendered startup smoke.
- Archive: `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.19-20261023-144831-macos.app.zip`; SHA-256 `201b6731d4c7d89173820b4b617f06bd19154b7ecd63094e684fd9965478d627`.
- Installed executable matches the accepted bundle byte-for-byte: SHA-256 `438c52246e74176860efb22dfd0f9e88c92787ea9e865c0b68d1bcd5d2ec723f`. Previous installation copied to `/Users/gzq/Library/Application Support/Asterlyn/local-install-backups/connector-20261023-144831.app` before replacement.
- Installed PID `89553`, session `session-1792738114150-89553-0`, build `5b3e03fb91894977523baa00300e053410b6547d-dirty-1792738018240`: frontend readiness and JSON output ordering verified from logs. App left running; no commit or publication performed.

## Empty-side fill root cause — 2026-10-23

Manual acceptance passed; grouped commit authorized on 2026-10-23.

The border-origin correction above addressed a real one-pixel displacement, but did not resolve
the reported empty-side fill. Pure additions have no Before text range; pure deletions have no
After text range. The implementation from `5c7c255` deliberately collapsed that edge to a
zero-height cusp, even though MergeView reserves a visible alignment slot there. The SVG path's
bounding box still touches both gutter edges, so the earlier bounding-box tests passed while the
fill beside the action remained absent. The user screenshot has fill touching the left edge on
only one raster row, consistent with the addition cusp reproduced in both browser engines.

The shared geometry now uses CodeMirror's public `BlockInfo`/`BlockType` measurements to give an
empty range the height of its actual zero-length alignment widgets. It keeps the insertion
boundary, including the empty-file placeholder and trailing-spacer cases, and clips a partially
visible slot instead of dropping it when its anchor leaves the viewport. No document, spacer,
action position, or line-number layout changes. A range with no alignment widget retains its
compact anchor; collapsed replacement widgets do not create false connector bands.

For long changed blocks, an endpoint may be outside CodeMirror's mounted DOM viewport. The
connector falls back to public text-block geometry when caret coordinates are unavailable;
otherwise the entire visible band disappeared after scrolling. The new long-file fill assertion
also reproduced that failure before the fallback was added.

Regression acceptance must sample the **interior fill** next to both gutter borders, rather than
only measuring the path's bounding box. The rendered suite covers additions and deletions at the
start, middle, end, and empty-file boundary in both themes; it also checks unchanged-line
alignment, revert interaction, and connector visibility while scrolling/resizing a long addition.
Before this change the first new assertion failed with `[false,true,false,true,false,true]`:
all three added lines had an unfilled left edge and a filled right edge.

### Follow-up verification

- The new interior-fill assertion fails on the previous cusp geometry and passes with the real
  alignment slot. Chromium and WebKit pass all 32 theme/location/direction cases combined.
- Both engines also pass long-file fill after 300px/wheel/middle/end scrolling and resize, along
  with unchanged-line alignment, clickable revert, splitter dragging, folding, and footer checks.
- Shared conflict rendered suite: 32 scenarios passed. Geometry regressions: 11 passed.
- Complete script suite: 1,292 passed, no failures. TypeScript check and production build passed.
- Accessibility: action DOM, keyboard/focus behavior and pointer targets are unchanged.
  Performance/memory: bounded public line-block reads per coalesced overlay frame; no listeners,
  timers, persistent data, retained per-block state or new DOM nodes were added.
- Fresh `0.1.19` macOS bundle built, ad-hoc signed and strictly verified; the signed bundle's
  executable passed native rendered-shell smoke within 6,000ms.
- Accepted package: `target/release/bundle/macos/Asterlyn-0.1.19-20261023-connector-fill-macos.app.zip`,
  15,069,859 bytes; SHA-256
  `dc7923ba8c1709bfcfa591597ef2d1e033dd814fcb824857b0dee679d1b8507e`.
- Repository installer replaced `/Applications/Asterlyn.app` through atomic Contents exchange;
  installed root inode `203606126` and icon item `145` stayed intact. A verified ZIP backup was
  retained, with no expanded application backup or unrelated Launchpad change (89 entries checked).
- Installed signature passed strict verification, and executable matches the accepted bundle:
  SHA-256 `6daeac23e2bca7a2ab4670e6045f9599221525d65f1a059973319dfbea301dc8`.
- Saved-icon launch PID `7401` and quit/reopen PID `7424` both persisted
  `application.frontend_ready`. Sessions: `session-1792741753287-7401-0` and
  `session-1792741754639-7424-0`; build
  `5b3e03fb91894977523baa00300e053410b6547d-dirty-1792741621287`.
  Installer evidence: `/tmp/asterlyn-connector-fill-install.json`. App left running; changes uncommitted.
