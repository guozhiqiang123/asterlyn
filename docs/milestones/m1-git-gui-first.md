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

The accepted [`M1.1 evidence`](../benchmarks/2026-09-08-m1-1-tracked-first.md) concludes that tracked readiness **improved** and repeated Linux memory showed **no material change** while remaining within budget. The Linux vertical slice is accepted for continued development. The [`cross-platform preview workflow`](../engineering/ci.md) has passed Linux, Windows, macOS Apple Silicon, and macOS Intel packaging with read-only permissions, published checksums for every target, and launched each native executable for a bounded process-liveness smoke check. M1 remains open at the release level until installed artifacts receive interactive Windows and macOS smoke checks; signing, notarization, updater behavior, and publication remain later delivery gates.

Feature development now follows the [`daily-driver interaction backlog`](../design/daily-driver-interactions.md). Open Windows/macOS interactive checks still prevent a release-candidate claim, but they do not block the ordered usability slices.

U1–U3 are published as the first usability phase. Asterlyn now has compact desktop chrome; searchable, keyboard-navigable commit file/patch inspection; filtered scope-aware working-tree multi-selection and batch stage/unstage; and shared unified/split/whitespace patch presentation. U4 safe local branch work is published: existing local checkout and new local-branch creation are available only behind a complete clean-worktree gate, with the Git core repeating validation immediately before mutation.

U5 is locally accepted for its phase checkpoint. The top-bar Sync workflow provides canonical branch-only Fetch, clean fast-forward Pull, explicit non-force Push, and first Publish through configured non-interactive Git credentials, with repository-scoped cancellation and fresh-state reconciliation. Remote URLs and child output never enter application state. The native bare-remote journey, safety evidence, and intentionally unsupported remote configurations are recorded in the interaction backlog.

U6 is locally accepted as the durable workbench boundary. Files and Changes now share an independently resizable left dock, Branches uses an independently resizable bottom three-column tool, and typed working or commit Diff documents open in a permanent center editor. The source-like split Diff uses hunk-derived line numbers, explicit omitted context, aligned sides, and conservative intraline highlights while remaining honest about its 4 MiB bounded-patch source. The complete comparison, Linux package and native-interaction evidence, limitations, and Stage 3 handoff are recorded in the interaction backlog.

U7 is the active desktop interaction-fidelity slice. It consolidates activity and changed-file selection into one visual signal, makes changed files primary in commit details, adds a Git tool-window Hide action that preserves the active editor, replaces native path typing with a system folder chooser, and regenerates platform icons from one safe-area-aware Asterlyn source. The detailed interaction and security boundaries are recorded in the interaction backlog.
