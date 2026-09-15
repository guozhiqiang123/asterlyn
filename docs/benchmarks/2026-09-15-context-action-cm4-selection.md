# CM4 History range-selection acceptance — 2026-09-15

## Outcome

History range selection is now a feature-owned logical state rather than a collection of selected
DOM rows. It records one query/display scope, an anchor, an active endpoint, and immutable commit
identities in current visible order. The list projects that state into at most 200 mounted rows,
while the commit details continue to follow only the active endpoint.

- ordinary click creates a single anchor;
- Shift-click and Shift+navigation extend a continuous range;
- ranges stop at collapsed-history barriers and at 100 commits with localized feedback;
- pagination can retain an exact range when every identity and interval is unchanged;
- backend query generation, local text-filter settings, or collapse-mode changes clear the range;
- every selected row exposes listbox multi-selection semantics, with one visually distinct active
  endpoint;
- selected identities are passed back through the History feature and never reconstructed from the
  currently mounted virtual DOM.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Focused controller, collapse, list, and context-target tests | 15 passed |
| Full frontend/delivery suite | 428 passed |
| TypeScript check | passed |
| Production build | passed; startup JavaScript 607,050 B raw / 142,150 B gzip |
| Pointer interaction | Shift-click selected three exact rows from the initial anchor |
| Detail ownership | the right-side commit details followed the active range endpoint |
| Accessibility projection | the list exposes multi-select semantics and every logical range row reports selected |
| Regression rerun | the unrelated timing-sensitive XML fold test passed in isolation and in the final full suite after one transient failure |

The startup increase over the CM3 checkpoint is 3,600 B raw / 960 B gzip. It contains the range
controller and list projection; it adds no row-scoped persistent listeners.

## Known limits

- This checkpoint establishes selection only. H2 context-menu actions, exact topology analysis,
  multi-Revert, Squash-range verification, and two-commit Diff land in later CM4 checkpoints.
- A collapsed projection is a deliberate selection barrier; users must expand it before including
  hidden commits.
- The startup bundle remains above the 500 kB architecture target for the broader Git workbench.
