# Hierarchical collection abstraction and Android Tasks rollout plan

## Outcome

Replace the remaining Tasks-specific tree engine with a host-owned hierarchical collection model,
connect the existing plugin collection contract end to end, and have the independent Android/Gradle
plugin provide the semantic hierarchy rendered by the Tasks panel.

The governing decision is
[`ADR-0022`](../architecture/decisions/0022-host-owned-hierarchical-collection-presentation.md).

## Product contract

- Android `all-tasks-tree` shows workspace, root/module, Tasks, Gradle group, and task leaves.
- Android `quick-actions-tree` shows the bounded quick-action hierarchy through the same tree engine.
- Both presentations have host-rendered tree/flat, expand-all, and collapse-all controls.
- Search keeps every matching leaf's ancestors visible and temporarily expands those paths.
- Row indentation, disclosure icons, focus, Arrow/Home/End navigation, and ARIA set metadata come
  from one shared contract.
- A task leaf shows one primary name. Exact task identity and description stay in the tooltip and
  execution model rather than becoming a second visible label.
- Cache validating, stale, loading, error, empty, cancellation, run state, and output actions remain
  visible and unchanged.
- Missing, invalid, or stale collection data falls back to a host-derived tree; it never creates an
  unexplained blank panel.

## Architecture boundary

### Shared presentation model

The shared model uses flat nodes with stable IDs, parent IDs, deterministic order, a branch/leaf
role, optional payload, and optional default expansion. Construction creates immutable indexes for
node lookup, children, ancestors, and descendants. Projection returns rows with depth, parent,
branch/leaf, expanded state, sibling position/set size, visible/rendered leaf counts, and truncation.

Filtering is a model operation: matched leaves plus all ancestors are retained. Tree mode respects
disclosure unless filtering requests forced expansion; flat mode emits only leaves in deterministic
order. Render limits count leaves, not branches, so a deep hierarchy cannot consume the task window
without showing tasks.

The shared runtime converts keyboard input into small navigation/toggle decisions. It receives
generic row descriptors and returns target IDs; it does not query Tasks-specific attributes or call
feature controllers. Focus capture uses stable collection node IDs plus an optional feature action
ID.

### Feature adapter and rendering

Tasks maps normalized provider collections into the shared model and keeps task execution payloads
on leaves. Task-specific HTML remains limited to leaf actions/status; branch rows, indentation,
disclosure attributes, and tree container semantics use shared renderer helpers. The shared toolbar
renderer supplies tree/flat, expand-all, and collapse-all commands.

The existing `tasks-tree.ts` becomes a domain adapter rather than a projection engine. Compatibility
fallback builds the same semantic nodes from task descriptors when a provider collection is absent
or rejected.

### Plugin boundary

`PluginProviderContribution.collections()` is evaluated alongside `snapshot()` under the same
failure isolation. The host accepts only the collection whose `providerId` matches that contribution,
normalizes it with SDK limits, verifies every task leaf resolves to exactly one current task, and
qualifies node IDs with the registered provider ID before merging providers.

Invalid collections produce a bounded diagnostic and are omitted; the task snapshot remains usable.
Collections do not bypass task normalization, cache readiness, trust, confirmation, or execution.

The Android/Gradle repository owns a pure collection builder. It generates the complete semantic
hierarchy from the current task snapshot and returns it from the provider. Cached and newly
discovered snapshots therefore produce the same tree. Quick Actions remain a host-selected subset
of exact task leaves as required by ADR-0021.

## Delivery phases

### HC0 — Decision and executable plan

Record ADR-0022, this plan, ownership rules, compatibility behavior, delivery order, and acceptance
gates before implementation.

Commit boundary: documentation only.

Exit gate: host/plugin ownership, fallback behavior, and cross-repository order are explicit.

### HC1 — Complete the shared hierarchical model

1. Replace repeated hierarchy scans with one bounded indexed model.
2. Add branch/leaf roles, default expansion, filtering, tree/flat projection, ARIA sibling metadata,
   leaf-window truncation, and counts.
3. Add DOM-neutral keyboard navigation and shared row/container rendering helpers.
4. Preserve the existing disclosure and toolbar APIs through adapters where current consumers still
   use them.

Commit boundary: presentation code and focused tests only; no plugin or Tasks behavior change.

Exit gate: unit tests cover ordering, cycles/missing parents, tree/flat, filtering, forced expansion,
leaf limits, expand/collapse, keyboard decisions, escaping, and ARIA metadata.

### HC2 — Carry plugin collections into Tasks

1. Add normalized collections to internal provider projections.
2. Read `collections()` safely in the contribution runtime, select by local provider ID, validate,
   qualify IDs, and isolate failures.
3. Join collection task leaves to normalized task entries after snapshot normalization.
4. Keep a deterministic snapshot-derived fallback and expose whether the projection is contributed
   or derived for diagnostics/tests.

Commit boundary: SDK adapter/runtime/controller changes and focused tests; the Android artifact is
still unchanged.

Exit gate: valid collections arrive in Tasks, invalid/throwing/mismatched collections fall back,
duplicate or missing task references cannot corrupt the panel, and other providers remain active.

### HC3 — Publish Android/Gradle semantic collections

In `/Users/gzq/PrivateProjects/asterlyn-plugin-android-gradle`:

1. Add a pure Gradle task collection builder with stable IDs and deterministic ordering.
2. Cover root tasks, nested modules, groups, task labels, cached tasks, and zero-task snapshots.
3. Return the collection from the provider for every snapshot state that retains tasks.
4. Run the standalone suite, type check, and build; bump the plugin patch version and pack an exact
   artifact.

Commit boundary: plugin repository source/tests/version first; built package produced from that
commit.

Exit gate: collection leaves reference the exact current task IDs, output is stable across input
ordering, and no host source import is introduced.

### HC4 — Migrate the Android Tasks panel

1. Convert contributed or fallback task hierarchy into the shared model.
2. Render full tasks and quick actions with the shared tree container/rows.
3. Add shared tree/flat, expand-all, and collapse-all commands to the Tasks panel.
4. Replace Tasks-specific keyboard/focus traversal and row projection with shared utilities.
5. Preserve selected task, disclosure state, query text, run/output controls, loading/error/cache
   feedback, and the header refresh/settings/close ordering.

Commit boundary: one host UI migration commit consuming the new pinned plugin artifact.

Exit gate: focused runtime/view tests cover both presentations and all toolbar/keyboard actions;
FilesRecovery displays real module/group/task content from cache and after refresh.

### HC5 — Package, real-project acceptance, and rollout record

1. Run the plugin standalone suite and host script/type/build gates.
2. Exercise `/Users/gzq/AndroidStudioProjects/FilesRecovery` with cached startup, forced refresh,
   query, tree/flat, expand/collapse, task run/cancel, and plugin settings navigation.
3. Build the native application, replace the local installation recoverably, and retain the prior
   app backup.
4. Record plugin source commit, artifact version/digest, host commit, test totals, package identity,
   and manual acceptance notes.

Commit boundary: acceptance documentation only after code and artifact commits are complete.

Exit gate: the installed app is ready for human acceptance and the previous plugin/app artifacts can
be restored independently.

## Cross-repository sequence

1. Land HC1 and HC2 in the host without requiring a new plugin artifact.
2. Land HC3 in the plugin repository and create the reviewed package.
3. Vendor and pin that package in HC4; never use an implicit sibling path in production metadata.
4. Keep the previous plugin tarball and metadata until HC5 is accepted.

This sequence keeps every host commit buildable and gives collection failures a tested fallback.

## Acceptance matrix

| Area | Required evidence |
| --- | --- |
| Shared model | deterministic tree/flat rows, filtering ancestors, disclosure, ARIA, bounds |
| Plugin isolation | throw, malformed graph, wrong provider ID, missing/duplicate task reference |
| Android collection | root and nested modules, groups, stable ordering, cache/live parity |
| Tasks UX | full/quick presentation, toolbar commands, keyboard/focus, query, batching |
| Existing states | empty, unavailable, loading/cancel, error/retry, stale cache, running/output |
| Regression | all host scripts, type check, frontend build; all plugin tests/check/build |
| Real project | FilesRecovery cached load and refresh produce visible usable task trees |
| Package | exact plugin digest, signed native app, recoverable installed-app replacement |

## Deferred work

- Migrating Changes, Files, History, Stash, Push, Find, replacement, and confirmation trees from
  their domain adapters is follow-up work after Android Tasks proves the complete model.
- Runtime third-party plugin loading, arbitrary plugin UI, plugin-provided DOM, and remote plugin
  installation remain out of scope.
- Virtual scrolling is deferred until measured row counts exceed the bounded leaf window; this
  rollout keeps incremental leaf rendering.
