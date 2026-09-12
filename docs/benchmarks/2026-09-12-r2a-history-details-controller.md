# R2a Git History and Details controller evidence — 2026-09-12

## Scope

This is the first independently revertible R2 slice from
[`Architecture refactoring`](../engineering/architecture-refactoring.md). It preserves Git query
semantics and visual layout while moving the complete asynchronous History page window and commit
Details lifecycle out of `AsterlynApp`. It does not claim the R2 exit gate: toolbar/filter
presentation state, Remote/Push, Changes/Commit, Files/Editor coordination, Settings/Shell, CSS
ownership, and high-cardinality virtualization remain.

## Ownership and rendering result

`src/features/git-history/history-details-controller.ts` now owns the canonical frontend state for
loaded history, normalized active query, selected commit, paging availability and errors, top
refresh, commit details, selected changed file, and the bounded immutable-detail cache. The same
controller owns request generations and rejects late query, page, and details completions after a
new query, repository, selection, or disposal.

The controller publishes typed changes rather than touching DOM. `AsterlynApp` routes those changes
to the stable History list or Details host and clears only commit-Diff presentation when selection
identity changes. History filter dismissal and path-catalog completion now rerender only the
History pane instead of rebuilding Branches and Details. Paging rerenders retain the History host's
horizontal and vertical scroll offsets. The controller and list view both expose explicit disposal.

Twelve History/Details fields and four request/lifecycle counters left `AppState` and
`AsterlynApp`. The application file declined from 9,452 to 9,128 lines, a reduction of 324 lines or
3.43% in this slice and 483 lines or 5.03% from the original 9,611-line audit baseline. The new
controller is 687 lines, below the 800-line decomposition gate.

## Functional and interaction evidence

Five controller tests cover latest-query ownership, paging deduplication and selection retention,
top-window reconciliation, stale detail rejection, cache reuse without another native read,
scroll-triggered append and refresh, and disposal invalidation. Existing History query, graph,
collapse, list, and paging tests remain unchanged.

In the browser demo, three rapid commit selections ended with exactly one selected row; its subject,
Details heading, and two-file projection agreed. Selecting a branch showed branch details, and
clicking the already-selected commit correctly returned the third pane to commit details. Opening a
History filter retained the six-item Branches count, selected commit, and Details heading. No
browser warning or error was recorded. The seven-commit demo cannot validate a genuinely long
scroll window, so installed-app large-repository scrolling remains part of manual acceptance.

## Validation and resource interpretation

TypeScript checking, the production frontend build, all 191 frontend script tests, all Rust workspace
tests, the 6,000-millisecond native smoke interval, and Debian packaging pass. No delegated model or
reviewer was used.

The main JavaScript chunk is 737.90 kB raw and 209.18 kB gzip, compared with 735.43 kB raw and
208.34 kB gzip in R1. The increases are 2.47 kB raw (0.34%) and 0.84 kB gzip (0.40%), both **no
material change** under the one-percent threshold. The greater-than-500-kB warning remains and R2
must still introduce lazy capability boundaries.

The release executable is 19,578,560 bytes and the Debian package is 6,832,672 bytes. Compared with
R1, these increase by 3,504 bytes (0.018%) and 1,940 bytes (0.028%), both **no material change**. The
acceptance package is `target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb` with SHA-256
`02a1df9f51169d4b59c7ab813d4196178145b9e6667c103f59bb53069a09c2c6`.

No matched process-tree memory or steady-state CPU series was run, so resource impact is
**inconclusive**. Request ownership, stale-result safety, disposal, and render scope are
**improved**; frontend and native artifact sizes show **no material change**.

## Limitations and next action

The History toolbar and filter drafts still live in `AsterlynApp`, and the complete list remains
mounted up to the 3,000-row session ceiling. Commit-file tree presentation and commit-Diff loading
also remain composition-root responsibilities pending Files/Editor coordination extraction.

Manual acceptance should exercise a large repository by scrolling to append multiple pages,
returning to the top to refresh, rapidly selecting cached and uncached commits, switching between
branch and commit details, and confirming that Branches disclosure and scroll state remain stable.
The next R2 slice extracts Remote/Push state, dialogs, request generations, and review caching
behind one feature controller before Changes/Commit work begins.
