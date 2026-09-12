# R2j Git History view ownership

## Scope

This R2 checkpoint moves branch navigation, Git History filters and list hosting, history selection
dialogs, commit changed-file presentation, commit metadata, and branch inspection out of
`AsterlynApp`. The application now supplies typed view models and routes interactions while the
Git History capability owns its markup and presentation helpers.

## Evidence

- Source concentration: `src/app.ts` decreased from 7,508 lines at R2i to 6,860 lines. The four new
  Git History view files are 244 lines or smaller; the existing virtualized history-list view
  remains 385 lines.
- Focused behavior: six deterministic feature-view tests pass, including branch hierarchy and
  selection, date-filter popover rendering, branch-selection dialogs, and commit changed-file
  details.
- Type safety: `npm run check` passes.
- Production build: the main startup chunk is 408.01 kB uncompressed and 100.71 kB gzip, below the
  500 kB architecture gate.
- Browser acceptance: the demo preserves Local/Remote/Tags grouping, the complete History filter
  strip, graph rows, selected commit identity, virtualized list boundary, and the changed-file
  details region without console errors.

## Interpretation

The result is **improved**. Git History presentation can now be characterized independently of the
application shell, feature markup no longer competes with orchestration in `app.ts`, and startup
size remains stable. The application composition root is still above the source decomposition
trigger, so R2 is not accepted at this checkpoint.

## Limitations and next action

Native Git reads and writes are not exercised by browser-demo acceptance. Continue with editor and
workspace-search presentation ownership, then close R2 with full script, Rust, native-build, and
package validation.
