# R2c Changes and Commit controller evidence — 2026-09-12

## Scope

This independently revertible R2 slice preserves the Changes tree, direct-selection commit model,
working-tree Diff, revert, and commit behavior while moving their mutable state and asynchronous
ownership out of `AsterlynApp`. It is interim refactoring evidence rather than the R2 exit report;
Files/Editor, Settings/Shell, feature CSS, lazy capability loading, and bounded large-list mounting
remain.

## Ownership result

`ChangesCommitController` now owns the selected change, commit inclusion set, tree/flat
presentation and disclosure state, commit message, working Diff and image-Diff request lifecycle,
revert and commit mutation identity, stale-result rejection, and disposal. `AsterlynApp` installs
repository snapshots and reacts to typed feature changes instead of coordinating these values with
independent fields and request counters.

Repository replacement invalidates pending Diff and mutation work. Selection changes invalidate an
older Diff before a newer request begins, and only the current repository, file, generation, and
request sequence can publish a completion. Inclusion is reconciled by stable path identity across a
same-repository refresh, while a repository replacement clears repository-scoped state.

Fourteen Changes/Commit fields and the working-Diff request counter left `AppState` and
`AsterlynApp`. The application file declined from 8,713 to 8,597 lines, a reduction of 116 lines or
1.33% in this slice and 1,014 lines or 10.55% from the original 9,611-line audit baseline. The new
controller is 427 lines, below the 800-line decomposition gate.

## Validation and interpretation

Five controller tests cover snapshot reconciliation, latest-selection Diff ownership, image-Diff
routing, included-file commit scope, and repository replacement during a revert. All 201 frontend
script tests, TypeScript checking, and the production frontend build pass.

The main JavaScript chunk is 749.15 kB raw and 211.60 kB gzip, compared with 743.72 kB raw and
210.51 kB gzip in R2b. The increases are 5.43 kB raw (0.73%) and 1.09 kB gzip (0.52%), both **no
material change** under the one-percent threshold. R2 still fails the below-500-kB architecture
budget; capability-level lazy loading remains required before closure.

No installed-app interaction, native resource series, Rust rerun, or package build is claimed by
this interim slice. Changes/Commit state ownership and stale-result safety are **improved**;
artifact size shows **no material change**; end-user performance remains **inconclusive** until the
phase-closing acceptance run.

## Next action

Extract project-tree loading and Editor document I/O coordination behind feature controllers.
Preserve tab identity, dirty-buffer safety, incremental project-tree reconciliation, image/Markdown
surfaces, and current targeted rendering while removing their request generations and caches from
the application composition root.
