# R1 architecture-refactoring evidence — 2026-09-12

## Scope and decisions

R1 records the audited migration in
[`Architecture refactoring`](../engineering/architecture-refactoring.md), accepts
[`ADR-0007`](../architecture/decisions/0007-workbench-feature-ownership.md) for workbench ownership,
and accepts [`ADR-0008`](../architecture/decisions/0008-recoverable-git-operations.md) before merge,
rebase, cherry-pick, or squash implementation. The engineering gates now cover feature-owned state
and disposal, scoped rendering, delegated high-cardinality events, session authorization cost,
read-model invalidation, production source concentration, and frontend chunk size.

This is a behavior-preserving reference extraction rather than a visual redesign or framework
migration. Git command semantics, repository queries, editor ownership, persisted preferences, and
desktop protocol models do not change.

## Reference extraction

Git History row projection now belongs to
`src/features/git-history/history-list-view.ts`. The feature view owns list markup, topology-graph
SVG projection, root and ref badges, collapsed-linear rows, paging/error states, selected-row DOM
updates, keyboard movement, retry dispatch, scrolling dispatch, listener installation, and listener
disposal. Click and keyboard handling use one delegated list boundary rather than listeners attached
to every commit row after each page render.

`AsterlynApp` supplies one typed `HistoryListPresentation` and routes the resulting stable commit
identity to the existing detail-loading use case. Commit selection still updates row classes in
place and therefore cannot replace the history scroll host. Case/regex controls, filter popovers,
branch submenus, and linear-collapse controls now rerender only the Git History pane instead of the
complete bottom tool, so they no longer rebuild Branches or Git Details.

The application file declined from 9,611 to 9,452 lines, a reduction of 159 lines or 1.65%. The new
feature boundary is 284 lines and has three host-level listeners regardless of commit count. This
does not complete Git History ownership: toolbar/filter state, asynchronous paging, request
generations, and commit-detail loading still migrate in R2.

## Functional and browser evidence

Three new pure tests cover selected commit/graph/ref/root projection, paging and terminal status,
loading/backend-error/text-filter states, and HTML escaping. Existing graph, collapse, query, and
paging tests remain unchanged.

The production-like browser demo exposed seven graph rows. Clicking
`feat(workbench): add resizable Git panes` selected that exact row; `ArrowDown` selected
`feat(git): add tested repository core`, moved focus with the selection, and populated Git Details
with the same subject. Opening the Branch filter retained the selected details subject and the
six-item branch projection while showing the filter popover. No browser warning or error was
recorded. The small seven-row fixture did not create a meaningful long-history scroll range, so
installed-app large-history scroll identity remains part of manual acceptance; source inspection
and the preceding Git-interaction evidence continue to establish that selection does not replace
the list host.

## Validation and resource interpretation

All 186 frontend script tests pass. TypeScript checking and the production frontend build pass.
The Rust workspace passes 17 Tauri library tests, one Tauri binary test, 48 `asterlyn-git` tests, 25
`asterlyn-workspace` tests, and all documentation tests through the documented Linux environment
wrapper. The release executable remained alive for the complete 6,000-millisecond isolated native
smoke interval. Whitespace checks and Debian packaging also pass. No delegated model or reviewer
was used.

CSS remains 101.12 kB raw and 23.11 kB gzip. The main JavaScript chunk is 735.43 kB raw and 208.34
kB gzip, compared with 733.90 kB raw and 207.43 kB gzip in the preceding accepted package. The
increases are 1.53 kB raw (0.21%) and 0.91 kB gzip (0.44%), both **no material change** under the
one-percent threshold. The expected greater-than-500-kB warning remains; lazy capability loading is
an R2 responsibility rather than a claim of this ownership extraction.

The release binary is 19,575,056 bytes and the Debian package is 6,830,732 bytes. Compared with the
preceding accepted package, these increase by 1,936 bytes (0.010%) and 1,622 bytes (0.024%), both
**no material change**. The acceptance package is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb` with SHA-256
`efec940171a6923c02ca853cbc64fd90182a0d8dde225843af43baf08af46fc5`.

No matched process-tree series was run, so memory and steady-state CPU impact are **inconclusive**.
Architecture ownership and event scaling are **improved**; frontend and native artifact sizes show
**no material change**.

## Limitations and next action

R1 deliberately leaves the history toolbar, query transitions, paging requests, and detail request
controller in `AsterlynApp`. History rows are not yet virtualized, so a fully loaded 3,000-commit
session still mounts its complete row projection. Global CSS, Tauri application services, session
authorization, protocol generation, and Git operation state remain unchanged.

Manual acceptance should exercise long-history scrolling, rapid mouse and keyboard commit
selection, filter popovers, linear collapse/expand, top refresh, bottom pagination, and repeated
cached details. R2 should next move the complete History query/paging controller and Git Details
state behind feature-owned actions before starting Remote/Push extraction.
