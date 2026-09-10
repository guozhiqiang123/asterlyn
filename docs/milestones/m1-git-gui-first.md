# M1: Git GUI First

## Outcome

M1 is the smallest honest product slice: a developer can open a local repository, understand its current state, inspect a change, stage or unstage selected paths, review recent history, and create a commit without leaving Asterlyn.

It is not the final product identity and does not authorize shortcuts that would block the editor roadmap.

## Included

- Open a repository from an explicit local path and remember recent paths locally.
- Display repository root, current branch or detached HEAD, upstream, ahead/behind, and operation hints where available.
- Parse porcelain v2 entries for ordinary, renamed/copied, unmerged, untracked, and ignored paths.
- Separate staged and unstaged views without hiding partially staged files.
- Show a read-only patch in CodeMirror 6.
- Show recent commits and local/remote branches.
- Stage and unstage selected paths.
- Create a commit from an explicit message after presenting what is staged.
- Refresh without blocking the UI and reject stale responses.
- Browser demo mode for presentation work when the native shell cannot be built.

## Explicitly deferred

- Discarding work, reset, clean, force push, interactive rebase, merge conflict editing, submodule mutation, credential prompts, commit signing UI, and worktree management.
- File-system watchers; M1 uses explicit/event-triggered refresh.
- Graph lane rendering and provider-specific pull-request workflows.
- Binary-safe path transport for non-UTF-8 filenames.

## Acceptance gates

### Correctness

- Parser unit tests cover ordinary, rename, unmerged, untracked, ignored, detached, ahead/behind, and partial-stage cases.
- Integration tests create a temporary repository and exercise snapshot, stage, unstage, diff, and commit without mutating a user repository.
- Every Git process is invoked without a shell and every mutation is followed by a fresh snapshot.

### User workflow

- A first-time user can complete open → inspect → stage → commit using visible controls.
- All primary actions are keyboard reachable and expose disabled/busy/error states.
- Empty, loading, clean, detached, no-upstream, and command-failure states are designed, not blank screens.

### Performance baseline

- Record release-build cold/warm startup, process-tree PSS and RSS after 60 seconds idle, refresh latency, first-diff latency, and a large-repository fixture description.
- Initial targets are budgets to calibrate, not claims: warm visible window ≤ 1.5 s, median ordinary refresh ≤ 250 ms, p95 ≤ 750 ms, idle CPU ≤ 1%, and Linux total process-tree PSS ≤ 220 MiB on the named benchmark machine.
- A miss does not get hidden. Record result, explanation, and next action before the gate can be accepted or revised.

### Delivery

- TypeScript checks and production frontend build pass.
- Pure Rust Git-core tests pass.
- Native Tauri build passes on each release platform in CI or is explicitly blocked with the missing host prerequisite recorded.
- No Rebased/JetBrains source, icon, font, trademark, or branded asset is shipped.

## Current slice

The first implementation slice covers repository open/refresh, status/history/branch presentation, patch viewing, stage/unstage, and commit. Advanced Stage 2 operations remain outside this slice.

The first accepted evidence set is recorded in [`../benchmarks/2026-09-08-m1-baseline.md`](../benchmarks/2026-09-08-m1-baseline.md). Its conclusion is **mixed**: the vertical slice and packaging are viable, but large-repository untracked discovery exceeds the refresh budget and the memory margin needs repeated measurement before M1 can close.

M1.1 follows [`ADR-0002`](../architecture/decisions/0002-tracked-first-refresh.md): interactive refresh returns tracked truth first, displays provisional counts while untracked discovery runs, cancels obsolete scans, and never labels a pending or failed scan as a clean repository.

The accepted [`M1.1 evidence`](../benchmarks/2026-09-08-m1-1-tracked-first.md) concludes that tracked readiness **improved** and repeated Linux memory showed **no material change** while remaining within budget. The Linux vertical slice is accepted for continued development. The [`cross-platform preview workflow`](../engineering/ci.md) has passed Linux, Windows, macOS Apple Silicon, and macOS Intel packaging with read-only permissions, published checksums for every target, and launched each native executable for a bounded process-liveness smoke check. A separate protected workflow now defines Developer ID signing, notarization, installed-form Gatekeeper checks, and two-architecture checksum gating, but it has no provisioned credentials or accepted run yet. M1 remains open at the release level until signed artifacts receive interactive Windows and macOS smoke checks; updater behavior and publication remain later delivery gates.

Feature development now follows the [`daily-driver interaction backlog`](../design/daily-driver-interactions.md). Open Windows/macOS interactive checks still prevent a release-candidate claim, but they do not block the ordered usability slices.

U1–U3 are published as the first usability phase. Asterlyn now has compact desktop chrome; searchable, keyboard-navigable commit file/patch inspection; filtered scope-aware working-tree multi-selection and batch stage/unstage; and shared unified/split/whitespace patch presentation. U4 safe local branch work is published: existing local checkout and new local-branch creation are available only behind a complete clean-worktree gate, with the Git core repeating validation immediately before mutation.

U5 is locally accepted for its phase checkpoint. The top-bar Sync workflow provides canonical branch-only Fetch, clean fast-forward Pull, explicit non-force Push, and first Publish through configured non-interactive Git credentials, with repository-scoped cancellation and fresh-state reconciliation. Remote URLs and child output never enter application state. The native bare-remote journey, safety evidence, and intentionally unsupported remote configurations are recorded in the interaction backlog.

U6 is locally accepted as the durable workbench boundary. Files and Changes now share an independently resizable left dock, Branches uses an independently resizable bottom three-column tool, and typed working or commit Diff documents open in a permanent center editor. The source-like split Diff uses hunk-derived line numbers, explicit omitted context, aligned sides, and conservative intraline highlights while remaining honest about its 4 MiB bounded-patch source. The complete comparison, Linux package and native-interaction evidence, limitations, and Stage 3 handoff are recorded in the interaction backlog.

U7 is locally accepted as the desktop interaction-fidelity slice. It consolidates activity and changed-file selection into one visual signal, makes changed files primary in commit details, adds a Git tool-window Hide action that preserves the active editor, replaces native path typing with a system folder chooser, and regenerates platform icons from one safe-area-aware Asterlyn source. The interaction, native Linux, package-size, short-settle resource, and remaining platform evidence are recorded in the interaction backlog; the resource result is explicitly inconclusive rather than a memory-reduction claim.

U8 is locally accepted as the Diff and ref-navigation consistency slice. It links horizontal as well as vertical split-Diff movement, makes a selected local/remote/tag ref the source of the middle history column, and adds semantic collapse controls for ref groups. Exact-ref validation, stale-result rejection, delayed-scroll and mutation-race tests, visible interaction acceptance, and the single Linux package run are recorded in the interaction backlog. Stage 3 editor foundations are now the next product slice.

U9 is locally accepted as the compact Git information-workspace slice. Branches and history now use single-purpose compact toolbars and rows; remote refs are grouped by their reported remote; commit decorations carry truthful semantic icons; and selected-commit files switch between tree and flat projections above a persisted, resizable commit summary. Browser interaction, accessibility, native liveness, package-size, and remaining filter/graph limits are recorded in the interaction backlog. Stage 3 editor foundations remain the next product slice.

U10 is locally accepted as the topology-complete history correction. With no selected ref, the middle column now presents the bounded union reachable from local branches, remote-tracking branches, tags, and a detached `HEAD`; selecting one ref narrows the history, and activating it again restores `All refs`. Topologically ordered parent IDs drive an original multi-lane graph with merge fan-out and convergence, while the non-interactive abbreviated-ID list column has been removed. Browser interaction, Git integration, accessibility, native liveness, package-size, filter prioritization, and remaining limits are recorded in the interaction backlog. Stage 3 editor foundations remain the next product slice.

U11 is locally accepted as the history-query and graph-control slice. The middle toolbar now combines multi-ref, exact author/`me`, fixed date, exact tracked-path, text/hash, case, regular-expression, traversal, merge, and ordering controls behind one typed Git boundary with complete stale-response identity. Per-repository Favorites/Recent shortcuts and reversible graph-aware linear-branch collapse add navigation speed without inventing Git state. Browser interaction at full and constrained widths, query validation, accessibility state, native liveness, resource samples, package-size movement, and remaining 150-row/pagination/platform limits are recorded in the interaction backlog. Stage 3 editor foundations are now the next product slice.

U11.1 is locally accepted as the root-qualified history interaction correction. Branch quick navigation is separate from multi-ref editing; Paths provides multiline, tree, Recent, and initialized-root selection; and every read identity routes through a freshly validated main/submodule catalog. Automatic 150-row bottom pagination and top reconciliation replace the silent one-window stop while a 3,000-row ceiling bounds the session. Ref/path/root combinations, colliding object IDs, details and Diff routing, stale page identity, compact interaction, the top-level-only mutation boundary, native liveness, and one Linux package run are covered. Package-size evidence is mixed and the short-settle resource result is regressed above the provisional PSS ceiling, so a normalized 60-second, per-process comparison remains an explicit acceptance follow-up before making any memory claim. Stage 3 editor foundations remain the next product slice; Windows/macOS installed interaction remains deferred until release-candidate work.

The 2026-09-09 product review accepts the Git GUI presentation as basically usable and authorizes Stage 3 editor work. This is a progression decision, not a claim that deferred history rewriting, conflict resolution, platform interaction, or the open performance follow-up is complete. The first editor slice follows [`ADR-0004`](../architecture/decisions/0004-safe-text-editing.md) and the [`editor core interaction plan`](../design/editor-core-interactions.md).

E1 is locally accepted as the safe multi-tab text-editing foundation. Git-authorized tracked and non-ignored untracked files now open as persistent CodeMirror text tabs beside one replaceable Diff preview; exact UTF-8/BOM/line-ending content, optimistic conflict-safe atomic save, and Save-or-Cancel transition guards are covered from pure workspace logic through the desktop boundary and deterministic browser interaction. Absolute validation, build sizes, security limitations, and the E2 handoff are recorded in the editor plan and interaction backlog. Per the agreed delivery cadence, E1 is locally committed without a package or remote push; those remain reserved for the larger Stage 3 checkpoint.

E2.1 is locally accepted as the keyboard-first navigation and bounded-search slice. Quick Open, repository-scoped Recent Files, read-only workspace text search, the Command Palette, verified result navigation, and active-file-only replacement now share explicit pure state and fresh Git/E1 authorization boundaries. The [`E2.1 evidence`](../benchmarks/2026-09-09-e2-1-navigation-search.md) records passing interaction and safety checks, a 15.908-millisecond median core search path on the named fixture, measurable frontend bundle growth, and a short-settle PSS regression above the provisional ceiling with inconclusive attribution across cumulative E1+E2.1 changes. Packaging and remote publication remain deferred to the larger Stage 3 checkpoint; E2.2a on-demand syntax highlighting precedes E2.2b read-only search refinement, and normalized resource attribution remains open before that checkpoint.

E2.2a is locally accepted as on-demand syntax highlighting. Automatic filename matching covers the current 143-entry CodeMirror language catalog; the catalog and selected parser load only after a text editor mounts; stale or failed loads cannot corrupt or block the active buffer; and the token palette has a tested 4.5:1 contrast floor. The [`E2.2a evidence`](../benchmarks/2026-09-09-e2-2a-syntax-highlighting.md) records 88 frontend and 48 Rust tests, production-browser TypeScript/Markdown interaction, a 24.37 kB main-script increase, a broad-catalog packaging increase, and an inconclusive one-run loaded-editor heap observation. No package or remote push is made for this sub-slice. E2.2b read-only search refinement is next; catalog packaging and normalized native resources remain open for the larger Stage 3 checkpoint.

E2.2b is locally accepted as bounded search refinement. Find in Files now provides line-local regular expressions, full workspace-path include/exclude globs, and up to three context lines while retaining fresh Git authorization, exact E1 navigation, explicit partial coverage, cancellation, and no background index. The [`E2.2b evidence`](../benchmarks/2026-09-09-e2-2b-search-refinement.md) records 90 frontend and 52 Rust tests, production-browser and native-smoke interaction, a default combined core-path median within 1.75% of E2.1, a 6.18 kB main-script increase, a cumulative 16.69% native-executable increase since the last retained E2.1 reference, and an inconclusive focused heap observation. The missing E2.2a native measurement prevents assigning the executable movement to this sub-slice alone. No package or remote push is made for this sub-slice. E2.3 recoverable workspace replacement is next; catalog packaging and normalized native resources remain open for the larger Stage 3 checkpoint.

E2.3 is locally accepted and completes the navigation/search phase. Workspace replacement now reruns fresh bounded search, presents file-level before/after review, preflights the selected revisions, writes exact application-local recovery before the first E1 atomic save, and remains reversible until explicit keep or rollback. Cancellation and partial failure restore only unchanged proposals, preserving external edits as visible unresolved recovery. The [`E2.3 evidence`](../benchmarks/2026-09-10-e2-3-recoverable-replacement.md) records 93 frontend and 60 Rust tests, production-browser apply/rollback/keep journeys, interactive named-fixture planning, measurable frontend growth, and an inconclusive single-run heap observation. No package or remote push is made for this sub-slice. E3 editor groups and preferences is next; catalog packaging, normalized native resources, and installed Windows/macOS interaction remain open for the larger Stage 3 checkpoint.
