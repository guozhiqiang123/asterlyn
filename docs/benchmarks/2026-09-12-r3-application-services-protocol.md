# R3 application-services and protocol acceptance — 2026-09-12

## Scope

R3 establishes the application boundary required before recoverable merge, rebase, cherry-pick,
squash, and workspace mutation work. It is a behavior-preserving architecture milestone rather
than a new end-user feature.

The milestone adds window-scoped workspace and repository sessions, canonical-root and generation
checks, typed slice invalidation, tracked-first reconciliation, operation supervision, per-root Git
mutation serialization, window-owned search/replacement identities, and a version-one desktop
protocol schema with generated TypeScript command types and runtime response validation. The
filesystem-watching conclusion is recorded in ADR-0009; native watcher activation deliberately
remains a later focused Stage 3 slice.

## Architecture result

The R2 closing commit `22b0e2a` is the source-concentration baseline. The measured R3 code commit is
`c0d90f5`.

| Boundary | R2 | R3 | Interpretation |
| --- | ---: | ---: | --- |
| `src/app.ts` | 5,955 lines | 5,754 lines | 201 lines removed; async ownership moved to services |
| `src/bridge.ts` | 1,476 lines | 1,471 lines | native bridge split; demo adapter remains bounded debt |
| `src-tauri/src/lib.rs` | 3,073 lines | 1,397 lines | all 38 commands and image policy moved to owned modules |
| startup JavaScript | 412.56 kB | 435.53 kB | 5.57% larger; still below the 500 kB budget |

The frontend now composes `WindowSession`, `WorkspaceSession`, and `RepositorySession` rather than
letting each workflow invent root and stale-result rules. Search/replacement and branch mutations
enter application coordinators. History-filter persistence and query normalization have one
controller. Project refreshes enter only through the window-session gateway.

The Rust host has capability command modules for shell, workspace, Git reads, Git operations, and
images. Search/replacement tasks, remote tasks, untracked scans, workspace writes, and local Git
mutations have explicit owners and cleanup. Production Tauri bridge calls are split into matching
capability adapters. The browser demo bridge still provides deterministic cross-capability fixture
state, but its first search-policy helper has moved under `src/adapters/demo`; it cannot become a
second production protocol owner.

Project discovery installs a root-qualified identity catalog in the invoking window session. A
single text read, image read, or save performs a constant-time catalog lookup and a targeted current
authorization check. Git-backed files recheck the exact nested repository, tracked state, and
ignore policy; the workspace crate still verifies current component traversal and file kind. Bulk
search and replacement intentionally build their own bounded fresh catalogs.

Working-tree-only mutations return `WorkingTreeMutationOutcome` and invalidate only the working
tree and dependent open-document presentation. They do not read, serialize, or reconcile complete
history, refs, or remotes. Branch and remote mutations return explicit broader slice sets. Unknown
slice values and malformed command responses fail at the desktop boundary.

## Validation and accessibility evidence

- All 252 frontend script tests pass. Focused R3 coverage includes session identity, stale project
  refresh rejection, invalidation merging, status-only reconciliation, operation ownership,
  generated protocol parity, malformed response rejection, and source-concentration gates.
- The Rust workspace passes 18 desktop-library tests, one executable test, 48 `asterlyn-git` tests,
  and 25 `asterlyn-workspace` tests, plus documentation tests: 92 native tests in total.
- TypeScript checking, the deterministic production build, Rust formatting, and strict all-target
  workspace Clippy pass.
- The release executable remains alive for the complete 6,000 ms isolated native smoke interval.
- R3 changes no visible control, focus order, name, keyboard route, or presentation state. Existing
  view, keyboard, dialog, and accessible-name tests remain green. This is neutral accessibility
  evidence, not installed Windows/macOS assistive-technology acceptance.

## Build and resource evidence

Measurement host: Deepin 23.1, Linux 6.12.20 x86_64, AMD Ryzen 5 3600X (6 cores/12 threads),
19 GiB RAM, Node 24.19.0, npm 11.17.0, Rust/Cargo 1.98.1, and Git 2.47.2. The fixture is the Asterlyn
checkout at `c0d90f5`. Each release run settled for 15 seconds before process-tree memory sampling
and used a five-second idle-CPU window.

| Run | Processes | Process-tree PSS | Summed RSS | Idle CPU |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | 171.81 MiB | 440.63 MiB | 0.00% |
| 2 | 3 | 169.50 MiB | 436.23 MiB | 0.00% |
| 3 | 3 | 171.51 MiB | 440.32 MiB | 0.00% |

Median PSS is 171.51 MiB and maximum PSS is 171.81 MiB, leaving 48.19 MiB below the provisional
220 MiB Linux ceiling. Median idle CPU is 0.00%. Compared with the R2 median of 151.26 MiB using the
same host and timing method, PSS is 20.25 MiB, or 13.39%, higher. Memory is therefore
**regressed**, not improved. The sample does not isolate WebKit allocation noise, the larger startup
protocol code, and the newly retained session catalog; a matched loaded-workspace heap/process
profile is required before assigning cause.

The production frontend reports 101.99 kB CSS (23.38 kB gzip) and 435.53 kB startup JavaScript
(106.98 kB gzip). Startup JavaScript grew by 22.97 kB from R2, so bundle size is **regressed**, while
remaining 64.47 kB below the architectural ceiling. The release executable is 19,825,592 bytes,
195,184 bytes (0.99%) above R2.

The local manual-acceptance package is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`, 6,937,044 bytes, with SHA-256
`0da10ba4a2066f269773afbb3b1d401929ad92c4d84600b5a98a5a52f3e27445`.

## Acceptance and limitations

R3 is **accepted** for its application-service and protocol gate. File activation no longer performs
a full project-catalog traversal after session activation, status-only mutation does not reload
history or refs, stale project results cannot replace another window generation, and future Git
operations now have one serialization/supervision and typed-reconciliation foundation.

Acceptance is not a claim that physical decomposition is finished forever. `src/app.ts` remains a
5,754-line migration adapter, above the general 1,500-line production gate. Its R3 workflows no
longer own their asynchronous identities, but unrelated feature growth remains blocked and the new
5,800-line automated ceiling prevents backsliding. The 1,471-line deterministic browser demo bridge
also remains above the 800-line review trigger, though below the 1,500-line blocker; it must be
split further if demo capabilities expand. The 13.39% Linux PSS regression is a tracked performance
concern. Native watcher activation, external dirty-buffer conflict UX, installed Windows/macOS
interaction, and recoverable merge/rebase conflict editing remain later work.
