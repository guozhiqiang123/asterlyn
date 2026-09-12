# R4 recoverable Git operations acceptance — 2026-09-12

## Scope and architecture result

R4 is locally accepted as one reviewed and recoverable operation lifecycle for Merge, ordered
Cherry-pick, Rebase, and bounded Squash. System Git remains the mutation engine and durable source
of interrupted-operation truth. A prepared plan binds the canonical worktree, checked-out branch,
exact starting `HEAD`, ordered target refs and object IDs, operation-specific commit count, optional
message, and opaque identity token. Execution repeats the read-only plan and rejects a stale review
instead of adapting it to new repository state.

The Rust core reconstructs Merge, Cherry-pick, and Rebase state from Git-owned metadata and index
stages after every mutation and application restart. The typed snapshot exposes only actions legal
for the current phase: Continue after conflicts are resolved, Skip only for Cherry-pick or Rebase,
and Abort only when Git owns a recoverable sequence. Squash is deliberately narrower: a clean
first-parent range of at most 1,000 commits becomes one commit, and the checked-out branch is moved
with an exact old-`HEAD` `update-ref` lease. It does not use reset, rewrite another branch, push, or
retry.

On the frontend, a feature-owned controller owns request identity, plans, operation state, conflict
documents, and stale-completion rejection. A disposable dialog binding owns lazy loading, DOM
listeners, focus capture/return, and render generations. `AsterlynApp` composes that capability and
retains only window-level save guards, mutation-result installation, editor reconciliation, and
navigation to Changes. Resolving one conflict returns tracked state plus the operation snapshot;
History, Refs, project disclosure, editor tabs, and unrelated buffers are not reloaded.

The source distribution is useful architecture evidence, not an acceptance target. The composition
root is 5,910 lines; operation controller, dialog binding, and view are 340, 158, and 121 lines. The
Rust operation module is 1,742 lines including 14 temporary-repository fault fixtures. It remains
cohesive around one plan/execution/recovery invariant set. R4 therefore does not claim that a file
is better merely because it is shorter; ownership, dependency direction, disposal, and behavioral
coverage govern decomposition.

## Functional and fault-safety evidence

- The complete frontend suite passes 276/276 tests. Operation fixtures cover restart
  reconstruction, exact review and ordered targets, repository replacement, conflict revision
  identity, narrow repository integration, and the ownership/disposal boundaries. Existing History,
  Changes, Remote/Push, project, editor, watcher, splitter, and shell behavior remains covered.
- The Rust workspace passes 111 automated tests: 22 desktop-library tests, one executable test, 63
  Git-core tests, and 25 workspace-core tests. One real operating-system watcher fixture is
  intentionally excluded from ordinary runs and remains covered by the separate R3.1 native
  acceptance procedure.
- Git-core fault fixtures cover stale `HEAD`, dirty worktrees for all four plan kinds, detached and
  unborn states, pre-start cancellation, initialized submodule identity, changed conflict content,
  Merge continue/abort, Cherry-pick order/skip/continue, Rebase continue/abort, and Squash
  first-parent/exact-lease behavior.
- Conflict text is limited to four MiB per side. The revision token covers Base, Ours, Theirs, and
  current worktree bytes. Resolution rejects escaping, ambiguous, or symbolic-link paths, rechecks
  the token before writing, stages the exact path, and verifies its stage-zero blob afterward.
- TypeScript checking, production build, Rust formatting, strict all-target/all-feature Clippy, and
  the complete Rust workspace pass. The release executable remained alive for the complete 6,000 ms
  isolated native-smoke interval.

Cancellation is intentionally pre-start for local operations. It is checked before and after
read-only revalidation; after system Git starts, Asterlyn neither terminates nor automatically
retries a mutation whose repository outcome may have changed. A paused result is reconstructed and
shown in Changes, where the user can explicitly Continue, Skip, or Abort as allowed.

## Interaction and accessibility evidence

History branch details open Merge or Rebase review, commit details open Cherry-pick or “Squash
commits after this,” and the Git tool heading provides a general operation entry. Update exposes
Fast-forward, Merge, or Rebase only when the observed relationship permits it. Merge and Rebase
perform Fetch first and then require a second exact-object review, because the fetched target may
differ from the object shown in the first dialog.

An interrupted operation routes to Changes, includes and selects its first unresolved path, and
retains the normal working Diff. Resolve opens the lazy Base/Ours/Theirs plus editable-result
surface. Dialogs expose native dialog roles and names, labelled form controls, busy/error status,
keyboard focus containment, source-focus restoration, and explicit destructive labels. Automated
markup, ownership, and lifecycle tests pass. Installed macOS/Windows assistive-technology testing
and complete keyboard/manual conflict resolution remain human acceptance work and are not claimed
by this local gate.

## Build, package, and resource evidence

Measurement host: Deepin 23.1, Linux 6.12.20 x86_64, Node 24.19.0, npm 11.17.0, Rust/Cargo 1.98.1,
and Git 2.47.2. The production build transformed 299 modules. The Git operation dialog remains a
lazy 6.06 kB JavaScript and 2.78 kB CSS capability instead of joining startup.

| Artifact | R4.0 | R4 | Change | Interpretation |
| --- | ---: | ---: | ---: | --- |
| CSS | 101.99 kB | 103.59 kB | +1.60 kB (+1.57%) | expected feature styling |
| startup JavaScript | 445.89 kB | 469.58 kB | +23.69 kB (+5.31%) | increased, still below 500 kB budget |
| startup JavaScript gzip | 109.58 kB | 114.78 kB | +5.20 kB (+4.75%) | increased |
| release executable | 20,217,280 B | 20,900,568 B | +683,288 B (+3.38%) | expected operation-core growth; test fixtures are not packaged |
| Debian package | 7,062,856 B | 7,240,800 B | +177,944 B (+2.52%) | expected, no material distribution concern |

Three release runs against the Asterlyn checkout settled for 15 seconds and sampled five seconds of
idle CPU. Process-tree PSS was 189,082, 186,521, and 186,719 KiB; median PSS was 186,719 KiB
(182.34 MiB) and maximum PSS was 189,082 KiB (184.65 MiB). Median RSS was 459,812 KiB and all CPU
samples were 0.00%. Against the same R4.0 method, median PSS moved by -1,798 KiB (-0.95%), which is
**no material change** and not an optimization claim. The absolute result remains below the
provisional 220 MiB ceiling.

The local Debian artifact is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`, 7,240,800 bytes, with SHA-256
`c67ff5782f08c38c952718f847fe39022f8cfd93f155016653bbe28a82476dfb`.

## Limitations and next action

R4 does not provide interactive rebase, commit reordering, per-commit squash/fixup selection,
octopus-specific UI, binary or over-limit conflict merging, rename-conflict specialization,
automatic stashing, arbitrary reset, automatic force push, or retry after an uncertain outcome.
Binary and over-limit conflicts remain visible and can be resolved with an external Git tool or the
explicit deletion action. These limits fail closed rather than weakening the reviewed lifecycle.

R4 is **accepted locally**. The next architecture slice is R5: workspace create, rename/move, copy,
paste, and recoverable trash foundations using the same reviewed-plan, stale-identity, and narrow
reconciliation principles. Remote publication of the R4 commits is intentionally deferred until
the user approves the local Debian build.
