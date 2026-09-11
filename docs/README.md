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

## Delivery

- [`milestones/m1-git-gui-first.md`](milestones/m1-git-gui-first.md) — first vertical slice and acceptance gates.
- [`engineering/quality-gates.md`](engineering/quality-gates.md) — durable quality, performance, compatibility, and release rules.
- [`engineering/local-build.md`](engineering/local-build.md) — reproducible frontend, Rust, native Linux, and packaging setup.
- [`engineering/ci.md`](engineering/ci.md) — least-privilege cross-platform preview builds and artifact trust boundary.
- [`governance/lifecycle.md`](governance/lifecycle.md) — how a multi-year codebase changes without fossilizing early choices.

## Design and references

- [`design/rebased-reference.md`](design/rebased-reference.md) — what may be learned from Rebased and what must remain original.
- [`design/daily-driver-interactions.md`](design/daily-driver-interactions.md) — usability audit and ordered interaction/feature slices.
- [`design/editor-core-interactions.md`](design/editor-core-interactions.md) — Stage 3 editor slices, invariants, and acceptance evidence.

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
