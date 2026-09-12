# Architecture refactoring plan

## Purpose

Asterlyn pauses high-blast-radius feature expansion long enough to turn its proven first vertical
slices into durable capability boundaries. This is an incremental refactoring program, not a
rewrite, framework migration, or visual redesign. Tauri 2, TypeScript, CodeMirror 6,
`asterlyn-git`, and `asterlyn-workspace` remain the baseline.

Merge, rebase, cherry-pick, squash, and multi-file mutation do not enter implementation until their
owning boundaries below exist. Small defect corrections may continue when they do not add another
state owner or broad rendering path.

## Audit baseline

The 2026-09-12 clean baseline passes TypeScript checking, all 183 frontend script tests, all 48
`asterlyn-git` tests, all 25 `asterlyn-workspace` tests, the Tauri workspace tests through the
project Linux environment wrapper, and a production frontend build. The build reports a 733.90 kB
uncompressed main JavaScript chunk, above the 500 kB architectural target.

Current concentration points are:

| Area | File | Lines | Coupled responsibilities |
| --- | --- | ---: | --- |
| Frontend application | `src/app.ts` | 9,611 | shell, feature state, rendering, events, async orchestration |
| Global presentation | `src/styles.css` | 6,282 | tokens, shell, controls, and every feature |
| Git capability | `crates/asterlyn-git/src/repository.rs` | 5,968 | repository discovery, reads, writes, process policy, parsing, tests |
| Desktop boundary | `src-tauri/src/lib.rs` | 3,073 | commands, sessions, task registries, mutation locks, preview adapters |
| Frontend bridge | `src/bridge.ts` | 1,476 | native protocol and browser-demo implementation |

Approximately 2,100 lines of `repository.rs` are inline tests, so line count alone is not the Git
core diagnosis. Its production section still owns too many capabilities, while `app.ts` remains the
highest immediate correctness and performance risk.

## Target boundaries

```text
src/shell                         window composition and cross-feature routing
src/features/<capability>         state, actions, controller, stable view, disposal
src/adapters/{tauri,demo}         protocol implementations
src/protocol                      generated versioned transport models

src-tauri/commands                thin DTO validation and dispatch
src-tauri/application             workspace/repository sessions and coordinators
src-tauri/adapters                Tauri window, dialog, preview, and task adapters

crates/asterlyn-git/repository    identity and root catalog
crates/asterlyn-git/reads         status, refs, history, and diff
crates/asterlyn-git/operations    bounded mutations
crates/asterlyn-git/operation     reviewed plans, lifecycle, conflicts, outcomes
crates/asterlyn-git/process       command runner and output policy

crates/asterlyn-workspace/catalog existing authorization and discovery
crates/asterlyn-workspace/editing existing read/save and revisions
crates/asterlyn-workspace/operations create, move, copy, and trash
crates/asterlyn-workspace/recovery recoverable multi-file work
```

## Migration sequence

### R1 — Decisions, characterization, and reference boundary

- Accept ADR-0007 and ADR-0008.
- Add the architecture and rendering gates to the definition of done.
- Extract Git History list rendering and event delegation behind its stable host without changing
  visible behavior or Git queries.
- Record focused behavior, build-size, and source-concentration evidence.

Exit gate: commit selection, keyboard navigation, paging, graph projection, scroll identity, and
detail loading remain compatible; selection does not rebuild the history host.

### R2 — Frontend capability ownership

Extract in this order: Git History/Details, Remote/Push, Changes/Commit, Files/Editor coordination,
then Settings/Shell. Split CSS with each owning feature. Replace broad rerender calls with typed
feature actions. Add viewport virtualization to bounded history and project/change trees before
their mounted rows exceed the architecture gate.

Progress: the first R2 slice moves Git History query loading, page-window reconciliation,
scroll-triggered append/refresh, commit selection, commit-detail caching, stale-result rejection,
and disposal into `GitHistoryDetailsController`. `AsterlynApp` now routes typed controller changes
to the stable History list and Details hosts. The second slice moves Remote/Push selection, dialogs,
preview paging, tag and force-with-lease review options, commit-detail caching, pushed-file Diff,
operation cancellation, stale-result rejection, and disposal into `RemotePushController`. The third
slice moves Changes selection, commit inclusion, presentation/disclosure state, commit message,
working Diff and image-Diff requests, revert and commit mutation identity, stale-result rejection,
and disposal into `ChangesCommitController`. The fourth slice moves the workspace file catalog,
project-tree cache/selection/disclosure and refresh ownership into `ProjectFilesController`, and the
Editor session, text load/reload/save and project-image request lifecycles into
`EditorSessionController`. The fifth slice moves settings section/preferences and shell
page/layout/activity/menu/chrome state into `SettingsController` and `ShellController`. The planned
controller sequence is complete, but view/CSS ownership, bounded mounting and lazy capability
loading remain before the R2 exit gate can pass. The sixth slice moves project-tree and Changes-tree
presentation into feature-owned views and bounds History, project, and changed-file mounting to 200
rows with overscan. Long-list DOM growth is now bounded; lazy editor/Diff loading, stylesheet
ownership, remaining composition-root reduction, and closing acceptance are still required. The
seventh slice moves CodeMirror text/Diff engines and Markdown preview parsing/highlighting behind
first-use dynamic imports, reducing the startup chunk from 768.53 kB to 410.51 kB and passing the
below-500-kB gate. Stylesheet ownership, remaining composition-root reduction, and closing
acceptance are still required. The eighth slice replaces the 6,338-line global stylesheet with
capability-owned and shared layers whose largest file is 790 lines; browser checks preserve the
workbench, editor, Diff, and Git surfaces. Remaining composition-root reduction and closing
acceptance are still required. The ninth slice moves shell, Settings, Remote/Push, and pushed-Diff
presentation into capability-owned views and gives the activity rail an explicit listener disposal
lifecycle. The tenth slice moves branch navigation, History filters and dialogs, commit changed-file
presentation, commit metadata, and branch inspection into Git History-owned views. Editor and
workspace-search presentation remain before closing acceptance. The eleventh slice moves quick
navigation, workspace-search and replacement presentation, editor chrome, image/Diff presentation,
and the complete lazy CodeMirror/Markdown surface lifecycle into Files/Editor-owned boundaries.
The twelfth and closing slice moves global shell routing, the workspace resize observer, tab-wheel
handling, native window controls, native resize/close subscriptions, and their complete disposal
lifecycle into Shell-owned bindings. R2 passes frontend, Rust, browser, resource, native-smoke, and
Debian acceptance. The remaining 5,955-line migration-era composition adapter is frozen below a
6,000-line automated ceiling and tracked as R3-01; unrelated capability expansion remains blocked
until its application-service seams replace the remaining cross-feature coordination.

Exit gate: `AsterlynApp` is a composition root rather than a feature implementation, every feature
has explicit disposal, and unrelated feature state cannot trigger its DOM replacement.

Status: **accepted on 2026-09-12**. In this migration stage, “composition root” includes the existing
window-level workflow adapter required to coordinate canonical repository/workspace results. It does
not reclaim extracted feature markup, CodeMirror/Markdown runtime objects, native window
subscriptions, list listeners, or controller disposal. The workflow state and request identities
that still remain are named by R3-01 rather than treated as a finished terminal design; the explicit
source ceiling prevents this adapter from becoming a feature-growth destination in the interim.

### R3 — Application services and protocol

- Resolve R3-01 before unrelated capability work: move remaining search/replacement, History-filter,
  branch-operation, refresh, and host coordination out of the 5,955-line migration adapter as the
  window-scoped sessions and typed invalidation protocol become available.
- Introduce window-scoped `WorkspaceSession` and `RepositorySession` catalogs.
- Define the watcher-facing typed slice invalidation and coalescing contract from ADR-0009. R3 owns
  the session identities, scheduling, stale-result rejection, and targeted reconciliation seam;
  native watcher activation follows as a focused Stage 3 slice after these boundaries are stable.
- Move Git mutation serialization and task supervision from Tauri commands into application
  services.
- Split Tauri commands and bridge adapters by capability.
- Generate TypeScript protocol types from one versioned schema and validate responses at the
  boundary.
- Replace broad repository mutation responses with typed outcomes and slice invalidations.

Exit gate: opening or saving a file is not proportional to total project files after session
activation, and a status mutation does not reload history or refs.

### R4 — Recoverable Git operations

Implement ADR-0008 in merge, cherry-pick, rebase, then squash order. Add restart, stale-plan,
external-Git-race, cancellation, conflict, continue, skip, abort, detached-HEAD, unborn-branch, and
submodule fixtures before each operation becomes enabled.

Exit gate: every interrupted operation can be reconstructed from Git, every action is explicitly
allowed by the current operation snapshot, and uncertain outcomes are never retried automatically.

### R5 — Workspace mutation foundation

Build create, rename/move, copy/paste, and trash-first delete on the R3 session catalog and the
ADR-0009 watcher/invalidation foundation. File operations use typed identities,
source/destination revisions, explicit collision policy, case-only rename handling, cross-device
behavior, and recoverable multi-file outcomes. The Files tree, editor tabs, search, and Git status
reconcile from one session catalog.

Exit gate: file operations cannot escape the workspace, destroy an unreviewed destination, or lose
open-buffer identity, disclosure, selection, and scroll state.

## Performance budgets

- Commit selection updates row state and one detail region; it does not replace branch or history
  containers.
- A cached immutable commit-detail selection performs no native request.
- A 3,000-commit session mounts no more than 200 ordinary rows once virtualization lands.
- Splitter pointer updates perform no synchronous layout read after their write and target a 16.7 ms
  frame budget on supported hardware.
- File activation and save perform bounded targeted authorization after session warm-up rather than
  a full project scan.
- Status-only reconciliation neither reads nor serializes complete history, branches, or remotes.
- Optional Markdown, language, preview, and Git-dialog code remains lazy; the main production chunk
  returns below 500 kB.

## Delivery policy

Each R phase is one remotely published development milestone after its complete gate passes. Local
commits may preserve safe rollback boundaries, but packaging and remote publication occur at the
phase boundary rather than after every mechanical extraction. Every phase records focused tests,
broader validation, performance interpretation, accessibility evidence, artifact size, and known
limitations. The locally built Debian package remains the manual Linux acceptance artifact.
