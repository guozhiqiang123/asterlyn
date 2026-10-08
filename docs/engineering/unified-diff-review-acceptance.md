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
