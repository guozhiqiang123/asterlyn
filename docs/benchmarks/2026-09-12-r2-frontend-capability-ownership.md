# R2 frontend capability-ownership acceptance — 2026-09-12

## Scope

R2 converts the first working Git GUI and editor implementation from one application-owned
presentation into explicit frontend capability boundaries. The accepted sequence covers Git
History and Details, Remote and Push review, Changes and Commit, Files and Editor, Settings, and
the Shell. It also introduces bounded high-cardinality views, lazy editor runtimes, capability-owned
styles, stable DOM hosts, typed controller changes, stale-result protection, and explicit disposal.

The closing slice moves static shell events and native window chrome out of `AsterlynApp`.
`ShellEventBinding` owns window keyboard and pointer routing, dialog dismissal, the workspace
observer, tab-wheel behavior, and one abortable listener lifetime. `WindowChromeBinding` owns native
resize and close-request subscriptions, custom window controls, dirty-document close confirmation,
and release of native listeners. Empty Settings and Shell subscriptions left from migration were
removed.

This is a behavior-preserving architecture milestone. It does not add merge, rebase, cherry-pick,
squash, filesystem mutation, a protocol migration, or a new framework.

## Ownership and source concentration

The audited R1 baseline had the following concentration:

| Source | R1 baseline | R2 result | Interpretation |
| --- | ---: | ---: | --- |
| `src/app.ts` | 9,611 lines | 5,955 lines | 3,656 fewer lines, 38.0% reduction |
| global `src/styles.css` | 6,282 lines | 198 lines | reduced to foundations; largest owned layer is 790 lines |
| largest `src/features` or `src/shell` TypeScript file | not applicable | 765 lines | below the 800-line review trigger |
| startup JavaScript | 733.90 kB | 412.56 kB | 43.8% smaller; below the 500 kB gate |

The new `frontend-ownership-budget` test keeps `src/app.ts` at or below the accepted 6,000-line R2
ceiling, keeps every feature and shell TypeScript boundary at or below 800 lines, and checks the
explicit shell/window listener disposal mechanisms. This ceiling freezes the remaining migration
debt; it is not a claim that 5,955 lines is a desirable terminal composition-root size.

### R3-01 residual decomposition issue

`src/app.ts` remains above the general 1,500-line production-source gate. Its remaining work is the
window-scoped composition adapter: workspace/repository activation, cross-feature refresh routing,
search/replacement workflow coordination, History filter projection, commit-Diff inspection,
branch mutation routing, and legacy host adapters. Further mechanical file movement without
window-scoped application services would only hide coupling.

R3-01 is therefore the first R3 migration item. It must introduce `WorkspaceSession` and
`RepositorySession`, typed slice invalidations, and capability adapters before unrelated feature
expansion. Merge, rebase, cherry-pick, squash, and filesystem mutation remain blocked. This is the
explicit decomposition issue required by the architecture gate.

## Functional and accessibility evidence

- All 233 frontend script tests pass. They cover controller ownership, request identity,
  virtualization, lazy runtime boundaries, view projection, editor state, Git safety, persistence,
  keyboard interactions, desktop icons, and delivery contracts.
- The Rust workspace passes 17 Tauri library tests, one executable test, 48 `asterlyn-git` tests,
  and 25 `asterlyn-workspace` tests, plus documentation tests: 91 native tests in total.
- Rust formatting, strict all-target workspace Clippy, TypeScript checking, and the deterministic
  production build pass.
- The browser demo opens Settings and returns to the workbench, opens the project menu, closes it
  when quick navigation opens, exposes the Go to File dialog with a named textbox/listbox/options,
  and closes that dialog with Escape.
- The accessibility tree retains named project, remote, refresh, settings, tool-window, file-tree,
  Settings navigation, dialog, and keyboard-hint semantics. The extracted bindings preserve focus
  return for repository and dialog interactions.
- The release executable remains alive for the complete 6,000 ms isolated native smoke interval.

The browser evidence validates presentation and keyboard routing in Chromium demo mode. It does not
replace installed Windows/macOS assistive-technology or native close-control acceptance.

## Build and resource evidence

Measurement host: Deepin 23.1, Linux 6.12.20 x86_64, Node 24.19.0, npm 11.17.0, Rust 1.98.1,
Cargo 1.98.1, and Git 2.47.2. The measured source commit is `22b0e2a` and the repository fixture is
the Asterlyn checkout. The release process tree contains three processes.

The production frontend reports 101.99 kB CSS (23.38 kB gzip) and 412.56 kB startup JavaScript
(101.98 kB gzip). CodeMirror, Diff, Markdown preview, and language modules remain first-use chunks.

Three release launches each settled for 15 seconds before memory sampling and then used a five
second idle-CPU window:

| Run | Process-tree PSS | Summed RSS | Idle CPU |
| ---: | ---: | ---: | ---: |
| 1 | 151.26 MiB | 440.87 MiB | 0.00% |
| 2 | 154.03 MiB | 445.99 MiB | 1.40% |
| 3 | 149.43 MiB | 440.70 MiB | 0.00% |

Median PSS is 151.26 MiB and the maximum is 154.03 MiB, leaving 65.97 MiB below the provisional
220 MiB Linux ceiling. Median idle CPU is 0.00%. The absolute budget result is healthy, but the
series is not a matched pre/post run against the same commit and loaded interaction state, so the
memory effect of R2 is **inconclusive** rather than a reduction claim.

The release executable is 19,630,408 bytes. The local manual-acceptance package is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`, 6,883,358 bytes, with SHA-256
`d55a3cd46bc3458c4e562c4cdf753b5fc75ec8abe483e246cab31c73c0d3048e`.

## Acceptance and limitations

R2 is **accepted**. Extracted feature state/request lifecycles, owned views and styles, bounded
lists, lazy heavy runtimes, global listeners, native window listeners, and disposal boundaries are
now explicit. Selection and details changes remain scoped to their stable capability hosts, and
the startup chunk is below its architecture budget.

The result is **improved** for ownership, rendering scale, startup payload, lifecycle reviewability,
and rollback isolation. Native/package size has no matched R1 package comparison in this final run,
and memory improvement is inconclusive. Installed macOS/Windows interaction, very large Markdown
frame timing, and long-running editor heap retention remain manual or later cross-platform gates.

R3 begins with R3-01 rather than a new end-user feature. It establishes application services,
window sessions, protocol ownership, and slice invalidation so later recoverable Git and filesystem
operations do not rebuild the coupling removed in R2.
