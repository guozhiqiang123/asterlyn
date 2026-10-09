# Compact Git Blame presentation plan

## Context

Asterlyn currently renders active Git Blame information in a dedicated CodeMirror gutter. The
gutter keeps authorship continuously visible, but its fixed width consumes a large part of ordinary
editors and becomes especially expensive in two-pane Diff and three-pane conflict layouts. The
repository query, exact source mapping, checked context action, and stale-request protection are
already correct; the problem is presentation density rather than Git ownership.

The replacement keeps Git Blame explicit and on demand while offering two persistent display
modes:

1. **Line end** — show the line's author and authored time after the code on each visible line.
2. **Line-number hover** — keep the editor unchanged until the pointer rests on a concrete line
   number, then show author and date in a lightweight tooltip.

Line-number hover is the default because it has no steady-state width cost.

## Invariants

- Enabling or changing Git Blame presentation never edits source text, changes selections, scrolls
  a pane, or starts a second repository query.
- The display mode is one application preference shared by ordinary editors, read-only and editable
  two-pane Diffs, and split three-pane conflict resolution.
- The existing right-click action remains the only show/hide control. A mode change reuses any
  loaded result and reconfigures active views immediately.
- Line-end annotations are CodeMirror widgets, not document content. They are created only for
  visible ranges so very large Blame results stay bounded.
- The hover target is the actual line-number element. Spacer, omitted, and unmapped projected rows
  do not invent authorship.
- Full author, email, date, object id, and summary remain available in the tooltip/title details;
  Local changes remain localized and visually distinct.
- Unified Diffs keep their existing source-identity restriction. This change does not weaken exact
  commit or conflict-stage provenance.

## Design

### 1. Persist a bounded display preference

Add `gitBlameDisplayMode` with the values `line-end` and `line-number-hover` to `AppPreferences`.
Advance the persisted preference version, migrate older values to line-number hover, validate all
updates, and expose a two-option control in Editor settings with localized labels and descriptions.

### 2. Replace the dedicated gutter with one shared extension

Replace `blameGutter` with a presentation extension that owns only rendering:

- Line-end mode uses a viewport-aware `ViewPlugin` and `Decoration.widget` ranges at line ends.
  The compact widget shows author and authored time with truncation and full details on hover.
- Line-number-hover mode adds no gutter. Pointer movement over `.cm-lineNumbers` resolves the
  document line, maps it to the exact source line, and shows a single app-styled tooltip anchored
  beside the hovered number. Leaving the number, scrolling, reconfiguration, or destruction removes
  it immediately.

Binary hunk lookup and source-line projection stay shared between the two modes. The old fixed-width
gutter styles and commit-tone background bands are removed.

### 3. Reconfigure every active editor owner

Thread the preference through the existing owners:

- ordinary text editor;
- read-only Diff editor;
- editable working Diff pane controller;
- conflict Ours, Result, and Theirs pane controller.

Each owner keeps its current loaded `GitBlameResult`. `setPreferences` reconfigures only the Blame
presentation compartment when the mode changes, so no network/native work and no content rerender
is required.

### 4. Interaction and accessibility

- Tooltip content uses localized date formatting and the existing full-details copy.
- Hover presentation uses `role="tooltip"`, does not capture pointer events, and remains inside the
  editor viewport.
- Line-end widgets use subdued semantic text, an explicit help cursor, a single-line ellipsis, and
  do not alter line height.
- Context-menu invocation from line numbers and code rows remains unchanged in both modes.

## Regression coverage

- Version-eight and malformed preferences migrate safely to line-number hover; both accepted modes
  round-trip and invalid updates fail closed.
- Editor settings render and update both localized mode choices.
- Active Blame switches modes without reloading, losing source mapping, or leaving stale tooltip DOM.
- Line-end mode annotates visible mapped lines, handles Local changes, and omits unmapped rows.
- Hover mode resolves the actual line-number target for before/after gutter placement and projected
  conflict rows.
- Existing show/hide, dirty-buffer invalidation, split/unified restrictions, and stale request tests
  continue to pass.

## Validation

1. Run focused preferences, localization, settings, context-menu, Diff navigation, and conflict
   Blame tests.
2. Run the complete frontend script suite, `npm run check`, and `npm run build`.
3. Run `cargo test -p asterlyn-git` to preserve the exact-source backend contract.
4. Build the release application, run the rendered native smoke test, replace the local macOS
   installation, and relaunch it for manual acceptance.

## Implementation result

- Settings now exposes localized **Line end** and **Line number hover** choices under Editor. The
  preference is validated, persisted as version nine, and older profiles migrate to the compact
  line-number-hover default.
- The fixed 260-pixel Blame gutter and commit-tone bands were removed. Line-end mode creates widgets
  only for visible mapped lines; hover mode targets the real line-number glyph and presents one
  bounded app-styled author/date tooltip without changing pane width.
- Ordinary editable files, read-only Diffs, editable working Diffs, and conflict Ours/Result/Theirs
  panes share the same mode. An active annotation is reconfigured from its cached result, while
  edits keep the existing saved-source invalidation behavior.
- Verified with 922 frontend script tests, TypeScript checking, the production web build, 133
  `asterlyn-git` tests, a release macOS application build, and the rendered native smoke test. The
  verified application was installed and relaunched at `/Applications/Asterlyn.app`; the previous
  installation remains recoverable in Trash as
  `Asterlyn-before-compact-git-blame-20261009.app`.
- Acceptance archive:
  `target/release/bundle/macos/Asterlyn-compact-git-blame-20261009-macos-arm64.zip`, 9,179,480 bytes,
  SHA-256 `6f6824e485c78040b66f5c2bb64e86f462e546317688b355f607bdec327ca649`.
