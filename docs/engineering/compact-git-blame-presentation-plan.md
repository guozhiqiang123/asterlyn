# Compact Git Blame presentation plan

> Status: superseded on 2026-10-20. The persistent display preference and line-number-hover mode
> described below were removed after usage feedback. Git Blame is on-demand again.

## Current behavior

- Right-clicking anywhere in the CodeMirror gutter band exposes one checked Git Blame action. This
  includes line numbers, fold and change-indicator lanes, and empty gutter space below short files.
  Enabling it performs the exact-source request and renders a dedicated author/date gutter;
  disabling it removes the result without changing source content.
- The selected-line annotation remains at the line end while Blame is enabled, including when focus
  temporarily moves to a context menu or another application surface. The dedicated gutter keeps
  the compact `YYYY-MM-DD` date, while the line-end annotation shows the author and exact local
  authored time as `YYYY-MM-DD HH:mm`.
- Gutter rows follow the Android Studio-style `date | author` order. A fixed-width date column and
  an 8-pixel gap make every author begin at the same horizontal position; long author names are
  truncated inside a bounded author column.
- Committed author/date annotations are buttons. Activating one opens the Git panel, scopes History
  to the owning repository (including submodule roots), starts at the exact commit, and focuses it.
  Local/uncommitted annotations are not navigable.
- The focused target row remains fully painted after a pointer click. History keeps its bounded
  JavaScript render window as the only virtualization layer; CSS `content-visibility` is not used
  because macOS WebView can suppress the visible focused row's commit subject and metadata.
- The Editor settings no longer persist or expose a Git Blame display mode. Dirty, untracked,
  ambiguous unified-Diff, and stale-source safeguards remain unchanged.

The remainder of this document records the now-retired automatic compact-mode design.

## Restoration acceptance (2026-10-20)

- Functional coverage: 1,248 frontend script tests pass. A dedicated Chromium/WebKit rendered test
  verifies hidden-by-default state, activation from blank fold-gutter space without duplicate menu
  dispatch, one explicit load, fixed date/author column alignment, gutter `YYYY-MM-DD`, retained
  line-end `YYYY-MM-DD HH:mm`, focus-transfer persistence, exact repository/commit activation, and
  focused History-row paint stability. Existing Diff,
  editable Diff, conflict, and editor-patch rendered suites also pass in both engines.
- Build and performance: TypeScript checking and the production build pass; the startup chunk is
  499.23 kB against the 500 kB gate. Removing automatic loading avoids repository work until the
  explicit gutter action. The native application rendered its shell within the six-second smoke
  window.
- Lifecycle and accessibility: the checked context action restores editor focus, committed
  annotations are keyboard-focusable buttons, local annotations remain non-actions, and every
  controller invalidates requests/results and releases menu/view bindings on edit or destroy.
- Native acceptance package:
  `target/release/bundle/macos/Asterlyn-0.1.13-history-row-paint-20261020-final-macos.app.zip`,
  14,833,917 bytes, SHA-256
  `1081344d3e6684e9b9f84d62ff4c9eea35e44505e157e666e0bbe8c1eeb11e41`.
- The strictly verified ad-hoc bundle is installed and running at `/Applications/Asterlyn.app`.
  Its executable matches the accepted bundle byte-for-byte with SHA-256
  `0ab2dcbeb4c8bc6ccf28690957bc7c9720965eca153e06626f5c5c3e8f3cf388`.
  The replaced installation is recoverable at
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261020-200421-history-row-paint/Asterlyn.app`.
- Known limitations remain deliberate: unified Diff cannot expose one exact source identity; Local
  changes have no commit destination; a separate long-duration process-tree memory profile was not
  run for this bounded editor interaction.

## Context

Asterlyn currently renders active Git Blame information in a dedicated CodeMirror gutter. The
gutter keeps authorship continuously visible, but its fixed width consumes a large part of ordinary
editors and becomes especially expensive in two-pane Diff and three-pane conflict layouts. The
repository query, exact source mapping, checked context action, and stale-request protection are
already correct; the problem is presentation density rather than Git ownership.

The replacement makes Git Blame automatic for every eligible tracked source while offering two
persistent display modes:

1. **Line end** — show author and authored time only after the active cursor line in the focused
   editor pane.
2. **Line-number hover** — keep the editor unchanged until the pointer rests on a concrete line
   number, then show author and date in a lightweight tooltip.

Line-number hover is the default because it has no steady-state width cost.

## Invariants

- Opening or mounting an eligible source automatically starts at most one generation-guarded Blame
  request. Changing presentation never edits source text, changes selections, scrolls a pane, or
  starts a second repository query.
- The display mode is one application preference shared by ordinary editors, read-only and editable
  two-pane Diffs, and split three-pane conflict resolution.
- Git Blame has no separate show/hide switch. The preference only chooses how an automatically
  loaded result is presented, and a mode change reuses that result immediately.
- Line-end annotations are CodeMirror widgets, not document content. At most one exists: the main
  selection's head line in the focused editor pane. Moving the cursor or focus removes the previous
  widget immediately, so split Diff and conflict layouts never fill every pane with annotations.
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

- Line-end mode uses a selection- and focus-aware `ViewPlugin` with one `Decoration.widget` at the
  active line end. The compact widget shows author and authored time with truncation and full
  details on hover. It uses faint semantic text and italic styling so code remains visually primary.
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

Every owner also starts loading as soon as an exact, eligible source is mounted. Source identity,
generation, and loading state deduplicate repeated mounts and reject stale completions. Dirty,
untracked, unavailable, and unified/ambiguous sources silently omit annotations instead of exposing
another activation step.

### 4. Interaction and accessibility

- Tooltip content uses localized date formatting and the existing full-details copy.
- Hover presentation uses `role="tooltip"`, does not capture pointer events, and remains inside the
  editor viewport.
- Line-end widgets use faint italic semantic text, an explicit help cursor, a single-line ellipsis,
  and do not alter line height.
- Line numbers and code rows no longer expose a Git Blame show/hide context action. Existing
  unrelated context-menu behavior remains unchanged.

## Regression coverage

- Version-eight and malformed preferences migrate safely to line-number hover; both accepted modes
  round-trip and invalid updates fail closed.
- Editor settings render and update both localized mode choices.
- Active Blame switches modes without reloading, losing source mapping, or leaving stale tooltip DOM.
- Line-end mode annotates only the focused pane's active mapped line, follows selection and focus
  changes, handles Local changes, and omits unfocused or unmapped rows.
- Hover mode resolves the actual line-number target for before/after gutter placement and projected
  conflict rows.
- Automatic load deduplication, dirty-buffer invalidation, split/unified restrictions, and stale
  request tests continue to pass.

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
- The fixed 260-pixel Blame gutter and commit-tone bands were removed. Line-end mode creates one
  faint italic widget only for the focused pane's active mapped line; hover mode targets the real
  line-number glyph and presents one bounded app-styled author/date tooltip without changing pane
  width. Its hover listeners are bound to the editor root because CodeMirror renders line-number
  gutters outside the content DOM.
- Ordinary editable files, read-only Diffs, editable working Diffs, and conflict Ours/Result/Theirs
  panes share the same mode. Eligible exact sources now load automatically when their view mounts;
  the former line-number/code-row right-click toggle and its context action were removed. A loaded
  annotation is reconfigured from its cached result, while edits keep the saved-source invalidation
  behavior and unavailable or ambiguous sources remain silently unannotated.
- Verified with 930 frontend script tests, TypeScript checking, the production web build, 133
  `asterlyn-git` tests, a release macOS application build, and the rendered native smoke test. The
  verified application was installed and relaunched at `/Applications/Asterlyn.app`; the previous
  installation remains recoverable in Trash as
  `Asterlyn-before-active-line-blame-20261009.app`.
- Acceptance archive:
  `target/release/bundle/macos/Asterlyn-active-line-blame-20261009-macos-arm64-signed.zip`,
  9,258,998 bytes, SHA-256
  `77bad4eaaec9a86eefb6bf49238a2227791a6b2df595ce7427df60bd46b81649`.
