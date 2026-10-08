# Unified Diff review acceptance

- **Status:** Pending implementation
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
| Read-only split Diff | headers, navigation, resizing, synchronized scroll, unchanged expansion | Pending |
| Read-only unified Diff | navigation, unchanged expansion, visible whitespace | Pending |
| Editable working Diff | Result priority, Revert, undo, save ownership, exact text | Pending |
| Workspace replacement Diff | shared controls, consumer action, cancel/apply safety | Pending |
| Three-pane conflict | aligned blocks, two-sided actions, manual edit, cancel, save and stage | Pending |
| Long-line fixture | independent content ownership and synchronized horizontal navigation | Pending |
| Large-gap fixture | identical folds and expansion across every visible pane | Pending |
| Reduced motion | stable connectors without animated geometry | Pending |

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
