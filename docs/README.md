# Documentation map

The documents in this directory are the current source of truth. A decision that changes architecture, product behavior, compatibility, quality gates, or milestone scope must update the relevant page in the same change.

## Product

- [`product/vision.md`](product/vision.md) — product identity, users, principles, and non-goals.
- [`product/roadmap.md`](product/roadmap.md) — audited 3–5 year, seven-stage roadmap.

## Architecture

- [`architecture/overview.md`](architecture/overview.md) — boundaries, dependency direction, runtime model, and evolution seams.
- [`architecture/keyboard-shortcut-coverage.md`](architecture/keyboard-shortcut-coverage.md) — durable per-surface user-action inventory, shortcut classification, coverage gaps, and feature completion rules.
- [`architecture/decisions/0001-foundation.md`](architecture/decisions/0001-foundation.md) — first architecture decision record.
- [`architecture/decisions/0002-tracked-first-refresh.md`](architecture/decisions/0002-tracked-first-refresh.md) — cancellable two-phase repository refresh contract.
- [`architecture/decisions/0003-persistent-workbench.md`](architecture/decisions/0003-persistent-workbench.md) — persistent editor, orthogonal tool windows, and resizable layout state.
- [`architecture/decisions/0004-safe-text-editing.md`](architecture/decisions/0004-safe-text-editing.md) — authorized text-file access, optimistic save, and editor-session ownership.
- [`architecture/decisions/0005-bounded-navigation-search.md`](architecture/decisions/0005-bounded-navigation-search.md) — keyboard-first navigation, bounded cancellable text search, and safe replacement scope.
- [`architecture/decisions/0006-language-adapter-evolution.md`](architecture/decisions/0006-language-adapter-evolution.md) — syntax adapters now, optional Tree-sitter language packs later, and deferred semantic intelligence.
- [`architecture/decisions/0007-workbench-feature-ownership.md`](architecture/decisions/0007-workbench-feature-ownership.md) — feature-owned workbench state, stable DOM hosts, and scoped rendering.
- [`architecture/decisions/0008-recoverable-git-operations.md`](architecture/decisions/0008-recoverable-git-operations.md) — reviewed, resumable, and conflict-aware Git operation lifecycle.
- [`architecture/decisions/0009-hinted-workspace-reconciliation.md`](architecture/decisions/0009-hinted-workspace-reconciliation.md) — native watcher hints, typed slice invalidation, authoritative reconciliation, and fallback policy.
- [`architecture/decisions/0010-read-only-ignored-previews.md`](architecture/decisions/0010-read-only-ignored-previews.md) — historical bounded ignored-file preview and watcher-containment decision, superseded in its read-only restriction by ADR-0017.
- [`architecture/decisions/0011-supervised-terminal-sessions.md`](architecture/decisions/0011-supervised-terminal-sessions.md) — lazy, window-scoped PTY sessions with explicit lifecycle and resource bounds.
- [`architecture/decisions/0012-versioned-workspace-reconciliation.md`](architecture/decisions/0012-versioned-workspace-reconciliation.md) — linearized repository commits, exact watcher ownership, bounded recovery, and capability transitions.
- [`architecture/decisions/0013-feature-owned-context-actions.md`](architecture/decisions/0013-feature-owned-context-actions.md) — feature-owned context actions presented through one business-neutral window menu host.
- [`architecture/decisions/0014-slice-stable-projection-refresh.md`](architecture/decisions/0014-slice-stable-projection-refresh.md) — canonical refresh with semantic slice diffs, stable feature identity, and single-pass foreground recovery.
- [`architecture/decisions/0015-editable-diff-and-conflict-editor.md`](architecture/decisions/0015-editable-diff-and-conflict-editor.md) — one-buffer editable working Diff, center-gutter reverts, and in-editor three-pane conflict resolution.
- [`architecture/decisions/0016-temporal-presentation-and-editor-change-indicators.md`](architecture/decisions/0016-temporal-presentation-and-editor-change-indicators.md) — one localized time policy plus repository-derived, shared editor change indicators.
- [`architecture/decisions/0017-editable-ignored-files.md`](architecture/decisions/0017-editable-ignored-files.md) — explicit ignored identity with individually authorized editing, saving, and Files mutations.
- [`architecture/decisions/0018-command-and-keybinding-system.md`](architecture/decisions/0018-command-and-keybinding-system.md) — stable command discovery, scoped customizable keybindings, bounded persistence, and editor/terminal arbitration.
- [`architecture/decisions/0019-plugin-contribution-kernel.md`](architecture/decisions/0019-plugin-contribution-kernel.md) — bundled plugin contributions, workspace trust, task authority, and the deferred external plugin ABI.
- [`architecture/decisions/0020-managed-bundled-plugins-and-task-snapshot-cache.md`](architecture/decisions/0020-managed-bundled-plugins-and-task-snapshot-cache.md) — host-managed bundled plugins, typed Settings navigation, and verified persistent task snapshots.
- [`architecture/decisions/0021-first-party-plugin-sdk-and-repository-boundary.md`](architecture/decisions/0021-first-party-plugin-sdk-and-repository-boundary.md) — versioned first-party SDK, build-time binding, independent plugin repository, and no runtime third-party loading.
- [`architecture/decisions/0022-host-owned-hierarchical-collection-presentation.md`](architecture/decisions/0022-host-owned-hierarchical-collection-presentation.md) — one host-owned tree/flat, disclosure, filtering, focus, keyboard, and plugin collection presentation model.
- [`architecture/decisions/0023-host-governed-public-plugin-foundation.md`](architecture/decisions/0023-host-governed-public-plugin-foundation.md) — canonical plugin package identity, plugin-owned localization, host-managed lifecycle, admission, compatibility, and future external-plugin security gates.
- [`architecture/decisions/0024-host-presentation-contract-and-plugin-contract-governance.md`](architecture/decisions/0024-host-presentation-contract-and-plugin-contract-governance.md) — semantic host UI primitives, plugin presentation boundary, and independently versioned contract governance.
- [`architecture/decisions/0025-plugin-scoped-task-authorization.md`](architecture/decisions/0025-plugin-scoped-task-authorization.md) — plugin-owned task authorization declarations, native workspace trust, exact remembered reviews, and fail-closed revocation.
- [`architecture/decisions/0026-task-activation-and-terminal-routing.md`](architecture/decisions/0026-task-activation-and-terminal-routing.md) — selection-first task activation, exact native execution, and host-owned Terminal session projection.
- [`architecture/decisions/0027-host-notification-center-and-plugin-notifications.md`](architecture/decisions/0027-host-notification-center-and-plugin-notifications.md) — bounded host notification lifecycle, plugin localization-key capability, and authoritative task-failure feedback.
- [`architecture/decisions/0028-workspace-matched-plugin-surfaces.md`](architecture/decisions/0028-workspace-matched-plugin-surfaces.md) — bounded plugin workspace matching and host-owned contribution-backed activity visibility.
- [`architecture/decisions/0029-supervised-terminal-workspace.md`](architecture/decisions/0029-supervised-terminal-workspace.md) — bounded multi-PTY ownership, host Terminal tabs, independent task histories, and complete lifecycle cleanup.
- [`architecture/decisions/0030-plugin-run-targets-and-android-workbench.md`](architecture/decisions/0030-plugin-run-targets-and-android-workbench.md) — generic plugin run/target/session contracts, bounded external-tool queries, and the host-rendered Android workbench.
- [`architecture/decisions/0031-supervised-staged-plugin-run-sessions.md`](architecture/decisions/0031-supervised-staged-plugin-run-sessions.md) — staged plugin Run sessions, authoritative final-artifact identity, and typed declared tool operations.
- [`architecture/decisions/0032-decentralized-github-release-plugin-marketplace.md`](architecture/decisions/0032-decentralized-github-release-plugin-marketplace.md) — direct GitHub Release plugin sources, static admission, immutable installation, isolated activation, restart recovery, and rollback.
- [`architecture/decisions/0033-structured-local-diagnostics.md`](architecture/decisions/0033-structured-local-diagnostics.md) — one bounded local JSONL timeline across the webview, native host, capabilities, and isolated plugin lifecycle.
- [`architecture/decisions/0034-plugin-language-services.md`](architecture/decisions/0034-plugin-language-services.md) — language-provider plugins, real document versions, supervised LSP sessions and execution authority.

## Plugin development

- [`plugins/developer-guide.md`](plugins/developer-guide.md) — standalone template, manifest/runtime ownership, Release publication, source addition, lifecycle, and security boundary.
- [`plugins/capabilities-and-permissions.md`](plugins/capabilities-and-permissions.md) — complete admitted authority catalog, operation mapping, resource limits, and failure behavior.
- [`plugins/diagnostics-and-migration.md`](plugins/diagnostics-and-migration.md) — failure-phase diagnostics, compatibility axes, persisted-data migration, rollback, quarantine, and deprecation policy.
- [`../templates/plugin-typescript`](../templates/plugin-typescript) — executable isolated TypeScript plugin repository template and pinned Release workflow.

## Delivery

- [`engineering/2026-10-26-language-definition-navigation-plan.md`](engineering/2026-10-26-language-definition-navigation-plan.md) — Ctrl/Command-click definition navigation, target identity, feedback and real gesture acceptance.
- [`engineering/2026-10-26-language-reference-navigation-plan.md`](engineering/2026-10-26-language-reference-navigation-plan.md) — declaration-to-usages behavior, explicit reference lookup and searchable multi-target selection.
- [`engineering/2026-10-26-language-approval-session-fix.md`](engineering/2026-10-26-language-approval-session-fix.md) — correct project-scoped consent lifetime, idle retention and repeated-dialog regression.
- [`engineering/2026-10-26-android-language-services-plan.md`](engineering/2026-10-26-android-language-services-plan.md) — planned Android/JVM LSP candidates, separate JDKs, Gradle/variant models, mixed-language overlays, dependency sources and staged Kotlin/Java/Groovy/DSL acceptance.
- [`engineering/2026-10-26-rust-language-services-plan.md`](engineering/2026-10-26-rust-language-services-plan.md) — implemented Rust workspace profile and dual-language sessions, trusted Cargo analysis, remaining read-only dependency sources and staged acceptance.
- [`engineering/2026-10-26-language-services-host-plan.md`](engineering/2026-10-26-language-services-host-plan.md) — parallel host/plugin implementation stages, frozen TS/JS contract and integration acceptance gates.

- [`milestones/m1-git-gui-first.md`](milestones/m1-git-gui-first.md) — first vertical slice and acceptance gates.
- [`engineering/quality-gates.md`](engineering/quality-gates.md) — durable quality, performance, compatibility, and release rules.
- [`engineering/architecture-refactoring.md`](engineering/architecture-refactoring.md) — current architecture audit, target boundaries, migration order, and refactoring gates.
- [`engineering/task-terminal-routing-plan.md`](engineering/task-terminal-routing-plan.md) — staged implementation and acceptance gates for double-click task activation and reviewed output in the host Terminal.
- [`engineering/host-notification-and-plugin-feedback-plan.md`](engineering/host-notification-and-plugin-feedback-plan.md) — staged host notification extraction, optional plugin contract, task-result feedback, and local acceptance plan.
- [`engineering/workspace-matched-plugin-surfaces-plan.md`](engineering/workspace-matched-plugin-surfaces-plan.md) — staged root-wrapper Gradle matching, provider-derived Tasks visibility, lifecycle tests, and local acceptance.
- [`engineering/multi-session-terminal-plan.md`](engineering/multi-session-terminal-plan.md) — native multi-session kernel, host tab workspace, Shell/task tabs, resource gates, and local acceptance.
- [`engineering/android-workbench-and-device-discovery-plan.md`](engineering/android-workbench-and-device-discovery-plan.md) — phased SDK, bounded ADB discovery, Android workbench, run configuration, build/install/launch, and acceptance plan.
- [`engineering/android-application-run-plan.md`](engineering/android-application-run-plan.md) — staged implementation and acceptance gates for reviewed Gradle install, final-APK identity, exact ADB launch, and retained Run history.
- [`engineering/empty-workspace-startup-plan.md`](engineering/empty-workspace-startup-plan.md) — first-launch cancellation, disabled project tools, and the actionable Welcome state.
- [`engineering/foundation-hardening.md`](engineering/foundation-hardening.md) — post-CM4 feature freeze, executable boundary plan, migration sequence, and acceptance gates.
- [`engineering/2026-09-29-audit-remediation-plan.md`](engineering/2026-09-29-audit-remediation-plan.md) — ordered credential, workspace-recovery, terminal-flow-control, lifecycle, and ownership hardening plan.
- [`benchmarks/2026-09-29-architecture-audit-remediation.md`](benchmarks/2026-09-29-architecture-audit-remediation.md) — AR1–AR5 implementation, fault evidence, full local validation, performance bounds, and remaining release limits.
- [`benchmarks/2026-09-29-keyboard-shortcut-management.md`](benchmarks/2026-09-29-keyboard-shortcut-management.md) — command/keybinding implementation, stress budgets, lifecycle evidence, and local package acceptance.
- [`benchmarks/2026-09-30-android-studio-keymap-defaults.md`](benchmarks/2026-09-30-android-studio-keymap-defaults.md) — verified macOS Android Studio keymap compatibility defaults, safety omissions, conflict isolation, and performance evidence.
- [`engineering/versioned-reconciliation-plan.md`](engineering/versioned-reconciliation-plan.md) — watcher/reconciliation risks, phased implementation, invariants, and acceptance matrix.
- [`engineering/context-action-system.md`](engineering/context-action-system.md) — whole-draft audit, context-action architecture, R5 prerequisites, surface ownership, and delivery sequence.
- [`engineering/intraline-diff-highlighting-plan.md`](engineering/intraline-diff-highlighting-plan.md) — Android Studio-style line and inline Diff semantics across editable and read-only implementations.
- [`engineering/conflict-resolution-actions-plan.md`](engineering/conflict-resolution-actions-plan.md) — independent Apply/Ignore conflict actions and deterministic two-sided Result composition.
- [`engineering/conflict-marker-authority-and-tab-lifecycle-fix-plan.md`](engineering/conflict-marker-authority-and-tab-lifecycle-fix-plan.md) — authoritative worktree marker conflicts, safe Save and Stage gating, and conflict-tab lifecycle cleanup.
- [`engineering/editable-diff-conflict-git-blame-plan.md`](engineering/editable-diff-conflict-git-blame-plan.md) — on-demand, exact-source Git Blame for editable two-pane Diff and three-pane conflict resolution.
- [`engineering/compact-git-blame-presentation-plan.md`](engineering/compact-git-blame-presentation-plan.md) — independent selected-line authorship, optional gutter, exact-commit navigation, and historical compact-mode design.
- [`engineering/conflict-editor-large-file-performance-plan.md`](engineering/conflict-editor-large-file-performance-plan.md) — single-pass structural conflict analysis that keeps large three-pane conflicts and Changes context menus responsive.
- [`engineering/conflict-editor-fill-height-fix-plan.md`](engineering/conflict-editor-fill-height-fix-plan.md) — full-height short-file editor/gutter layout and real Chromium/WebKit regression evidence.
- [`engineering/hybrid-workspace-content-index-plan.md`](engineering/hybrid-workspace-content-index-plan.md) — verification-first trigram acceleration with complete cold fallback, strict cache bounds, and stale-index recovery.
- [`engineering/system-file-clipboard-plan.md`](engineering/system-file-clipboard-plan.md) — native Files-tree copy/paste interoperability with Finder and Explorer, bounded atomic imports, and text-editor shortcut isolation.
- [`engineering/remote-push-error-diagnostics-plan.md`](engineering/remote-push-error-diagnostics-plan.md) — structured Git Push rejection causes, safe actionable guidance, and tag-collision regression gates.
- [`engineering/remote-tag-refresh-and-push-feedback-plan.md`](engineering/remote-tag-refresh-and-push-feedback-plan.md) — complete remote Tag synchronization plus prominent single-Tag and commit Push success feedback.
- [`engineering/editor-patch-popover-plan.md`](engineering/editor-patch-popover-plan.md) — clickable editor gutter Patches, bounded previous/next navigation, and reversible per-block rollback.
- [`engineering/unified-diff-review-workflow-plan.md`](engineering/unified-diff-review-workflow-plan.md) — shared review blocks, controls, layout, folding, geometry, and workflow for two-pane Diff and three-pane conflict resolution.
- [`engineering/unified-diff-review-acceptance.md`](engineering/unified-diff-review-acceptance.md) — phased automated and manual acceptance evidence for the unified Diff review workflow.
- [`engineering/dialog-window-geometry-plan.md`](engineering/dialog-window-geometry-plan.md) — shared movement, resizing, persistence, and confirmation behavior for application-owned dialogs.
- [`engineering/plugin-task-authorization-plan.md`](engineering/plugin-task-authorization-plan.md) — staged SDK, native authorization, plugin Settings, remembered task review, and local-delivery plan.
- [`engineering/stash-tool-window-plan.md`](engineering/stash-tool-window-plan.md) — bottom two-column Stash manager, exact-object mutations, context actions, and read-only Diff delivery plan.
- [`engineering/git-worktree-actions-plan.md`](engineering/git-worktree-actions-plan.md) — primary/linked/available branch checkout identity, reviewed removal, Android Studio-style creation, primary-window Open/Reveal actions, and acceptance gates.
- [`engineering/keyboard-shortcut-management-plan.md`](engineering/keyboard-shortcut-management-plan.md) — unified command registry, customizable keybindings, conflict handling, Settings management, and editor/terminal integration plan.
- [`engineering/local-build.md`](engineering/local-build.md) — reproducible frontend, Rust, native Linux, and packaging setup.
- [`benchmarks/2026-10-23-macos-icon-launch-recovery.md`](benchmarks/2026-10-23-macos-icon-launch-recovery.md) — saved-icon bookmark diagnosis, archive-only backup migration, atomic Contents replacement and quit/reopen acceptance.
- [`engineering/structured-diagnostics.md`](engineering/structured-diagnostics.md) — log location, event contract, privacy rules, plugin-task diagnosis, and validation gates.
- [`engineering/2026-10-23-diagnostics-hardening-plan.md`](engineering/2026-10-23-diagnostics-hardening-plan.md) — ordered privacy, recoverable asynchronous persistence, lifecycle integrity, frontend coverage, and native acceptance hardening.
- [`benchmarks/2026-10-23-diagnostics-hardening.md`](benchmarks/2026-10-23-diagnostics-hardening.md) — fault/concurrency tests, bounded burst evidence, signed package hashes and installed-log acceptance.
- [`engineering/ci.md`](engineering/ci.md) — least-privilege cross-platform preview builds, zero-cost Release publication, and artifact trust boundary.
- [`engineering/in-app-update-plan.md`](engineering/in-app-update-plan.md) — startup/manual update discovery, verified native package installation, restart behavior, and updater trust boundaries.
- [`engineering/plugin-system-plan.md`](engineering/plugin-system-plan.md) — phased bundled-plugin kernel, Tasks tool, supervised execution, Android/Gradle workflow, and external-host gate.
- [`engineering/plugin-management-and-task-cache-plan.md`](engineering/plugin-management-and-task-cache-plan.md) — phased plugin management, Android task-tree modes, tool Settings entry, verified task cache, and FilesRecovery acceptance.
- [`engineering/plugin-sdk-and-repository-rollout-plan.md`](engineering/plugin-sdk-and-repository-rollout-plan.md) — staged SDK extraction, minimal HierarchicalCollection/Tasks contract, repository split, artifact consumption, and remaining-tree migration.
- [`engineering/hierarchical-collection-and-android-tasks-plan.md`](engineering/hierarchical-collection-and-android-tasks-plan.md) — phased shared tree abstraction, plugin collection wiring, Android/Gradle rollout, and FilesRecovery acceptance.
- [`engineering/public-plugin-foundation-plan.md`](engineering/public-plugin-foundation-plan.md) — staged SDK, host, and Android/Gradle migration for self-contained localization, package identity guards, acceptance, and the deferred public-plugin lifecycle.
- [`engineering/github-release-plugin-marketplace-plan.md`](engineering/github-release-plugin-marketplace-plan.md) — phased GitHub source catalog, Release discovery, safe package admission, isolated plugin host, Settings marketplace, restart, update, and rollback delivery.
- [`engineering/external-plugin-runtime-plan.md`](engineering/external-plugin-runtime-plan.md) — MKT5 protocol framing, non-Node JavaScript isolation, process supervision, transactional contributions, and Android Release parity gates.
- [`engineering/plugin-crash-containment-hardening-plan.md`](engineering/plugin-crash-containment-hardening-plan.md) — host-owned semantic tool authority, trusted executable provenance, immutable package-content binding, explicit enablement, proactive crash recovery, resource enforcement, and packaged hostile-plugin evidence.
- [`engineering/plugin-release-package-contract.md`](engineering/plugin-release-package-contract.md) — schema-3 Release archive, semantic host-operation, runtime, compatibility, license, permission, and integrity requirements.
- [`engineering/host-presentation-system-plan.md`](engineering/host-presentation-system-plan.md) — phased shared presentation primitives, Tasks state and execution-dialog migration, plugin UI boundary, and local acceptance.
- [`engineering/unpushed-head-commit-actions-plan.md`](engineering/unpushed-head-commit-actions-plan.md) — reviewed Undo/Drop actions for an unpublished latest commit, with exact native revalidation and no changelist-context emulation.
- [`engineering/non-current-branch-sync-plan.md`](engineering/non-current-branch-sync-plan.md) — per-local-branch upstream divergence plus reviewed Update and Push without checking out the target branch.
- [`governance/lifecycle.md`](governance/lifecycle.md) — how a multi-year codebase changes without fossilizing early choices.
- [`governance/plugin-contracts.md`](governance/plugin-contracts.md) — central plugin contract registry, version axes, stability lifecycle, compatibility rules, and review checklist.

## Design and references

- [`design/rebased-reference.md`](design/rebased-reference.md) — what may be learned from Rebased and what must remain original.
- [`design/context-menu-drafts.md`](design/context-menu-drafts.md) — reviewed per-surface context-menu behavior inputs for Editor/Diff Git Blame, Files, Changes, Branches, History, and commit details.
- [`design/interaction-feedback.md`](design/interaction-feedback.md) — mandatory visible feedback and stable event-lifecycle rules for every user-invoked action.
- [`design/daily-driver-interactions.md`](design/daily-driver-interactions.md) — usability audit and ordered interaction/feature slices.
- [`design/editor-core-interactions.md`](design/editor-core-interactions.md) — Stage 3 editor slices, invariants, and acceptance evidence.
- [`design/terminal-interactions.md`](design/terminal-interactions.md) — integrated-terminal phases, interaction contract, dependency review, and T1 acceptance gates.
- [`design/localization-color-themes.md`](design/localization-color-themes.md) — implementation plan for English/Chinese localization and System/Dark/Light appearance.

## Benchmarks

- [`benchmarks/2026-10-16-workspace-matched-plugin-surfaces.md`](benchmarks/2026-10-16-workspace-matched-plugin-surfaces.md) — plugin-owned root-wrapper matching, contribution-backed Tasks visibility, cross-repository artifact identity, and recoverable local installation.
- [`benchmarks/2026-10-21-plugin-authority-and-content-binding.md`](benchmarks/2026-10-21-plugin-authority-and-content-binding.md) — fail-closed external process authority, exact Android compatibility mapping, canonical extracted-content binding, migration behavior, and local validation evidence.
- [`benchmarks/2026-10-15-host-notification-and-plugin-feedback.md`](benchmarks/2026-10-15-host-notification-and-plugin-feedback.md) — bounded host tips, optional localized plugin notifications, terminal task-failure feedback, FilesRecovery evidence, and recoverable local installation.
- [`benchmarks/2026-10-15-task-terminal-routing.md`](benchmarks/2026-10-15-task-terminal-routing.md) — selection-first task activation, native reviewed execution in the host Terminal, FilesRecovery evidence, resource gates, and recoverable local installation.
- [`benchmarks/2026-10-15-plugin-task-authorization.md`](benchmarks/2026-10-15-plugin-task-authorization.md) — plugin-scoped durable workspace trust, exact remembered Gradle task reviews, revocation, bounds, and recoverable local installation.
- [`benchmarks/2026-10-15-host-presentation-system.md`](benchmarks/2026-10-15-host-presentation-system.md) — governed semantic host UI primitives, Tasks and execution-dialog adoption, resource bounds, and recoverable local installation.
- [`benchmarks/2026-10-15-hierarchical-collection-android-tasks.md`](benchmarks/2026-10-15-hierarchical-collection-android-tasks.md) — host-owned tree/flat presentation, Android plugin semantic collections, FilesRecovery evidence, and recoverable local installation.
- [`benchmarks/2026-10-15-filesrecovery-plugin-task-cache.md`](benchmarks/2026-10-15-filesrecovery-plugin-task-cache.md) — managed bundled plugins, Android task-tree modes, verified persistent snapshots, and real FilesRecovery performance/package evidence.
- [`benchmarks/2026-10-15-public-plugin-foundation.md`](benchmarks/2026-10-15-public-plugin-foundation.md) — plugin-owned localization, canonical package identity, host admission/management rules, FilesRecovery regression, and local package evidence.
- [`benchmarks/2026-10-16-android-workbench-device-discovery.md`](benchmarks/2026-10-16-android-workbench-device-discovery.md) — bounded host ADB discovery, plugin-owned execution targets, Android Run/Tasks/Devices workbench, FilesRecovery device evidence, and macOS package acceptance.
- [`benchmarks/2026-10-13-hybrid-workspace-content-index.md`](benchmarks/2026-10-13-hybrid-workspace-content-index.md) — complete authorized-catalog cold search, source-free trigram acceleration, stale-entry recovery, and Flutter latency/memory evidence.
- [`benchmarks/2026-10-13-workspace-search-extension-coverage.md`](benchmarks/2026-10-13-workspace-search-extension-coverage.md) — post-filter candidate limits and extension-balanced coverage that keep Kotlin and other uncommon source formats searchable in large repositories.
- [`benchmarks/2026-10-12-in-app-update.md`](benchmarks/2026-10-12-in-app-update.md) — shared startup/Settings update state, verified native package installation, resource bounds, and cross-platform acceptance evidence.
- [`benchmarks/2026-10-12-editor-patch-popover.md`](benchmarks/2026-10-12-editor-patch-popover.md) — exact per-block editor Patch comparison, previous/next navigation, reversible rollback, and Chromium/WebKit evidence.
- [`benchmarks/2026-10-12-remote-push-error-diagnostics.md`](benchmarks/2026-10-12-remote-push-error-diagnostics.md) — structured Push rejection parsing, actionable tag-collision recovery, security boundaries, and regression evidence.
- [`benchmarks/2026-10-09-windows-repository-identity.md`](benchmarks/2026-10-09-windows-repository-identity.md) — canonical Windows workspace/Git identity compatibility and strict-session regression evidence.
- [`benchmarks/2026-10-10-pending-worktree-scan-recovery.md`](benchmarks/2026-10-10-pending-worktree-scan-recovery.md) — automatic recovery for cancelled pending untracked scans and same-activation Update acceptance.
- [`benchmarks/2026-09-28-changes-composer-minimum.md`](benchmarks/2026-09-28-changes-composer-minimum.md) — Changes minimum-height composer protection that keeps validation copy fully visible while the text area absorbs splitter compression.
- [`benchmarks/2026-09-28-tag-context-actions.md`](benchmarks/2026-09-28-tag-context-actions.md) — Tag-row detached checkout, reviewed Merge routing, exact single-Tag push, local/remote deletion, and state-preserving incremental refresh evidence.
- [`benchmarks/2026-09-23-lazy-ignored-project-catalog.md`](benchmarks/2026-09-23-lazy-ignored-project-catalog.md) — fast first Files projection with collapsed ignored roots, one-level lazy expansion, session authorization, and FilesRecovery latency evidence.
- [`benchmarks/2026-09-23-files-multiselect-trash-and-editable-ignored.md`](benchmarks/2026-09-23-files-multiselect-trash-and-editable-ignored.md) — Files multi-selection, one reviewed batch Trash operation, identity-based Trash planning, editable ignored entries, and acceptance evidence.
- [`benchmarks/2026-09-21-compact-file-trees-and-diff-fills.md`](benchmarks/2026-09-21-compact-file-trees-and-diff-fills.md) — shared compact file-tree projection, full-line MergeView fills, restored Unversioned Trash review host, and acceptance evidence.
- [`benchmarks/2026-09-21-project-root-header.md`](benchmarks/2026-09-21-project-root-header.md) — Files header identity without a workspace tally, workspace-root context target with protection rules, native root reveal, and package evidence.
- [`benchmarks/2026-09-21-search-controls-and-lazy-history-paths.md`](benchmarks/2026-09-21-search-controls-and-lazy-history-paths.md) — single-border Branch search, clearable History filters, lazy path projection, ignored-file policy, shared editor/workspace search controls, and acceptance evidence.
- [`benchmarks/2026-09-20-context-menu-consolidation.md`](benchmarks/2026-09-20-context-menu-consolidation.md) — bounded/grouped branch launcher, metadata-only branch inspector, Remote form correction, exact-set Unversioned group actions, browser interaction, and native Git evidence.
- [`benchmarks/2026-09-20-editable-diff-conflict-editor.md`](benchmarks/2026-09-20-editable-diff-conflict-editor.md) — editable worktree Diff, conflict grouping, three-pane resolution, lazy merge-runtime, browser interaction, build, and native Git evidence.
- [`benchmarks/2026-09-20-time-and-editor-change-indicators.md`](benchmarks/2026-09-20-time-and-editor-change-indicators.md) — unified temporal formatting, repository-derived editor markers, overview navigation, browser interaction, and resource evidence.
- [`benchmarks/2026-09-19-foundation-hardening.md`](benchmarks/2026-09-19-foundation-hardening.md) — final FH0–FH7 architecture, source/artifact movement, validation, latency, resource, browser, and platform-limit evidence.
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
- [`benchmarks/2026-09-19-context-action-cm4-history-start.md`](benchmarks/2026-09-19-context-action-cm4-history-start.md) — root-qualified exact-commit History query foundation for H3/H4 “up to here” actions.
- [`benchmarks/2026-09-19-context-action-cm4-commit-folders.md`](benchmarks/2026-09-19-context-action-cm4-commit-folders.md) — H3 immutable folder targets, bounded range Diff, Files reveal, exact-start History, path copy, and interaction evidence.
- [`benchmarks/2026-09-19-context-action-cm4-file-version-foundation.md`](benchmarks/2026-09-19-context-action-cm4-file-version-foundation.md) — exact commit-file identity, blob/mode resolution, bounded native text/image preview, and protocol evidence for H4.
- [`benchmarks/2026-09-19-context-action-cm4-file-inspection.md`](benchmarks/2026-09-19-context-action-cm4-file-inspection.md) — read-only historical editor documents and revision/unsaved-buffer-bound comparison evidence for H4.
- [`benchmarks/2026-09-19-context-action-cm4-file-restore.md`](benchmarks/2026-09-19-context-action-cm4-file-restore.md) — complete H4 commit-file menu, exact reviewed working-tree restore, restart recovery, interaction, resource, and final CM4 evidence.
- [`benchmarks/2026-09-19-foundation-hardening-fh2.md`](benchmarks/2026-09-19-foundation-hardening-fh2.md) — native/demo startup separation, enforced application-chunk budget, browser acceptance, and honest static-chunk accounting.
- [`benchmarks/2026-10-19-plugin-marketplace-admission.md`](benchmarks/2026-10-19-plugin-marketplace-admission.md) — GitHub Release download binding, schema-2 package admission, immutable storage, and pending-runtime evidence.
- [`benchmarks/2026-10-19-android-plugin-marketplace-release.md`](benchmarks/2026-10-19-android-plugin-marketplace-release.md) — first-party Android plugin GitHub Release workflow, online digest/package inspection, Marketplace MKT4 acceptance, and the explicit pending-runtime boundary.
- [`benchmarks/2026-10-19-public-plugin-marketplace-acceptance.md`](benchmarks/2026-10-19-public-plugin-marketplace-acceptance.md) — independent Hello and Android GitHub Releases, production discovery/download/admission, pinned inspector/runtime parity, and remaining installed-app MKT8D gates.

- [`benchmarks/2026-10-26-rust-language-services.md`](benchmarks/2026-10-26-rust-language-services.md) — real Rust workspace navigation, mixed-profile/diagnostic acceptance, cold/warm metrics and signed local installation.
- [`benchmarks/2026-10-26-language-services.md`](benchmarks/2026-10-26-language-services.md) — TS/JS host/plugin automated, resource and native-install acceptance evidence.

- [`benchmarks/2026-10-26-language-services-activation-fix.md`](benchmarks/2026-10-26-language-services-activation-fix.md) — desktop validation regression, immutable quarantine repair and actual-project LSP acceptance.
- [`benchmarks/2026-10-26-language-definition-navigation.md`](benchmarks/2026-10-26-language-definition-navigation.md) — real Ctrl/Command gestures, safe cross-file selection, actual workspace definitions and native delivery.
- [`benchmarks/2026-10-26-language-reference-navigation.md`](benchmarks/2026-10-26-language-reference-navigation.md) — declaration/usages navigation, searchable choices, actual references and native delivery.
- [`benchmarks/2026-10-26-language-approval-session.md`](benchmarks/2026-10-26-language-approval-session.md) — repeated-dialog root cause, session consent lifetime, revocation and local delivery evidence.

- [`benchmarks/2026-10-26-android-jvm-a0.md`](benchmarks/2026-10-26-android-jvm-a0.md) — Android/JVM real-server probes, pinned distributions, failed semantic gates and transport/model prerequisites.
- [`benchmarks/2026-10-26-jvm-transport-foundation.md`](benchmarks/2026-10-26-jvm-transport-foundation.md) — bounded import-status coalescing, ordered startup buffering and real TS/Rust regressions.

- [`architecture/decisions/0035-plugin-dependencies-and-build-models.md`](architecture/decisions/0035-plugin-dependencies-and-build-models.md) — generic required-plugin lifecycle and plugin-owned Android/LSP model cooperation.
- [`engineering/2026-10-27-plugin-build-model-cooperation-plan.md`](engineering/2026-10-27-plugin-build-model-cooperation-plan.md) — documentation-first stages, LSP→Android enablement lock, bounded model services and actual-language gates.

- [`benchmarks/2026-10-27-plugin-dependencies-c1.md`](benchmarks/2026-10-27-plugin-dependencies-c1.md) — required dependency transactions, LSP→Android enablement lock and C1 regression evidence.

- [`benchmarks/2026-10-27-plugin-model-kernel.md`](benchmarks/2026-10-27-plugin-model-kernel.md) — C2a bounded job/reference kernel and first real plugin-owned AGP model evidence.

- [`benchmarks/2026-10-27-plugin-cooperation-delivery.md`](benchmarks/2026-10-27-plugin-cooperation-delivery.md) — staged C1/C2a/C3a commits, final signed installation, exact-plugin health checkpoint and remaining Android LSP gates.

- [`architecture/decisions/0036-packaged-analysis-programs.md`](architecture/decisions/0036-packaged-analysis-programs.md) — fixed-entry plugin programs, scoped model artifacts and lightweight generic host supervision.
