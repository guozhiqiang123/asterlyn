# R2d Files and Editor controllers evidence — 2026-09-12

## Scope

This independently revertible R2 slice preserves project-tree navigation, incremental disclosure
and selection retention, text-tab editing and saving, Markdown modes, image preview, search-result
navigation, and dirty-buffer protection while assigning their data and request lifecycles to Files
and Editor controllers. It is interim evidence; Settings/Shell extraction, feature CSS, bounded
large-list mounting, lazy capability loading, and the phase-closing installed-app run remain.

## Ownership result

`ProjectFilesController` now owns the workspace catalog, ignored-entry catalog, tree cache, Git
status projection, selected node, expanded directories, refresh sequence, stale-result rejection,
and disposal. A refresh updates the catalog atomically and reconciles stable path identities instead
of letting `AsterlynApp` replace independent arrays and sets.

`EditorSessionController` now owns the editor session, workspace generation, text load/reload/save
requests, tab activation and closure, content and Markdown-mode transitions, dirty-buffer revision
semantics, project-image request sequencing, stale-result rejection, and disposal. The existing pure
editor-session reducer remains the tested state machine; the new controller is its asynchronous
boundary. Project-image loads and text operations can no longer publish after a workspace switch.

Ten project-tree fields, two request counters, the tree cache, and the editor session left
`AppState` and `AsterlynApp`. The application file declined from 8,597 to 8,381 lines, a reduction of
216 lines or 2.51% in this slice and 1,230 lines or 12.80% from the original 9,611-line audit
baseline. The Editor controller is 453 lines and the Files controller is 286 lines, each below the
800-line decomposition gate.

## Validation and interpretation

Nine new controller tests cover latest-workspace catalog ownership, same-workspace disclosure and
selection reconciliation, status-only tree rebuilding, reveal behavior, obsolete text loads,
loaded-tab reuse, edits during save, save conflicts, and stale image completion. All 210 frontend
script tests, TypeScript checking, and the production frontend build pass.

The main JavaScript chunk is 757.36 kB raw and 213.08 kB gzip, compared with 749.15 kB raw and
211.60 kB gzip in R2c. The raw increase is 8.21 kB (1.10%), a small **regression**; gzip increases
1.48 kB (0.70%), which is **no material change** under the one-percent threshold. This interim
extraction adds explicit controller boundaries before the planned lazy capability split. R2 still
fails the below-500-kB architecture budget and cannot close until that split is measured.

No installed-app interaction, native resource series, Rust rerun, or package build is claimed by
this interim slice. State and asynchronous ownership are **improved**, artifact size is **mixed**,
and end-user performance remains **inconclusive** until phase-closing acceptance.

## Next action

Extract Settings and Shell state, then split feature presentation and CSS ownership. Introduce
bounded projections for long History and tree surfaces and lazy-load editor/Diff capability code so
the R2 structure and bundle budgets are both enforced rather than documented as exceptions.
