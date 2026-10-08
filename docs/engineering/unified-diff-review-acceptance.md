# Unified Diff review acceptance

- **Status:** Automated acceptance complete; installed build awaiting manual visual acceptance
- **Plan:** [`unified-diff-review-workflow-plan.md`](unified-diff-review-workflow-plan.md)
- **Started:** 2026-10-08

This page is the durable acceptance record for the unified two-pane Diff and three-pane conflict
review workflow. Evidence is added after each independently buildable phase; unchecked items are not
claims of completion.

## Deterministic fixtures

Automated fixtures cover:

- replacement, insertion, and deletion;
- one-sided changes, identical two-sided changes, and divergent conflicts;
- large unchanged gaps and long lines;
- exact line endings and trailing-newline behavior;
- manual Result edits and independent Ours/Theirs decisions; and
- read-only two-pane, editable two-pane, and one-writable-Result ownership.

## Manual acceptance matrix

Run the matrix in both dark and light themes, and in English and Chinese.

| Surface | Required evidence | Status |
| --- | --- | --- |
| Read-only split Diff | headers, navigation, resizing, synchronized scroll, unchanged expansion | Ready for manual acceptance |
| Read-only unified Diff | navigation, unchanged expansion, visible whitespace | Ready for manual acceptance |
| Editable working Diff | Result priority, Revert, undo, save ownership, exact text | Ready for manual acceptance |
| Workspace replacement Diff | shared controls, consumer action, cancel/apply safety | Ready for manual acceptance |
| Three-pane conflict | aligned blocks, two-sided actions, manual edit, cancel, save and stage | Ready for manual acceptance |
| Long-line fixture | independent content ownership and synchronized horizontal navigation | Ready for manual acceptance |
| Large-gap fixture | identical folds and expansion across every visible pane | Ready for manual acceptance |
| Reduced motion | stable connectors without animated geometry | Ready for manual acceptance |

## Phase evidence

### Phase 0 — characterization

- Added deterministic projection and conflict-model fixtures.
- Locked immutable read-only Diff and single writable conflict Result ownership.
- No production behavior changed.

### Phase 1 — shared model and projections

- Added renderer-independent pane, block, action, capability, status, and summary contracts.
- Added adapters for static patches, live two-way chunks, and Base-anchored conflict blocks.
- Conflict summaries now distinguish one-sided, identical, divergent, reviewed, pending, and manual
  blocks without treating raw Diff fragments as user-facing conflicts.
- Manual Result edits are retained as explicit model state and are cleared only by a later deliberate
  block decision.

### Phase 2 — shared toolbar and commands

- Ordinary editor Diff and Push Diff now render through one capability-driven toolbar.
- Existing stable command IDs remain compatible through the `DIFF_REVIEW_COMMANDS` name.
- Conflict resolution now exposes previous/next block navigation, progress, whitespace display,
  Cancel, Save and Stage, and a visually separate delete-resolution action in the same header.
- Unsupported conflict file navigation and unified/split controls are omitted instead of disabled.

### Phase 3 — shared pane headers and resizable layout

- Read-only, editable, and conflict surfaces now use one pane-header renderer with explicit writable
  metadata and preserved revision casing.
- Read-only split Diff keeps a 50/50 default, editable Diff uses 42/58, and conflict uses 27/46/27
  so Result receives deliberate visual priority.
- Editable two-pane and conflict three-pane widths are pointer-draggable, keyboard-adjustable,
  double-click resettable, bounded, and persisted in workbench layout state.
- Conflict action gutters remain fixed-width while pane widths change, preserving control geometry.

### Phase 4 — shared block decoration and actions

- Editable Revert and conflict Apply/Ignore controls now use one action renderer, hit target,
  icon geometry, selected state, disabled state, focus treatment, and accessibility contract.
- Conflict block state is projected into Ours, Result, and Theirs as pending, accepted, ignored, or
  manually edited without depending on color alone.
- Previous/next conflict navigation marks the same active Base-owned block in every pane and moves
  focus to the writable Result.

### Phase 5 — folding, scroll, and connector geometry

- Two-pane editable Diff and three-pane conflict folds now use one anchor-owned coordinator; fold
  IDs and unchanged-line counts are projected consistently into every visible document.
- Conflict unchanged regions can be expanded or collapsed from the shared toolbar as one operation.
- Two-pane and three-pane editors render frame-coalesced SVG block connectors measured through
  public CodeMirror coordinates; overlays are clipped to visible content and never receive input.
- Existing document-anchored vertical synchronization and grouped horizontal scroll ownership are
  retained, while resize, fold, edit, splitter, and scroll events invalidate connector geometry.

### Phase 6 — conflict workflow completion

- `Ours`, `All`, and `Theirs` apply only untouched non-conflicting blocks; genuine divergent blocks
  stay pending and manually edited blocks are reported and preserved.
- A bulk application enters Result as one CodeMirror transaction, so the complete operation is one
  undo step while the transient decision model and block decorations update together.
- `Save and Stage` remains available for manual resolutions but requires explicit confirmation while
  pending blocks remain; the existing exact revision token, staged-blob verification, and mutation
  path remain unchanged.
- Conflict Cancel now uses the existing discard confirmation for a dirty Result, clears only the
  transient draft, and performs no Git mutation.

### Phase 7 — surface migration and cleanup

- History, commit comparison, stash, working-tree, and ordinary read-only text comparisons continue
  through the editor Diff adapter; Push, replacement, editable working Diff, and conflict now all
  render the shared capability-driven toolbar.
- Editor, Push, and replacement hosts retain isolated command attributes while sharing button
  markup, labels, state, and accessibility behavior.
- Shared review modules live under `src/shared/diff-review/`, preventing cross-feature imports; the
  architecture dependency and source-ownership budget suites remain green.

### Phase 8 — package and acceptance evidence

- The complete frontend suite passed: 885 tests, 0 failures. TypeScript checking, the production
  frontend build, and `git diff --check` also passed.
- The Rust workspace passed 271 tests with 0 failures and 2 existing ignored watcher tests. The
  release executable and the installed executable each rendered the application shell inside the
  six-second native smoke bound.
- The accepted macOS arm64 archive is
  `target/release/bundle/macos/Asterlyn-unified-diff-review-no-status-rail-20261008-macos-arm64.zip`,
  9,146,050 bytes, SHA-256
  `0d3f7ffe5de7ea1c548bdb09f9e28a315247b1261373c5397656eb0b52f6494d`.
- The packaged and installed executables are both 24,046,032 bytes with SHA-256
  `76625e13a187c4f01f4ed18b8f654d63fb31547de6ff699183fcdda319b25c1c`. The bundle is an arm64
  application with an ad-hoc hardened-runtime signature and passed strict deep signature
  verification before and after installation.
- `/Applications/Asterlyn.app` was replaced and relaunched against this worktree. The previous
  installation remains recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-no-status-rail-20261008-132018.app`.
- The final visual refinement removes the redundant 3px per-line conflict-status rail while keeping
  the 5px Diff gutter, connector status, action state, active-block emphasis, and ignored-text
  treatment. A focused source-level regression prevents the removed inset rail from returning.
- Host evidence: macOS 15.6.1 (24G90), Apple Silicon; Node.js 26.8.1, npm 11.19.0, Rust 1.97.1,
  and Git 2.48.1.
- The matrix above deliberately remains at `Ready for manual acceptance`: automated projection,
  interaction, geometry, exact-text, and installed-rendering checks are complete, but dark/light,
  English/Chinese, and reduced-motion visual inspection still requires a human acceptance pass.
