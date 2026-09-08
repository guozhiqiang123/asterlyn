# Three-to-five-year product roadmap

## Audit conclusion

Seven stages are appropriate for a 3–5 year effort, but only if they are treated as **stage gates with overlap**, not seven serial projects. A purely serial plan would postpone feedback on editing and language intelligence for too long, while prematurely building plugins or AI would freeze weak internal contracts.

The roadmap therefore has seven product stages and eight continuous engineering tracks. Dates are planning ranges, not promises. Evidence at each gate decides whether to expand, revise, or stop.

## Stage 1 — Git GUI First and enduring foundation (months 0–4)

Deliver one complete vertical slice: repository discovery, branch/status model, changes, patch viewing, history, stage/unstage, and commit. Establish the Rust domain boundary, Tauri adapter, UI state flow, design tokens, test fixtures, performance harness, and release packaging shape.

**Exit gate:** the product safely completes the everyday local commit loop on all three target platforms; repository parsing is fixture-tested; mutating actions are explicit; initial startup/memory/latency measurements are recorded.

## Stage 2 — Daily-driver Git workstation (months 3–9)

Add graph-quality history, branch/tag/stash operations, amend, rebase/cherry-pick/revert flows, conflict resolution, remotes, fetch/pull/push, credential integration, submodules/worktrees, Git LFS awareness, large-repository behavior, and keyboard-first navigation.

**Exit gate:** selected users can replace their standalone Git client for normal work; destructive or history-rewriting flows have previews, recovery guidance, and integration tests.

## Stage 3 — Editor and workspace core (months 6–15)

Build multi-file editing, tabs/splits, project tree, search/replace, command palette, settings/keymaps, autosave and crash recovery, large-file policy, terminal/task surfaces, file watching, encoding/EOL handling, and accessible navigation. CodeMirror 6 remains behind an editor capability interface.

**Exit gate:** Asterlyn is a dependable text/code editor even with all language intelligence disabled; data-loss and recovery scenarios are tested.

## Stage 4 — Language and project intelligence (months 12–26)

Introduce an LSP/DAP-agnostic service supervisor, per-language packs, diagnostics, completion, navigation, rename/refactoring where servers support it, symbols, semantic search, formatter/linter orchestration, project models, and bounded indexing for features that LSP cannot supply.

**Exit gate:** two representative ecosystems—one compiled and one dynamic—support an end-to-end edit/navigate/refactor workflow, with services isolated from the idle path and recoverable after crashes.

## Stage 5 — Build, run, test, and debug workbench (months 20–34)

Add task graphs, run configurations, test discovery/results, debugger sessions, coverage, profiling hooks, problem navigation, framework adapters, environment/secret handling, containers, and selected database/HTTP tooling.

**Exit gate:** at least two project ecosystems can be opened, edited, built, tested, run, and debugged without leaving the product for routine work; task execution has cancellation, output limits, and trust boundaries.

## Stage 6 — Extensibility, remote work, collaboration, and AI (months 28–44)

Stabilize capability APIs only after internal use. Add signed/sandboxed extensions, remote workspace agents, SSH/container environments, review collaboration, optional account sync, and replaceable AI providers. Extensions and AI receive explicit capabilities rather than ambient filesystem/process access.

**Exit gate:** extensions survive compatibility tests across supported versions; remote failure modes do not corrupt local state; AI is optional and does not sit on the baseline path.

## Stage 7 — Mature product and ecosystem (months 36–60)

Close platform-parity gaps, harden accessibility/localization, scale language packs and framework support, publish extension tooling/marketplace policy, automate migrations and rollback, establish stable/preview channels, supply-chain controls, enterprise deployment options, support policy, and long-term performance regression governance.

**Exit gate:** releases are predictable, migration-safe, measurable, supportable, and usable as a primary professional environment by defined target cohorts. “Comparable to Rebased” is evaluated by completed workflows and reliability, not raw feature count.

## Continuous engineering tracks

These do not wait for a later stage:

1. **Performance and memory:** cold/warm startup, total process-tree PSS/RSS, idle CPU, interaction latency, large-repository fixtures, and regression budgets.
2. **Correctness and recovery:** parser fixtures, mutation integration tests, cancellation, crash recovery, backups, and migration rollback.
3. **Security and trust:** workspace trust, command provenance, secret redaction, dependency review, extension capabilities, and signed updates.
4. **Accessibility and localization:** keyboard reachability, focus order, semantics, contrast, scaling, screen readers, input methods, and translatable strings.
5. **Cross-platform delivery:** Windows/macOS/Linux CI, signing/notarization, installers, OS integration, and upgrade/rollback.
6. **Observability and privacy:** local diagnostics first, opt-in telemetry, documented events, no source-content collection by default.
7. **Documentation and decisions:** ADRs, user workflows, compatibility policy, generated protocol/API references, and evidence-backed stage reviews.
8. **Product discovery:** real task studies, usability sessions, cohort retention, and explicit stop/pivot criteria.

## Portfolio rules

- Stages may overlap, but each work item belongs to one current outcome and one owner.
- No stage may expand its feature surface while its correctness, accessibility, or performance gate is red.
- At the end of months 4, 9, 15, 26, 34, and 44, reassess scope using measured adoption and engineering cost.
- Build-versus-integrate decisions are revisited annually. Rust, Tauri, and CodeMirror are replaceable implementation choices, not product identity.
- Keep a 20–30% capacity reserve after Stage 2 for maintenance, platform churn, dependency updates, and user-reported defects.

