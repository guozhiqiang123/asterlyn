# Documentation map

The documents in this directory are the current source of truth. A decision that changes architecture, product behavior, compatibility, quality gates, or milestone scope must update the relevant page in the same change.

## Product

- [`product/vision.md`](product/vision.md) — product identity, users, principles, and non-goals.
- [`product/roadmap.md`](product/roadmap.md) — audited 3–5 year, seven-stage roadmap.

## Architecture

- [`architecture/overview.md`](architecture/overview.md) — boundaries, dependency direction, runtime model, and evolution seams.
- [`architecture/decisions/0001-foundation.md`](architecture/decisions/0001-foundation.md) — first architecture decision record.
- [`architecture/decisions/0002-tracked-first-refresh.md`](architecture/decisions/0002-tracked-first-refresh.md) — cancellable two-phase repository refresh contract.
- [`architecture/decisions/0003-persistent-workbench.md`](architecture/decisions/0003-persistent-workbench.md) — persistent editor, orthogonal tool windows, and resizable layout state.
- [`architecture/decisions/0004-safe-text-editing.md`](architecture/decisions/0004-safe-text-editing.md) — authorized text-file access, optimistic save, and editor-session ownership.
- [`architecture/decisions/0005-bounded-navigation-search.md`](architecture/decisions/0005-bounded-navigation-search.md) — keyboard-first navigation, bounded cancellable text search, and safe replacement scope.
- [`architecture/decisions/0006-language-adapter-evolution.md`](architecture/decisions/0006-language-adapter-evolution.md) — syntax adapters now, optional Tree-sitter language packs later, and deferred semantic intelligence.
- [`architecture/decisions/0007-workbench-feature-ownership.md`](architecture/decisions/0007-workbench-feature-ownership.md) — feature-owned workbench state, stable DOM hosts, and scoped rendering.
- [`architecture/decisions/0008-recoverable-git-operations.md`](architecture/decisions/0008-recoverable-git-operations.md) — reviewed, resumable, and conflict-aware Git operation lifecycle.
- [`architecture/decisions/0009-hinted-workspace-reconciliation.md`](architecture/decisions/0009-hinted-workspace-reconciliation.md) — native watcher hints, typed slice invalidation, authoritative reconciliation, and fallback policy.
- [`architecture/decisions/0010-read-only-ignored-previews.md`](architecture/decisions/0010-read-only-ignored-previews.md) — bounded, individually authorized read-only previews for Git-ignored files.
- [`architecture/decisions/0011-supervised-terminal-sessions.md`](architecture/decisions/0011-supervised-terminal-sessions.md) — lazy, window-scoped PTY sessions with explicit lifecycle and resource bounds.
- [`architecture/decisions/0012-versioned-workspace-reconciliation.md`](architecture/decisions/0012-versioned-workspace-reconciliation.md) — linearized repository commits, exact watcher ownership, bounded recovery, and capability transitions.
- [`architecture/decisions/0013-feature-owned-context-actions.md`](architecture/decisions/0013-feature-owned-context-actions.md) — feature-owned context actions presented through one business-neutral window menu host.

## Delivery

- [`milestones/m1-git-gui-first.md`](milestones/m1-git-gui-first.md) — first vertical slice and acceptance gates.
- [`engineering/quality-gates.md`](engineering/quality-gates.md) — durable quality, performance, compatibility, and release rules.
- [`engineering/architecture-refactoring.md`](engineering/architecture-refactoring.md) — current architecture audit, target boundaries, migration order, and refactoring gates.
- [`engineering/versioned-reconciliation-plan.md`](engineering/versioned-reconciliation-plan.md) — watcher/reconciliation risks, phased implementation, invariants, and acceptance matrix.
- [`engineering/context-action-system.md`](engineering/context-action-system.md) — whole-draft audit, context-action architecture, R5 prerequisites, surface ownership, and delivery sequence.
- [`engineering/local-build.md`](engineering/local-build.md) — reproducible frontend, Rust, native Linux, and packaging setup.
- [`engineering/ci.md`](engineering/ci.md) — least-privilege cross-platform preview builds and artifact trust boundary.
- [`governance/lifecycle.md`](governance/lifecycle.md) — how a multi-year codebase changes without fossilizing early choices.

## Design and references

- [`design/rebased-reference.md`](design/rebased-reference.md) — what may be learned from Rebased and what must remain original.
- [`design/context-menu-drafts.md`](design/context-menu-drafts.md) — reviewed per-surface context-menu behavior inputs for Editor/Diff Git Blame, Files, Changes, Branches, History, and commit details.
- [`design/interaction-feedback.md`](design/interaction-feedback.md) — mandatory visible feedback and stable event-lifecycle rules for every user-invoked action.
- [`design/daily-driver-interactions.md`](design/daily-driver-interactions.md) — usability audit and ordered interaction/feature slices.
- [`design/editor-core-interactions.md`](design/editor-core-interactions.md) — Stage 3 editor slices, invariants, and acceptance evidence.
- [`design/terminal-interactions.md`](design/terminal-interactions.md) — integrated-terminal phases, interaction contract, dependency review, and T1 acceptance gates.
- [`design/localization-color-themes.md`](design/localization-color-themes.md) — implementation plan for English/Chinese localization and System/Dark/Light appearance.

## Benchmarks

- [`benchmarks/2026-09-08-m1-baseline.md`](benchmarks/2026-09-08-m1-baseline.md) — first functional, build, latency, memory, CPU, and artifact-size evidence.
- [`benchmarks/2026-09-08-m1-1-tracked-first.md`](benchmarks/2026-09-08-m1-1-tracked-first.md) — tracked-first latency, cancellation behavior, repeated memory, native workflow, and M1.1 decision.
- [`benchmarks/2026-09-09-e2-1-navigation-search.md`](benchmarks/2026-09-09-e2-1-navigation-search.md) — bounded search latency, interaction, build-size, resource, and E2.1 acceptance evidence.
- [`benchmarks/2026-09-09-e2-2a-syntax-highlighting.md`](benchmarks/2026-09-09-e2-2a-syntax-highlighting.md) — on-demand language loading, visible syntax styles, accessibility, bundle, and focused heap evidence.
- [`benchmarks/2026-09-09-e2-2b-search-refinement.md`](benchmarks/2026-09-09-e2-2b-search-refinement.md) — regex/path/context search behavior, latency, accessibility, bundle, and focused heap evidence.
- [`benchmarks/2026-09-10-e2-3-recoverable-replacement.md`](benchmarks/2026-09-10-e2-3-recoverable-replacement.md) — recoverable workspace replacement, fault safety, preview latency, accessibility, bundle, and focused heap evidence.
- [`benchmarks/2026-09-10-e3-1-workbench-preferences.md`](benchmarks/2026-09-10-e3-1-workbench-preferences.md) — project-tree controls and status colors, shared Diff highlighting, grouped preferences, browser interaction, build size, and native smoke evidence.
- [`benchmarks/2026-09-10-e3-1-desktop-shell.md`](benchmarks/2026-09-10-e3-1-desktop-shell.md) — Android Studio-aligned shell scale, tab-wheel overflow, isolated multi-project windows, desktop icon policy, build size, and native smoke evidence.
- [`benchmarks/2026-09-11-git-interaction-rendering.md`](benchmarks/2026-09-11-git-interaction-rendering.md) — Git splitter, selection-stability, detail-query, scoped-rendering, package, and residual macOS evidence.
- [`benchmarks/2026-09-11-checked-commit-workflow.md`](benchmarks/2026-09-11-checked-commit-workflow.md) — compact checked-file commit interaction, exact Git transaction safety, browser acceptance, package, and deferred operations.
- [`benchmarks/2026-09-11-ordinary-workspace-images.md`](benchmarks/2026-09-11-ordinary-workspace-images.md) — ordinary-folder authorization, static image preview and Diff, compact checkbox/tool controls, resource bounds, and local package evidence.
- [`benchmarks/2026-09-11-markdown-diff-navigation.md`](benchmarks/2026-09-11-markdown-diff-navigation.md) — frame-coalesced Markdown scrolling, bounded fenced-code highlighting, Diff navigation, expanded-context limits, and local package evidence.
- [`benchmarks/2026-09-12-remote-toolbar-markdown-memory.md`](benchmarks/2026-09-12-remote-toolbar-markdown-memory.md) — compact remote counts, complete Push review, exact-lease and atomic tag safety, Update confirmation, conflict destination, Markdown-mode persistence, and local package evidence.
- [`benchmarks/2026-09-12-navigation-alignment.md`](benchmarks/2026-09-12-navigation-alignment.md) — persistent activity-rail ordering, Changes checkbox alignment, branch hierarchy, browser interaction, and local package evidence.
- [`benchmarks/2026-09-12-r1-architecture-refactoring.md`](benchmarks/2026-09-12-r1-architecture-refactoring.md) — accepted architecture decisions, first feature-owned Git History list boundary, delegated events, validation, and package evidence.
- [`benchmarks/2026-09-12-r2a-history-details-controller.md`](benchmarks/2026-09-12-r2a-history-details-controller.md) — feature-owned History query, paging, selection, Details cache, stale-result safety, scoped rendering, and package evidence.
- [`benchmarks/2026-09-12-r2b-remote-push-controller.md`](benchmarks/2026-09-12-r2b-remote-push-controller.md) — feature-owned Remote/Push review, operation, cancellation, pushed-file Diff, stale-result safety, and interim build evidence.
- [`benchmarks/2026-09-12-r2c-changes-commit-controller.md`](benchmarks/2026-09-12-r2c-changes-commit-controller.md) — feature-owned Changes selection, commit inclusion, working Diff, mutations, stale-result safety, and interim build evidence.
- [`benchmarks/2026-09-12-r2d-files-editor-controllers.md`](benchmarks/2026-09-12-r2d-files-editor-controllers.md) — feature-owned project catalog/tree and Editor session/load/save/image lifecycles with interim build evidence.
- [`benchmarks/2026-09-12-r2e-settings-shell-controllers.md`](benchmarks/2026-09-12-r2e-settings-shell-controllers.md) — feature-owned Settings preferences and Shell layout/navigation/persistence with interim build evidence.
- [`benchmarks/2026-09-12-r2f-bounded-workbench-lists.md`](benchmarks/2026-09-12-r2f-bounded-workbench-lists.md) — feature-owned project/Changes views and bounded History, project-tree, and change-tree DOM mounting.
- [`benchmarks/2026-09-12-r2g-lazy-editor-runtime.md`](benchmarks/2026-09-12-r2g-lazy-editor-runtime.md) — lazy CodeMirror, Diff, and Markdown-preview runtimes with a startup chunk below the architecture budget.
- [`benchmarks/2026-09-12-r2h-style-ownership.md`](benchmarks/2026-09-12-r2h-style-ownership.md) — capability-owned stylesheets, enforced source limits, and browser cascade acceptance.
- [`benchmarks/2026-09-12-r2i-shell-remote-views.md`](benchmarks/2026-09-12-r2i-shell-remote-views.md) — feature-owned shell, Settings, Remote/Push presentation and disposable activity-rail bindings.
- [`benchmarks/2026-09-12-r2j-history-views.md`](benchmarks/2026-09-12-r2j-history-views.md) — feature-owned branch navigation, History filters/dialogs, and Git detail presentation.
- [`benchmarks/2026-09-12-r2k-files-editor-views.md`](benchmarks/2026-09-12-r2k-files-editor-views.md) — feature-owned Files/Search/Editor presentation and disposable CodeMirror/Markdown surfaces.
- [`benchmarks/2026-09-12-r2-frontend-capability-ownership.md`](benchmarks/2026-09-12-r2-frontend-capability-ownership.md) — final R2 ownership, lifecycle, source-budget, native, resource, and Debian acceptance evidence.
- [`benchmarks/2026-09-12-r3-application-services-protocol.md`](benchmarks/2026-09-12-r3-application-services-protocol.md) — R3 window sessions, typed reconciliation, versioned protocol, host coordinators, resource results, and Debian acceptance evidence.
- [`benchmarks/2026-09-13-push-authentication-preflight.md`](benchmarks/2026-09-13-push-authentication-preflight.md) — HTTPS token and SSH preflight, secret-handling boundary, localized recovery, validation, and macOS package evidence.
- [`benchmarks/2026-09-12-r3-1-native-workspace-watch.md`](benchmarks/2026-09-12-r3-1-native-workspace-watch.md) — R3.1 native file hints, targeted workspace/Git reconciliation, external-buffer safety, watcher footprint, and Debian acceptance evidence.
- [`benchmarks/2026-09-12-r4-0-repository-integration.md`](benchmarks/2026-09-12-r4-0-repository-integration.md) — R4.0 repository-result ownership, conflict routing, responsibility gates, resource results, and Debian acceptance evidence.
- [`benchmarks/2026-09-12-r4-recoverable-git-operations.md`](benchmarks/2026-09-12-r4-recoverable-git-operations.md) — reviewed Merge/Cherry-pick/Rebase/Squash, restart recovery, conflict resolution, fault safety, resources, and Debian acceptance evidence.

- [`benchmarks/2026-09-13-architecture-editor-reliability.md`](benchmarks/2026-09-13-architecture-editor-reliability.md) — watcher feedback-loop, retained editor activation, safe/recoverable Git worktree writes, bounded producers, CI, and macOS verification.
- [`benchmarks/2026-09-13-localization-color-themes.md`](benchmarks/2026-09-13-localization-color-themes.md) — English/Chinese and System/Dark/Light implementation, visible-copy and contrast gates, browser timing, idle stability, build size, and remaining native packaging gate.
- [`benchmarks/2026-09-14-update-project-interaction.md`](benchmarks/2026-09-14-update-project-interaction.md) — actionable Update Project strategy choice, secondary Fetch placement, blocked-action feedback, validation, bundle movement, and Debian evidence.
- [`benchmarks/2026-09-14-foreground-fetch-collapsed-tree.md`](benchmarks/2026-09-14-foreground-fetch-collapsed-tree.md) — foreground remote reconciliation, explicit current-state feedback, collapsed first-open tree, bundle movement, and Debian evidence.
- [`benchmarks/2026-09-14-action-feedback-lifecycle.md`](benchmarks/2026-09-14-action-feedback-lifecycle.md) — Update event lifecycle and policy-snapshot coherence repair, mandatory action feedback contract, interactive regression coverage, and Debian evidence.
- [`benchmarks/2026-09-14-commit-push-staged-revert.md`](benchmarks/2026-09-14-commit-push-staged-revert.md) — reviewed Commit-and-Push composition, restart-recoverable staged-addition Revert, action-placement cleanup, platform shortcut labels, and Debian evidence.
- [`benchmarks/2026-09-14-recursive-watch-refresh-chain.md`](benchmarks/2026-09-14-recursive-watch-refresh-chain.md) — macOS/Windows recursive-event filtering, same-root catalog single-flight, refresh-chain diagnosis, validation, and Debian evidence.
- [`benchmarks/2026-09-14-terminal-t1.md`](benchmarks/2026-09-14-terminal-t1.md) — supervised PTY lifecycle, lazy xterm interaction, resource probe, full validation, and Debian acceptance evidence.
- [`benchmarks/2026-09-14-versioned-workspace-reconciliation.md`](benchmarks/2026-09-14-versioned-workspace-reconciliation.md) — versioned state commits, exact watcher ownership, bounded recovery, partial Git reads, and Linux native acceptance.
- [`benchmarks/2026-09-14-editor-git-blame-gutter.md`](benchmarks/2026-09-14-editor-git-blame-gutter.md) — on-demand Git Blame in ordinary and Diff gutters, exact revision mapping, bounded output, interaction, and Debian evidence.
- [`benchmarks/2026-09-15-quick-open-input-latency.md`](benchmarks/2026-09-15-quick-open-input-latency.md) — retained Quick Open input, catalog-scoped ranking projection, bounded top-result selection, stress latency, memory, and Debian evidence.
- [`benchmarks/2026-09-15-context-action-ca0.md`](benchmarks/2026-09-15-context-action-ca0.md) — shared per-window context-menu host, Git Blame migration, interaction, output, and local acceptance evidence.
- [`benchmarks/2026-09-15-context-action-r5-cm1.md`](benchmarks/2026-09-15-context-action-r5-cm1.md) — bounded workspace mutations, system Trash/reveal adapters, editor remapping, and the complete Files context menu.
- [`benchmarks/2026-09-15-context-action-cm2.md`](benchmarks/2026-09-15-context-action-cm2.md) — Changes file context actions, independent context/Diff selection, shared reviewed Trash, interaction, and output evidence.
- [`benchmarks/2026-09-15-context-action-cm3-foundation.md`](benchmarks/2026-09-15-context-action-cm3-foundation.md) — exact-ref branch mutation and single-commit Revert review foundations for CM3.
- [`benchmarks/2026-09-15-context-action-cm3-branches.md`](benchmarks/2026-09-15-context-action-cm3-branches.md) — feature-owned Branches menus, reviewed ref-change dialog, interaction, and bundle evidence.
- [`benchmarks/2026-09-15-context-action-cm3-history.md`](benchmarks/2026-09-15-context-action-cm3-history.md) — History single-commit menus, exact-object action routing, interaction, and final CM3 evidence.
- [`benchmarks/2026-09-15-context-action-cm4-selection.md`](benchmarks/2026-09-15-context-action-cm4-selection.md) — DOM-independent History range selection, virtual-list projection, limits, and interaction evidence.
- [`benchmarks/2026-09-19-context-action-cm4-multi-revert.md`](benchmarks/2026-09-19-context-action-cm4-multi-revert.md) — ordered multi-commit Revert plans, Git-owned restart progress, conflict Skip, and native acceptance evidence.
- [`benchmarks/2026-09-19-context-action-cm4-range-actions.md`](benchmarks/2026-09-19-context-action-cm4-range-actions.md) — H2 range target, topology policy, copy/Cherry-pick/Revert/Squash routing, and interaction evidence.
- [`benchmarks/2026-09-19-context-action-cm4-comparison-foundation.md`](benchmarks/2026-09-19-context-action-cm4-comparison-foundation.md) — exact two-commit file ranges, bounded text/image reads, protocol validation, and native foundation evidence.
- [`benchmarks/2026-09-19-context-action-cm4-comparison.md`](benchmarks/2026-09-19-context-action-cm4-comparison.md) — H2 comparison routing, ancestry orientation, side swapping, multi-file read-only Diff presentation, interaction, and bundle evidence.
