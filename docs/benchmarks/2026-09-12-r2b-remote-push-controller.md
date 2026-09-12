# R2b Remote and Push controller evidence — 2026-09-12

## Scope

This independently revertible R2 slice preserves the existing Remote toolbar, Update confirmation,
Push review, and pushed-file Diff behavior while moving their mutable state and asynchronous request
ownership out of `AsterlynApp`. It is interim refactoring evidence rather than the R2 exit report;
Changes/Commit, Files/Editor, Settings/Shell, feature CSS, lazy capability loading, and bounded tree
mounting remain.

## Ownership result

`RemotePushController` now owns selected-remote reconciliation, dialog lifecycle, preview and paging
requests, tag and force-with-lease review options, selected outgoing commit and bounded detail cache,
pushed-file selection and Diff requests, remote-operation identity, cancellation state, stale-result
rejection, and disposal. `remote-push-state.ts` keeps the public feature state contract separate from
the controller implementation. `AsterlynApp` receives typed changes and limits updates to the
Remote toolbar, dialog, pushed-file selection, or pushed-file Diff host.

The controller rejects completions after a remote, selection, repository, dialog, or operation
identity changes. Tag-scope refresh preserves the mounted review while disabling activation, then
replaces the review atomically. This retains the anti-flicker behavior without letting presentation
code own request generations.

Twenty Remote/Push fields, four request counters, and the Push detail cache left `AppState` and
`AsterlynApp`. The application file declined from 9,128 to 8,713 lines, a reduction of 415 lines or
4.55% in this slice and 898 lines or 9.34% from the original 9,611-line audit baseline. The
controller is 765 lines and its state contract is 77 lines, each below the 800-line decomposition
gate.

## Validation and interpretation

Five controller tests cover latest-remote preview ownership, atomic tag refresh, immutable commit
detail caching, stale pushed-file Diff rejection, and repository-scoped operation invalidation. All
196 frontend script tests, TypeScript checking, and the production frontend build pass.

The main JavaScript chunk is 743.72 kB raw and 210.51 kB gzip, compared with 737.90 kB raw and
209.18 kB gzip in R2a. The increases are 5.82 kB raw (0.79%) and 1.33 kB gzip (0.64%), both **no
material change** under the one-percent threshold. R2 still fails the below-500-kB architecture
budget; capability-level lazy loading remains required before closure.

No installed-app interaction, native resource series, Rust rerun, or package build is claimed by
this interim slice. Correct state ownership, cancellation visibility, and stale-result safety are
**improved**; artifact size shows **no material change**; end-user performance remains
**inconclusive** until the phase-closing acceptance run.

## Next action

Extract Changes selection, inclusion, tree disclosure, commit message, working Diff request state,
revert, and commit orchestration behind one feature controller. Preserve the current direct-commit
selection semantics and conflict safety while replacing broad workspace rerenders with targeted
feature changes.
