# Host presentation system and plugin contract rollout plan

## Outcome

Turn existing design tokens and shared CSS into enforced host-rendered presentation primitives,
prove them in the Tasks stale/empty state and task-execution review dialog, and establish the
governance path for later declarative plugin UI capabilities.

The governing decision is
[`ADR-0024`](../architecture/decisions/0024-host-presentation-contract-and-plugin-contract-governance.md),
and the contract inventory is
[`Plugin contract registry and evolution policy`](../governance/plugin-contracts.md).

## Scope and non-goals

This slice includes semantic actions, centered panel states, inline notices, shared dialog structure,
the Tasks cache-state migration, and the task-execution dialog migration. It does not publish raw
CSS, arbitrary plugin markup, a generic plugin panel, a generic plugin dialog, or a runtime external
plugin loader. It does not bump the public Plugin SDK merely to expose host-private primitives.

## Delivery phases and commit boundaries

### HPS0 — Architecture and contract governance

1. Record ADR-0024, this plan, and the central plugin contract registry.
2. Define independent version axes, stability states, change classification, and review gates.
3. Link all sources from the documentation map and lifecycle governance.

Exit gate: future localization, Settings, collection, search, panel, and presentation contracts have
one required registration and evolution process.

Commit boundary: documentation only.

### HPS1 — Host presentation primitives

1. Add a DOM-string presentation module with semantic action intents, centered panel states, inline
   notices, dialog shells, and dialog action groups.
2. Keep it business-neutral, dependency-free from plugins and feature controllers, and responsible
   only for escaped, bounded host markup.
3. Reuse existing design tokens and shared CSS rather than creating feature-specific visual values.
4. Cover intent-to-class mapping, one-primary-action enforcement, accessibility structure, escaped
   copy, and optional details/actions with focused tests.

Exit gate: a feature can express state and actions without knowing host class names or recreating
dialog/empty-state DOM.

Commit boundary: shared presentation code, shared styles, and focused tests only.

### HPS2 — Tasks state migration

1. Render stale/error/loading outcomes as centered states only when no visible tasks remain.
2. Preserve retained task trees and use an inline notice for validating, stale, and refresh-failed
   states with usable content.
3. Render refresh/retry as the recommended host action and cancel as neutral.
4. Keep filtering, tree/flat controls, task batching, execution identity, and cache policy unchanged.

Exit gate: empty stale Tasks is centered with a vertical primary action; retained content remains
visible under an inline notice; copy never claims a visible retained list when none exists.

Commit boundary: Tasks adapter/view/styles and focused tests.

### HPS3 — Host-owned task execution dialog migration

1. Render task execution review through the shared dialog shell and action group.
2. Map Confirm to recommended, Cancel to neutral, and the persistent workspace-trust denial to an
   explicitly separated destructive/quiet action without granting the plugin presentation control.
3. Preserve trust, review-token, execution, output, cancellation, artifact, focus-trap, and terminal
   result behavior.
4. Keep the task-specific metadata grid and output/artifact body feature-owned.

Exit gate: the dialog follows host geometry, title, button, theme, focus, and accessibility rules;
the plugin still contributes only execution data.

Commit boundary: task-execution presentation and focused tests.

### HPS4 — Regression acceptance and local delivery

1. Run focused presentation, Tasks, execution, localization, dialog-geometry, and plugin SDK tests.
2. Run the full script suite, type check, production build, and relevant native checks.
3. Exercise both task presentation modes and cached/refresh states in FilesRecovery.
4. Build a fresh native package, preserve the current installation, replace the local app, relaunch
   FilesRecovery, and record artifact, functionality, accessibility, performance, memory, rollback,
   and known-limit evidence.

Exit gate: the installed application exposes the accepted host presentation without regressing task
discovery, tree interaction, settings deep link, execution review, or output reveal.

Commit boundary: acceptance evidence after verified installation.

## Implementation status

HPS0 through HPS4 are complete on 2026-10-15:

- HPS0: `ee6552c` records ADR-0024, the central registry, lifecycle rules, and this rollout plan.
- HPS1: `0331144` adds the host presentation model, renderer, shared styles, and conformance tests.
- HPS2: `4a5478e` migrates Tasks centered and retained-content state presentation.
- HPS3: `ca89aea` migrates the host-owned execution dialog and clarifies trust-denial semantics.
- Build gate: `ac57a2f` keeps the startup feature chunk below the existing 500 kB budget without
  increasing the limit.
- HPS4: full validation, signed native packaging, recoverable local replacement, FilesRecovery
  visual verification, runtime observations, and remaining human checks are recorded in
  [`Host presentation system acceptance`](../benchmarks/2026-10-15-host-presentation-system.md).

## Future contract admission

After HPS1–HPS4 prove the host primitives, a later public SDK proposal may add a versioned bounded
panel-state descriptor. Search, tool-panel invocation, notifications, and custom surfaces remain
separate contracts because they carry different authority, lifecycle, and resource limits. No
future feature may append an untyped callback, selector, or markup field to bypass catalog review.

## Acceptance matrix

- **Functionality:** stale/empty/error/loading/retained states choose the correct centered or inline
  presentation; dialog actions retain their original domain behavior.
- **Compatibility:** no Plugin SDK or Android/Gradle artifact update is required in this slice;
  feature action IDs and task protocols remain stable.
- **Security:** task execution review stays host-owned; all copy is escaped; presentation models
  carry semantic IDs rather than callbacks or markup.
- **Accessibility:** status/alert roles, title association, action order, focus trap, Escape behavior,
  keyboard tree behavior, and visible focus remain valid.
- **Performance/memory:** renderers are synchronous and bounded; retained trees are not rebuilt by a
  second component framework; no long-lived DOM or listener registry is introduced.
- **Theme and localization:** primitives use semantic tokens and accept resolved plain text; plugin
  localization ownership from ADR-0023 remains unchanged.
- **Recovery:** each phase is independently revertible, and the previous installed app is preserved
  before local replacement.
