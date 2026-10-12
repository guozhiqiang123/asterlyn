# Editor change Patch popover plan

Status: implemented and locally accepted on 2026-10-12. Verification evidence is recorded in
[`../benchmarks/2026-10-12-editor-patch-popover.md`](../benchmarks/2026-10-12-editor-patch-popover.md).

## Problem statement

Ordinary editable files already render repository-derived added, modified, and deleted markers in
the editor gutter. The markers identify exact changed blocks and the overview ruler can navigate to
them, but the gutter marker itself is passive. A user who wants to inspect or undo one local change
must leave the source editor and open a whole-file Diff.

The intended interaction is a compact Patch popover anchored to the clicked gutter marker. It shows
only the selected changed block and keeps the ordinary editor as the active work surface.

## Product outcome

- Clicking an added, modified, or deleted gutter marker opens an editor-owned Patch popover.
- The popover displays only the selected block as a full-width unified Patch: removed rows first,
  added rows second, with old/new line-number columns, diff prefixes, semantic colors, and one shared
  horizontal scrollbar.
- Previous Patch and Next Patch move between exact current Diff blocks, update the editor highlight,
  and keep the popover open. The unavailable boundary action is disabled.
- Rollback replaces only the selected current-buffer block with its HEAD baseline content.
- Rollback is an ordinary CodeMirror edit: it participates in Undo, marks the tab unsaved, and does
  not save, stage, refresh, or mutate another file automatically.
- The popover can be closed explicitly, with Escape, by clicking outside it, or by clicking its
  active gutter marker again. Every close path clears the Patch highlight in the same transaction.
- Opening a currently visible gutter block preserves the editor scroll position. Explicit
  Previous/Next navigation may scroll because its destination can be outside the viewport.
- Tooltip placement is bounded to the visible editor scroller rather than the whole application
  window. CodeMirror may flip it above/below the selected block or shrink its body; the header stays
  visible and the unified rows scroll internally when the block cannot fit at full height.

## Invariants

1. The HEAD baseline owned by `EditorChangeBaselineController` remains the only comparison source.
2. Patch identity is derived from the current CodeMirror `Chunk`; offsets are never reconstructed
   from rendered line text.
3. A document or baseline change invalidates the open popover before stale offsets can be used.
4. Rollback is unavailable while the editor is read-only.
5. Deleted blocks retain a current-document anchor so their gutter marker and popover remain
   reachable even though the current side has no changed lines.
6. No native Git mutation, staging action, confirmation bypass, automatic save, or automatic retry is
   introduced.
7. Popover text is created with DOM text nodes; repository content is never injected as HTML.

## Delivery plan

### Phase 1 — complete Patch projection

- Extend editor change blocks with exact baseline offsets and baseline line numbers.
- Add a pure Patch projection that returns before/after line rows for additions, deletions,
  replacements, empty lines, and end-of-file changes.
- Add a pure rollback projection matching CodeMirror MergeView's newline semantics.

### Phase 2 — gutter interaction and navigation

- Add a CodeMirror tooltip state owned by the existing change-indicator extension.
- Open or toggle the tooltip only from the colored change gutter.
- Implement previous/next navigation against the freshly derived block list.
- Keep the existing overview-ruler click behavior unchanged.

### Phase 3 — reversible rollback

- Apply the baseline slice to the exact current-buffer range with the `revert` user event.
- Close the stale tooltip as part of the same transaction.
- Let the existing text-editor update listener, dirty-tab state, serialization, save flow, and Undo
  history handle the edit normally.

### Phase 4 — presentation and regression proof

- Add compact, theme-token-based popover styling with bounded width and height.
- Add accessible labels, focus behavior, disabled boundary states, close control, and Escape handling.
- Cover pure projection, navigation state, rollback behavior, markup safety, source-size ownership,
  TypeScript, frontend regressions, and the production build.

## Acceptance matrix

| Case | Expected result |
| --- | --- |
| Click a modified marker | One popover stacks only that block's removed and added rows at full width |
| Click an added marker | Unified Patch contains only full-width added rows |
| Click a deleted marker | Unified Patch contains only full-width removed rows |
| Previous/next at a middle block | Popover, selection, scroll target, and highlight move together |
| Previous at first / next at last | Corresponding action is disabled |
| Rollback one of several blocks | Only that block is restored; remaining blocks stay marked |
| Undo after rollback | The reverted block returns through normal editor Undo |
| File or baseline changes externally | Open popover closes rather than acting on stale offsets |
| Editor becomes read-only | Rollback is disabled |
| Source includes HTML-like text | Text is displayed literally and cannot create markup |

## Planned commit sequence

1. `feat: add editor Patch popover projection and interaction`
2. `test: cover editor Patch navigation and rollback`
3. `docs: record editor Patch popover acceptance evidence`
