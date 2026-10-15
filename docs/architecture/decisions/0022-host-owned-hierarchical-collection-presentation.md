# ADR-0022: Host-owned hierarchical collection presentation

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

Asterlyn has several tree-shaped surfaces: project files, working changes, commit files, push and
stash files, replacement previews, search results, and plugin tasks. They all need some combination
of tree/flat projection, expand/collapse, ancestor-preserving filtering, bounded rendering, focus
restoration, and accessible keyboard navigation.

Those behaviors grew inside individual features. A first extraction introduced a shared disclosure
state and toolbar renderer, but the Tasks feature still owns a second tree model, row projection,
ARIA bookkeeping, truncation, and keyboard implementation. The plugin SDK already contains a
bounded `HierarchicalCollection` contract, yet provider collections are not carried through the
runtime, so the Android/Gradle plugin can only provide a flat task snapshot and the host reconstructs
Gradle semantics from task strings.

Keeping that split would make each future plugin and file-oriented feature copy interaction logic,
while allowing plugins to render their own tree would break host accessibility, styling, safety,
and lifecycle ownership.

## Decision

Asterlyn will own one presentation-layer hierarchical collection model. It accepts flat stable
nodes and produces an indexed hierarchy plus visible rows. The shared model owns:

- deterministic parent/child and sibling order;
- tree and flat projections;
- disclosure state, default expansion, expand-all, collapse-all, and subtree changes;
- ancestor-preserving filtering and forced expansion while filtering;
- leaf-based render limits and explicit truncation counts;
- depth, parent, `aria-level`, `aria-posinset`, and `aria-setsize` row metadata;
- DOM-neutral focus identity and reusable tree-keyboard navigation decisions.

Features retain their domain adapters and leaf actions. A feature maps its records into collection
nodes, supplies branch/leaf content to a host renderer, and translates selected leaves back into
feature commands. The shared layer does not know Git status, Gradle task names, file mutations, or
task execution.

Plugin collections remain declarative data. A plugin may provide stable group/task nodes and exact
task references, but never markup, selectors, icons, callbacks, focus code, or executable UI logic.
The host adapter validates bounds and structure, qualifies plugin node IDs, joins task leaves to the
current normalized task snapshot, and reports invalid contributions without affecting other tools.

The Android/Gradle plugin will provide its semantic full-task hierarchy through the existing SDK
collection capability. The host adds the workspace root and owns rendering. Android Quick Actions
remain a host projection of the current task snapshot, but use the same shared collection model and
interaction runtime. If a compatible collection is absent or rejected, Tasks falls back to a
deterministic hierarchy derived from the snapshot so an older or faulty plugin cannot blank the
panel.

Tree/flat choice and disclosure are view state, not plugin settings. The existing Android plugin
setting continues to select `all-tasks-tree` versus `quick-actions-tree`; either presentation gets
the same host-owned tree controls. Filtering temporarily forces matching ancestor paths open without
overwriting the user's disclosure state.

## Dependency direction

```text
plugin task snapshot + optional SDK collection
                    |
                    v
host plugin adapter / validation / task join
                    |
                    v
feature domain adapter -> shared hierarchical model -> shared host renderer/runtime
                    |                                      |
                    +---------------- feature actions <----+
```

`presentation` cannot import plugin implementations or feature controllers. Plugins depend only on
the SDK. Features may depend on presentation primitives, but shared primitives cannot depend on
Tasks, Git, Settings, DOM selectors owned by a feature, or Tauri.

## Consequences

- Android/Gradle preserves its own module/group/task semantics without owning panel UI.
- Tree behavior is testable once and reusable by later Git/file surface migrations.
- Existing surfaces can migrate incrementally through adapters; this decision does not require a
  risky all-at-once rewrite.
- The Tasks migration adds an explicit compatibility fallback until all pinned first-party plugins
  provide a collection.
- Collection validation and task joining add adapter code, but failures become bounded and visible
  instead of producing malformed or empty trees.

## Alternatives rejected

- **Keep feature-local tree engines:** rejected because interaction and accessibility fixes would
  continue to diverge.
- **Ship a plugin-owned WebView panel:** rejected because it gives plugins UI/runtime authority and
  duplicates host accessibility, theming, and lifecycle behavior.
- **Infer every Gradle hierarchy in the host:** rejected because module/group semantics belong to
  the provider and string inference becomes a hidden plugin dependency.
- **Migrate every tree surface in one change:** rejected because domain adapters and selection
  behavior differ; the shared contract must first prove itself in Android Tasks.

## Revisit triggers

Revisit when a second external first-party plugin requires a node kind beyond group/task, when
virtualized rendering is required beyond the bounded leaf window, or when two non-task surfaces
prove that additional selection semantics belong in the shared layer.
