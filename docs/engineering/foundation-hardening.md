# Foundation hardening plan

- **Status:** Active; capability expansion is paused until the frontend foundation exit gate passes.
- **Baseline:** 2026-09-19, after context-action CM4 acceptance.
- **Scope:** Frontend ownership and startup boundaries first, followed by desktop application services
  and the Git process boundary. This is an incremental migration, not a rewrite.

## Why this work precedes more features

The context-action sequence proved the shared presentation-host design and the reviewed mutation
boundaries, but it also made the remaining concentration points more expensive:

- at the recorded baseline, `src/app.ts` was 9,242 lines and its constructor spanned 1,088 lines;
- at the recorded baseline, `AppState` still owned Search, Replacement, and History-filter state
  that ADR-0007 assigns to features;
- three `src/application` modules import concrete feature controllers or feature state;
- the native production startup graph still contains the deterministic browser demo;
- the production startup JavaScript is 685,945 bytes, above the 500 kB target;
- source-size and stylesheet ownership checks cover curated lists rather than the complete source;
- `crates/asterlyn-git/src/repository.rs` and `src-tauri/src/lib.rs` still combine several ownership
  boundaries.

Adding more menus or use cases before these seams are enforced would make `AsterlynApp`, the demo
bridge, and the native/Git entry files the default home for new behavior. This plan therefore
blocks unrelated capability expansion until the frontend foundation gate below is green. Defect
corrections remain allowed when they do not add state owners, broad rendering, or new command paths.

## Non-negotiable migration rules

1. Preserve behavior through characterization tests before moving ownership.
2. Add an executable boundary before relying on it; temporary debt is explicit, measured, and may
   only shrink.
3. Move one state owner or process policy at a time. Do not create synchronized old/new stores.
4. Keep `AsterlynApp` as the only composition root, but do not let it implement feature policy,
   retain feature state, or switch on context-action IDs.
5. Keep Git and the authorized workspace as sources of truth. Refactoring cannot introduce a
   repository-state database or speculative projection writes.
6. Do not split files mechanically. Every extraction must name its owner, dependency direction,
   lifecycle, error policy, and focused tests.
7. Every step is an independently revertible commit and passes its focused checks before the next
   step begins.

## Target boundaries

### Frontend dependency direction

```text
main/bootstrap
    -> app composition root
       -> shell presentation
       -> feature controllers, bindings, views
       -> application sessions, coordinators, and typed ports
          -> protocol and product-neutral models
             -> adapters at the composed edge
```

- `src/application` may depend on product-neutral models, protocol contracts, and application-owned
  ports. It must not import `src/features`, `src/shell`, concrete adapters, or DOM types.
- A feature may depend on application ports and shared/product-neutral helpers, but one feature may
  not import another feature. Cross-feature behavior uses a typed port wired in `app.ts`.
- `src/protocol` and product-neutral models know neither features nor presentation.
- `src/adapters` implement ports and protocol transport; they do not own feature state.
- `src/shared` contains business-neutral presentation utilities only.
- `src/workbench` is transitional, not a permanent catch-all. Pure application state moves to its
  owner; DOM/runtime helpers move beside the owning feature or into business-neutral presentation.

### Runtime entry boundaries

```text
native production entry -> Tauri DesktopBridge only
browser demo entry       -> deterministic Demo DesktopBridge, loaded on demand
```

The native startup graph must not contain demo fixtures or demo mutation implementations. The demo
continues to implement the same `DesktopBridge` contract and remains available for deterministic
browser acceptance.

### Native and Git boundaries

```text
Tauri command -> application service -> Git/workspace capability -> process/platform adapter
```

- Tauri commands validate transport identity and dispatch; search/replacement authorization,
  mutation coordination, and result mapping live in application modules.
- `asterlyn-git` owns Git semantics. A dedicated process boundary owns command construction,
  environment sanitization, cancellation, output limits, process-tree termination, and error
  conversion.
- Read and mutation modules request process execution through that boundary; they do not each
  invent subprocess policy.

## Delivery sequence

### FH0 — Record the baseline and freeze

Land this plan, link it from the documentation map and the existing architecture/context-action
plans, and record the current clean build and test baseline.

Exit gate: the feature freeze, ownership target, stages, rollback unit, and final acceptance matrix
are part of the repository source of truth.

### FH1 — Make architectural drift executable

Progress: complete TypeScript/style discovery, non-growing oversized-source ownership, dependency
direction debt, cross-feature isolation, and application DOM debt are enforced. The startup graph
and generated bundle hard gate land with FH2 so the accepted limit is green when introduced.

1. Replace curated stylesheet checks with complete `src/**/*.css` discovery and exactly-one-entry
   ownership validation.
2. Inventory every production TypeScript file above the review thresholds. Known oversized files
   receive a named owner and a non-increasing baseline; unreviewed new violations fail.
3. Parse frontend imports and enforce zero cross-feature imports plus the target layer direction.
   Current reverse edges are temporary named debt and no new edge may be added.
4. Add deterministic tests for the native/demo startup boundary and bundle artifact budget.

Exit gate: every production TypeScript and CSS file is visible to a guard, all exceptions are
explicit, and an exception cannot grow silently.

### FH2 — Separate native production from the browser demo

Status: **locally accepted on 2026-09-19.** The native bridge remains static, the deterministic
browser bridge is a conditional dynamic module, and the build fails when the application chunk is
over 500,000 bytes or contains demo modules. Capability-owned feature chunks bring the application
chunk below the limit; they are still static startup dependencies, so aggregate startup transfer
remains an FH4 optimization measure rather than being misreported as eliminated. Evidence:
[`FH2 startup-boundary acceptance`](../benchmarks/2026-09-19-foundation-hardening-fh2.md).

Move the deterministic demo bridge behind a browser-only dynamic boundary. Keep the Tauri bridge
static for native startup, preserve the `DesktopBridge` contract, and keep demo behavior covered by
the existing script/browser tests. Set the generated main-chunk hard limit to 500,000 bytes after
the split rather than accepting Vite's warning.

Exit gate: `npm run build` passes the hard budget; the main source map contains no demo source; both
native and demo bridge contract tests pass; no product behavior or protocol command changes.

### FH3 — Close frontend dependency inversions

Progress: workspace watch and mutation coordinators now depend on application-owned Files/Editor
ports and path-migration contracts rather than concrete feature controllers. The mixed `AppState`
was moved out of the application-service directory and is explicitly a temporary composition-root
state until FH4 removes feature-owned fields. The window-chrome transport type and parser now live
in `src/protocol`; presentation helpers consume that contract without making protocol depend on
`workbench`. The shared Trash application workflow now has a named `workspace-trash` feature for
its dialog view/binding instead of placing business presentation in `src/shared`. Application
timers and window focus are now explicit `RuntimeScheduler` and `WorkspaceFocusPort` dependencies,
implemented at the browser adapter edge; application services no longer import DOM runtimes. The
dependency and application-DOM debt lists are empty. Application services no longer import the
transitional `workbench` layer: editor path-mutation contracts are product-neutral, while tracked
change merge policy is application-owned. All remaining `workbench` modules have an executable,
exact owner/destination inventory; new unclassified modules fail the architecture gate. Their
owner-by-owner moves are part of the FH4 feature extraction rather than mechanical FH3 churn.

1. Move History filter state contracts out of feature presentation modules into a feature-owned
   controller/facade exposed through an application port.
2. Replace `WorkspaceWatchCoordinator` and `WorkspaceMutationCoordinator` imports of concrete Files
   and Editor controllers with application-owned ports.
3. Remove all temporary `application -> features` exceptions and make the dependency gate absolute.
4. Classify each `src/workbench` module as application state, feature runtime, or shared
   presentation; move modules only when ownership and tests are clear.

Exit gate: `src/application` has zero feature, shell, adapter, or DOM imports; features remain
cross-import free; all cross-feature calls pass through typed ports.

### FH4 — Complete feature-owned state and shrink the composition root

Progress: Files Search controls, request identity, result/error state, cancellation, and stale
completion acceptance now have one `WorkspaceSearchController` owner in `files-editor`. Replacement
text, preview/apply state, file selection, recovery inventory/dialog state, and operation busy
identity likewise have one `WorkspaceReplacementController` owner. The mixed `AppState` no longer
stores Search or Replacement state. History text matching, query filters, menus, dialog drafts,
path validation, preference state, and normalized query routing now have one private
`HistoryFilterController` state owner. `AppState` stores none of those three feature slices;
architecture tests prevent their ownership from returning to the composition root. After the
History slice, `src/app.ts` is 9,033 lines and its non-growing ownership ceiling has been lowered to
match. Commit-detail mode, file-tree disclosure, persisted file view, and commit/comparison Diff
request generations and results now have one `HistoryDetailPresentationController` owner. The
controller rejects stale Diff completions and `AppState` no longer contains Git History detail
presentation state. After this slice, `src/app.ts` is 8,980 lines and its ceiling has again been
lowered to match. Quick-open mode, query, and selection now have one
`CommandSurfaceController` owner in `files-editor`; the remaining `AppState` contains only the
window-wide loading and error status. After that slice, `src/app.ts` is 8,961 lines with a matching
non-growing ceiling. Git History's details, comparison, historical-file, and historical-file
comparison controllers now share one feature-owned read runtime. That runtime owns their
subscriptions and disposal behind explicit gateway and notification ports; `AsterlynApp` no longer
manages four parallel lifecycles. After this first composition slice, `src/app.ts` is 8,945 lines
with a matching ceiling. Git History's branch, commit, range, commit-file, and commit-folder context
menus now share one feature-owned DOM runtime as well. It owns the three delegated binding pairs,
routes single and range commit targets, shares the clipboard port, and disposes as one unit while
the composition root supplies only explicit state and action ports. After this slice, `src/app.ts`
is 8,879 lines with a matching ceiling. Files and Changes now use the same feature-owned context
surface pattern: each runtime owns its action provider and delegated DOM binding, while workspace
identity, policy inputs, and cross-feature actions remain explicit injected ports. This leaves
`src/app.ts` at 8,871 lines with a matching ceiling and establishes one lifecycle model across the
three context-menu feature areas.

Remote Push and authentication now share a `RemoteRuntime` that owns both controllers, their
subscriptions, and their coordinated disposal behind separate typed gateways. The composition root
no longer retains release handles for either controller; `src/app.ts` is 8,863 lines with a
matching ceiling.

The Changes controller now has the same feature runtime lifecycle, including exclusive ownership
of its subscription and disposal. `src/app.ts` is 8,859 lines with a matching ceiling.

Files and Editor core controllers now share a `FilesEditorRuntime`; the feature owns both gateway
controllers, their subscriptions, and their disposal while publishing typed change notifications
to window composition. `src/app.ts` is 8,855 lines with a matching ceiling.

The shared workspace Trash workflow now has a feature runtime that owns its controller, dialog
binding, subscription, and disposal. Files and Changes still provide explicit target validation and
completion ports, but the composition root no longer sequences the workflow's internal lifecycle.
`src/app.ts` is 8,844 lines with a matching ceiling.

Files mutations now have a dedicated operation runtime as well. It owns the mutation controller,
window-local file clipboard subscriptions, inline/dialog binding, and disposal; the composition
root supplies only the workspace, Trash, reconciliation, feedback, and rendering ports.
`src/app.ts` is 8,834 lines with a matching ceiling.

Reviewed Git operations now use the same lifecycle boundary. `GitOperationRuntime` owns the
controller, lazy dialog binding, subscription, focus-aware open/close surface, localization update,
and disposal. Mutation orchestration remains an explicit composition callback rather than moving
application coordination into presentation code. `src/app.ts` is 8,826 lines with a matching
ceiling.

Settings persistence and the effective presentation environment now meet in a small composition
runtime. It owns both subscriptions and their disposal while keeping browser preference sync,
system appearance, native appearance, and UI reactions as explicit injected ports. This removes
the last manually retained release handles from `AsterlynApp`; `src/app.ts` is 8,812 lines with a
matching ceiling.

Git History's two reviewed write workflows now share a feature mutation runtime. It owns branch
mutation and historical-file restore controllers together with both dialog bindings, rendering,
localization refresh, and disposal. `AsterlynApp` retains only the gateways and cross-feature
reconciliation callbacks; `src/app.ts` is 8,808 lines with a matching ceiling.

The lazily loaded Git worktree-recovery review is now owned by `GitOperationRuntime` as well. Its
late-import guard, localization refresh, and disposal share the feature lifecycle, while the
workspace/editor reconciliation required by Undo remains an injected composition callback. The
`src/app.ts` ceiling remains 8,808 lines.

The Files/Editor runtime now also owns the Search and Replacement controllers and their cancellation
lifecycle. All four Files/Editor state owners share the same workspace-operation port, and the
composition root no longer disposes feature controllers individually. `src/app.ts` is 8,799 lines
with a matching ceiling.

The command surface state now belongs to the same Files/Editor runtime. Composition reads the
controller's current state instead of retaining the initial state object, which prevents command
mode, query, and selection from becoming stale after immutable state transitions. `src/app.ts` is
8,796 lines with a matching ceiling.

Git History's synchronous presentation state now has one feature runtime as well. Filters, detail
presentation, logical range selection, bounded folder Diff state, and the branch panel are
constructed and reset together; the composition root no longer instantiates those controllers or
retains aliases to their state objects. `src/app.ts` is 8,781 lines with a matching ceiling.

The first transitional `workbench` ownership batch is complete: activity ordering, layout state,
and window-chrome presentation now live under `src/shell`, with callers and focused tests importing
their final owner directly. The ownership baseline removes each module as soon as it reaches its
recorded destination.

Editor-document, History-query, and preference contracts now live at the product root, while the
font loader/catalog lives under Settings. Font identities and History query selection keys were
lifted into the inward contracts before the move, so the root contracts do not depend back on a
feature merely to validate persisted data or normalize a query.

Settings now owns its preference store and browser synchronization port next to the controller that
consumes them. Composition depends on that explicit Settings port rather than a generic transitional
`workbench` location.

Startup repository restoration now belongs to Application, and the bounded recent-value cache now
belongs to Shared. Both are dependency-free utilities at their final inward layer, so feature
controllers consume them without passing through the transitional namespace.

The shared presentation batch now lives under `src/presentation`: Git projections, image-preview
identity, linked scrolling, project-tree projection, splitters, and tab-strip behavior. Commit keys
used by the Git projection were first lifted into the root History contract, preventing shared
presentation from depending on the Git History feature.

Changes/Commit now owns its change grouping, effective-status, inclusion, and tree-projection model
next to the controller and view that consume it.

Remote Push now owns its review file projection, commit-selection transition, and confirmation
availability rules next to the remote controller and view.

Git History now owns all seven of its remaining transitional models: collapse projection, feature
identity facade, paging, path selection, persisted ref preferences, repository-root selection, and
ref-history request state. Their internal imports are feature-local and their product contracts
still point inward to `models.ts` and `history-query.ts`.

Files/Editor now owns the final twelve transitional modules: Diff navigation, cache remapping,
editor gutters and session state, Markdown formatting/mode/preview, navigation and search routing,
text-content limits, and workspace search/replacement state. `src/workbench` is empty, its ownership
debt baseline is empty, and the architecture test also handles the directory being absent in a clean
checkout.

Extract vertical slices in this order:

1. Search request/control/result state and scoped rendering;
2. Replacement review/recovery state and lifecycle;
3. History filters, dialogs, drafts, and query routing;
4. historical document/comparison and commit-detail presentation coordination;
5. remaining constructor wiring into small composition factories without introducing a service
   locator or global dispatcher.

Each slice first gains characterization tests, then becomes the single owner, then removes the old
`AppState` fields and `AsterlynApp` branches in the same commit. Line reduction is recorded but is
not the exit condition.

Exit gate: `AppState` contains only genuine window-composition state; `AsterlynApp` wires ports and
routes window-level events without feature state, feature markup, or business-action switches; each
feature owns disposal and a stable DOM boundary.

### FH5 — Extract desktop application services

Move authorized catalog/search/replacement preparation, result mapping, and relevant registries out
of `src-tauri/src/lib.rs` into capability-oriented `src-tauri/src/application` modules. Keep command
functions thin and keep `run()` responsible for Tauri setup, managed state, lifecycle hooks, and
handler registration.

Progress: the first desktop slice now lives in `application/workspace_catalog.rs`. Exact Git-root
detection, ordinary/Git catalog construction, and read/write reauthorization share one
Tauri-independent application boundary; existing command and session callers retain the same
authorization behavior. The desktop library suite passes with 52 tests and the two real watcher
backend tests explicitly ignored by their existing native-acceptance contract.

Workspace Search preparation and response mapping now live in `application/workspace_search.rs`
with the bounded search policy and transport-neutral response types. The command retains only
active-workspace resolution, cancellation registration, blocking dispatch, and exact completion;
the existing fresh-authorization and query-mapping characterization tests remain green.

Workspace Replacement planning now lives in `application/workspace_replacement.rs`. It owns the
bounded replacement policy, preview mapping, reviewed file identities, and the fresh-catalog check
performed immediately before application. Tauri-specific recovery-path lookup and background
dispatch remain at the composed desktop edge.

The replacement slice now also owns its stored-plan representation, serialized apply boundary,
and list/rollback/finalize recovery operations. Commands pass the platform-selected recovery root
and dispatch the blocking work; fresh authorization and the shared workspace write lock remain
inside the application service. The replacement characterization test now exercises this complete
service rather than reaching through to the workspace crate.

Authorized text reads and optimistic saves now live in `application/workspace_document.rs`.
Read-only rejection, fresh identity authorization, and workspace I/O form one application service;
commands supply the active-session identity and retain only transport scheduling.

Text-save serialization now also belongs to that document service. Workspace-entry reveal resolves
and validates the target through the catalog service before invoking the platform adapter, and
mutation-recovery enumeration dispatches through the mutation service. The workspace command
module no longer calls the concrete `Workspace` implementation directly.

Workspace entry inspection plus create/copy/move/trash planning and execution now belong to the
existing `application/workspace_mutation.rs` coordinator boundary. Mutation limits, preview DTOs,
write serialization, cancellation, and operation dispatch are Tauri-independent; the desktop edge
injects only its system-trash adapter and recovery location. A new application-level test executes
the full create plan without constructing Tauri, bringing the desktop suite to 53 passing tests
with the same two watcher tests reserved for native acceptance.

Exit gate: application behavior is testable without constructing Tauri; command modules perform
transport validation and dispatch only; protocol generation and all native tests pass.

### FH6 — Establish one Git process policy

Characterize read, mutation, remote, cancellation, overflow, Windows process-tree, and uncertain
outcome behavior. Introduce a product-neutral runner inside `asterlyn-git`, migrate callers by
behavioral group, and only then split repository reads/operations where cohesion improves.

Exit gate: production Git subprocess creation is confined to the process boundary; tests retain
the existing security, bounded-output, cancellation, and exact-lease semantics; Git remains the
source of truth.

### FH7 — Close and resume capability work

Run the complete validation matrix, record bundle/source movement and resource evidence, update the
architecture documents, and remove resolved debt baselines. Context-action or other capability work
may resume only after the frontend foundation gates FH1 through FH4 are green. FH5/FH6 may continue
as isolated backend hardening only when new frontend work does not expand those debt areas.

## Commit and rollback contract

Expected commit units are:

1. documentation baseline;
2. complete ownership/dependency inventories;
3. demo/native entry separation and bundle gate;
4. application port extraction;
5. one feature-state owner per commit;
6. one Tauri application-service family per commit;
7. Git process boundary, followed by one caller family per commit;
8. final evidence and debt removal.

No commit combines a behavior change with an unrelated move. Generated protocol changes, if any,
land with the schema and boundary tests that require them. A failed stage rolls back as a complete
commit; it does not leave dual owners or a disabled guard behind.

## Acceptance matrix

Every stage runs focused tests first. Before FH7 closes, the following must pass:

- `npm run check`, all frontend script tests, and `npm run build` with a main chunk at or below
  500,000 bytes;
- dependency, full-source ownership, full-style ownership, lazy-runtime, protocol, and context-menu
  lifecycle gates;
- `cargo test -p asterlyn-git`, workspace/Tauri tests, formatting, and strict Clippy;
- deterministic browser flows for Search, Replacement, History, Files/Editor, every context-menu
  surface, Git Blame, and recovery dialogs;
- native smoke and package checks on the supported host, with Windows/macOS-specific behavior left
  explicitly pending when it cannot be exercised locally;
- recorded functionality, startup size, latency, memory, accessibility, artifact movement, and
  known limitations.
