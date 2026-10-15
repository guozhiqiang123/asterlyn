# Plugin management, task presentation, and verified cache plan

## Outcome

Turn the current Android/Gradle integration into a daily-usable bundled plugin experience:

1. global Settings lists and manages every bundled plugin;
2. Android/Gradle exposes a setting that selects either a Quick Actions tree or the complete task
   tree;
3. plugin-backed tool headers have a framework-level Settings entry beside Close; and
4. discovered Gradle tasks survive application/workspace reactivation when a verified configuration
   fingerprint still matches.

This plan extends
[`ADR-0019`](../architecture/decisions/0019-plugin-contribution-kernel.md) under the management and
cache policy accepted in
[`ADR-0020`](../architecture/decisions/0020-managed-bundled-plugins-and-task-snapshot-cache.md).
Implementation is divided into independently reviewable commits. A later phase starts only after the
previous phase's exit gate passes.

## Product contract

### Global Plugins settings

- Add a fixed `Plugins` destination to Settings navigation.
- Show every entry in the compile-time bundled plugin catalog, including unmatched and disabled
  plugins.
- Each row/detail view shows localized name and description, stable ID, version, `Built-in` badge,
  enabled state, current-workspace match/activation state, and bounded diagnostics.
- `Enabled` is a global profile preference. Disabling a plugin disposes active commands/providers and
  removes its tool contributions across windows. Re-enabling reevaluates the current workspace.
- Built-in plugins can be disabled but not uninstalled. The UI must not use misleading Remove or
  Uninstall language.
- Plugin preferences live in a dedicated versioned, bounded host store and synchronize across
  windows. Plugins never access that store directly.

### Android Tasks presentation

The Android/Gradle plugin detail contains one setting:

```text
Task presentation
  ( ) Quick Actions tree
  (x) Complete task tree   [default]
```

Both projections are host-owned trees:

```text
Complete                         Quick Actions
Workspace                        Workspace
`- :app                          `- :app
   `- Tasks                         `- Quick Actions
      |- build                         |- Assemble
      |  `- assembleDebug              |  `- Debug
      |- install                       |- Install
      `- verification                  `- Uninstall
```

- The mode changes immediately without rediscovery because Quick Actions derive from the complete
  snapshot.
- Search operates on the selected projection and preserves the ancestors needed to explain a match.
- Both modes reuse the exact discovered task key. All clicks and keyboard activation follow the same
  trust, confirmation, busy, cancel, retry, output, and recent-task lifecycle.
- Expansion and focus state are stored independently per mode for the current activation.
- Existing projection bounds remain enforced; exceeding them produces explicit truncation feedback.

### Plugin tool Settings entry

- A plugin-backed tool exposes a typed `PluginSettingsTarget`; it never manipulates Settings DOM.
- The host renders a standard Settings icon immediately beside the tool's Close button. Refresh can
  remain adjacent, but action order is stable and covered by keyboard/accessibility tests.
- For the current Tasks tool, one active Android/Gradle provider opens:

```text
Settings -> Plugins -> Android / Gradle -> Task presentation
```

- Navigation selects the Plugins section, expands/selects the requested plugin, scrolls the target
  into view, focuses it, and applies a short non-color-only highlight.
- If no plugin owns the current tool, the button is hidden. If future multiple plugins own it, the
  button opens the Plugins section filtered/focused to the contributors rather than silently choosing
  one.
- Closing Settings restores focus to the initiating header button when it still exists.

### Task cache and visible states

The Tasks panel must never be an unexplained blank or indefinite spinner. It has explicit states:

| State | Visible result | Run allowed | Primary action |
| --- | --- | ---: | --- |
| No snapshot | Explanation that tasks have not been discovered | No | Discover tasks |
| Validating cache | Cached tree plus validation status | No | Wait or cancel activation |
| Ready from cache | Tree plus cached/validated timestamp | Yes | Refresh |
| Discovering | Previous tree if any, progress, elapsed state, Cancel | Previous tree remains disabled | Cancel |
| Ready fresh | Tree plus discovery timestamp | Yes | Refresh |
| Stale | Previous tree, reason, warning | No | Refresh tasks |
| Failed | Previous stale tree if any plus bounded error | No | Retry |
| Disabled | Plugin-disabled explanation | No | Open plugin settings |

Opening a project may validate and reuse a cache, but it does not run Gradle. Manual Refresh always
bypasses the cache and retains the current confirmation/cancellation flow.

## Architecture and ownership

```text
BundledPluginCatalog ----------------------> Settings / Plugins
       |                                           |
       | metadata + declarative settings           | versioned host preferences
       v                                           v
PluginCompositionRuntime <---------------- PluginManagementRuntime
       |
       | enabled activations + provider settings target
       v
PluginContributionRuntime ---> PluginTasksRuntime ---> host Tasks tree
                                      |                       |
                                      | typed target          `-> Settings route
                                      v
                         TaskSnapshotCachePort
                                      |
                      native fingerprint + atomic cache
```

Ownership rules:

- `application/plugins`: product-neutral manifest, management snapshot, settings target, cache
  descriptor, and ports.
- `features/settings`: Plugins navigation, management controller/view, typed Settings route, focus
  restoration, and accessible controls.
- `features/tasks`: generic task tree projections and cache/discovery visual states.
- `composition`: combines plugin preferences, activation, provider lifecycle, Tasks, Settings, and
  watcher dirtiness without leaking DOM or native details into plugins.
- `plugins/android-gradle`: Android detection, discovery/parser semantics, fingerprint input policy,
  Quick Action classification, and declarative settings schema.
- native task/cache capability: canonical path authority, bounded hashing, atomic persistence, LRU
  cleanup, corruption handling, and final execution-generation verification.

The plugin may declare which authorized relative paths are relevant. Only the native host opens and
hashes them. A plugin receives fingerprint results and cache metadata, never file contents or a raw
filesystem handle.

## Data contracts

### Bundled manifest and settings

The existing bundled plugin descriptor grows host-rendered metadata rather than UI callbacks:

```ts
interface BundledPluginManifest {
  id: string;
  version: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  settings: readonly PluginSettingDescriptor[];
}

type PluginSettingDescriptor = {
  id: string;
  kind: "enum" | "boolean";
  labelKey: MessageKey;
  descriptionKey?: MessageKey;
  defaultValue: string | boolean;
  options?: readonly { value: string; labelKey: MessageKey }[];
};

interface PluginSettingsTarget {
  pluginId: string;
  focus?: string;
}
```

The first store schema is bounded to known bundled plugin IDs/settings, ignores unknown values, and
falls back per field rather than discarding unrelated valid preferences:

```text
version: 1
enabled[pluginId]: boolean            // missing means enabled
settings[pluginId][settingId]: value  // validated against manifest
```

### Cache record

```text
schemaVersion: 1
canonicalRoot
platform
pluginId / pluginVersion
providerId
parserVersion / discoveryProtocolVersion
discoveryPolicyKey
fingerprint.algorithm = sha256
fingerprint.value
fingerprint.inputs[] = relative path + existence + size + modified time + digest
discoveredAt / validatedAt / lastAccessedAt
tasks[]
```

Do not persist activation generation. It is checked at load/write/run time but changes on every
workspace activation. Do not persist output, run state, artifacts, arbitrary environment values, or
trust.

### Android fingerprint inputs

Start with these bounded, catalog-derived inputs:

- root and nested `settings.gradle[.kts]`, `build.gradle[.kts]`, and `gradle.properties`;
- `gradle/libs.versions.toml` and other version catalogs under `gradle/`;
- `gradle/wrapper/gradle-wrapper.properties`, `gradlew`, and `gradlew.bat`;
- Gradle configuration under `buildSrc/`, `build-logic/`, and catalog-visible included builds;
- the input path set itself, catalog truncation/ambiguity state, canonical root, platform, and
  discovery executable/flags; and
- plugin, parser, discovery protocol, and cache schema versions.

`local.properties` may participate by digest when present, but its contents must never be recorded or
displayed. Ordinary Java/Kotlin sources, resources, generated output, `.gradle`, and `build`
directories do not invalidate task discovery.

## Delivery phases and commit boundaries

### PMTC0 — Plan and accepted contracts

1. Add ADR-0020 and this implementation plan.
2. Record product defaults, trust/cache invariants, resource bounds, ownership, phases, and
   acceptance.
3. Link both documents from the documentation map.

Exit gate: implementation can be reviewed against settled behavior without inferring product or
security decisions from code.

Commit boundary: documentation only.

### PMTC1 — Bundled plugin catalog and management state

1. Separate immutable bundled plugin manifests from window activations.
2. Add the bounded versioned plugin-preference store with cross-window synchronization.
3. Filter activation through enabled state; dispose contributions immediately on disable and
   reevaluate on enable.
4. Publish a management snapshot containing enabled, matched, active, version, and bounded
   diagnostic state.
5. Add deterministic migration, corrupt-storage, unknown-plugin/setting, and multi-window tests.

Exit gate: disabling Android/Gradle removes its commands/provider without affecting Git, Files,
Editor, or Terminal; enabling it in an active Android workspace restores exactly one activation.

Commit boundary: catalog, store, lifecycle integration, and focused tests; no Settings UI yet.

### PMTC2 — Global Plugins Settings and typed deep links

1. Add `plugins` to the fixed Settings sections.
2. Add host-rendered bundled-plugin list/detail UI and enabled control.
3. Render manifest-declared settings; add Android task-presentation choices with
   `all-tasks-tree` as the default.
4. Add typed `SettingsRoute` support for plugin ID and stable setting focus.
5. Add localization, ARIA, keyboard, scroll/focus/highlight, and cross-window update coverage.

Exit gate: all bundled plugins remain manageable with no active workspace, and a typed route lands
on the requested Android setting without a selector or plugin-owned markup.

Commit boundary: Settings management and Android preference UI.

### PMTC3 — Framework-level tool-header Settings action

1. Add optional `PluginSettingsTarget` presentation to the host tool-window contract.
2. Render the standard Settings action beside Close without adding Android selectors to shell code.
3. Connect Tasks provider ownership to the typed Settings route.
4. Cover hidden, one-owner, future multi-owner, focus restoration, and project-switch behavior.

Exit gate: the Tasks header button opens the Android/Gradle Task presentation control; tools without
a plugin owner do not show an inert button.

Commit boundary: generic shell/settings routing and current Tasks integration.

### PMTC4 — One tree interaction with two Android projections

1. Generalize the current complete task tree projection so Quick Actions use the same row model.
2. Build the Quick Actions tree by filtering/classifying the current complete snapshot while
   preserving workspace/module ancestry.
3. Switch modes live from plugin preferences without discovering tasks again.
4. Preserve exact task identity, projection bounds, search, batching, expansion, focus, keyboard,
   and execution routing.
5. Remove the old flat Quick Actions cards after parity tests pass.

Exit gate: both modes render a useful tree for single- and multi-module fixtures, and every leaf runs
the same discovered task identity through the existing review lifecycle.

Commit boundary: task projections, view/runtime integration, styles, and focused interaction tests.

### PMTC5 — Native fingerprint and persistent cache capability

1. Add versioned request/response protocol for fingerprint, cache read/write, dirty marking, and
   bounded cleanup.
2. Compute authorized content fingerprints without following symlinks or exposing file contents.
3. Store snapshots atomically under application data with hashed keys, size/count validation,
   corruption quarantine/ignore behavior, and LRU eviction.
4. Add native unit/fault tests for traversal, symlinks, partial reads, bounds, corruption, schema
   changes, interrupted writes, and cleanup.
5. Add demo adapters so browser tests exercise cache states without native filesystem authority.

Exit gate: cache storage cannot escape application data or the active authorized workspace, and all
resource/corruption failures return typed non-fatal misses.

Commit boundary: native/application cache capability and protocol, not yet used by Gradle provider.

### PMTC6 — Android cache lifecycle and watcher invalidation

1. Load the last bounded snapshot on activation and expose `validating-cache` rather than a blank
   panel.
2. Build the current fingerprint; promote a matching snapshot to runnable `ready-cache` without
   invoking Gradle.
3. Make Refresh explicit `force: true`; after successful discovery, recompute fingerprint and write
   the snapshot atomically.
4. Classify watcher paths and ambiguous/overflow/catalog events; mark only affected providers stale.
5. Keep stale data visible, disable Run, explain the reason, and retain stale data after failed or
   cancelled refresh.
6. Recheck root, generation, enabled state, provider version, and verified fingerprint generation
   before task execution.

Exit gate: changing a flavor or module build script makes cached tasks visibly stale; reopening an
unchanged workspace restores a runnable tree without a Gradle process; no watcher event auto-runs
Gradle.

Commit boundary: provider/cache integration, state UX, watcher wiring, and lifecycle tests.

### PMTC7 — FilesRecovery acceptance and release evidence

Use `/Users/gzq/AndroidStudioProjects/FilesRecovery` as the representative acceptance workspace:

1. cold Refresh completes or reports a bounded actionable Gradle error and shows progress/cancel;
2. the resulting roughly 16,000-task snapshot remains searchable, expandable, and keyboard usable;
3. app restart or workspace reopen restores the tree from a verified cache without running Gradle;
4. changing a flavor/build script or version catalog marks it stale, and Refresh replaces it;
5. both complete and Quick Actions modes show module-aware trees and execute exact identities;
6. Settings enable/disable, direct tool-header navigation, localization, and focus restoration work in
   the packaged desktop application.

Record focused/full frontend and Rust tests, production build, cache sizes/timings, idle CPU and
memory, accessibility checks, installed-app smoke evidence, known limits, and rollback notes in a
benchmark document.

Exit gate: the packaged application is useful for the stated real project, not merely green in unit
tests.

Commit boundary: acceptance fixes and evidence document. Do not mix unrelated release/version work.

## Parallel work after PMTC0

Parallelism is allowed only with explicit file ownership and shared contracts frozen first:

| Track | Ownership | May start | Converges before |
| --- | --- | --- | --- |
| A | plugin manifests, management store, activation filtering | PMTC0 | PMTC2 |
| B | Settings Plugins UI, localization, typed route | PMTC1 public types | PMTC3 |
| C | generic tool-header action and focus restoration | PMTC2 route type | PMTC3 exit |
| D | Quick Actions tree projection/runtime/tests | PMTC1 setting enum | PMTC4 exit |
| E | native fingerprint/cache/protocol/fault tests | PMTC0 cache schema | PMTC6 |
| F | watcher classification and Android cache composition | PMTC5 ports | PMTC6 exit |

No track may redefine plugin IDs, setting IDs, cache schema, task identity, or trust behavior in
isolation. Integration commits must reconcile concurrent work before advancing the phase gate.

## Acceptance matrix

| Concern | Required evidence |
| --- | --- |
| Plugin catalog | all bundled entries visible when unmatched; stable IDs/version; no uninstall claim |
| Enable/disable | immediate dispose/reactivate; one activation; cross-window sync; unrelated tools intact |
| Settings route | exact plugin/focus; no selectors; scroll/focus/highlight; focus return |
| Tree modes | module/group/action hierarchy; exact task key; search; keyboard; batching; truncation |
| Cold discovery | trust/review; visible progress; cancel; bounded output/error; previous stale tree retained |
| Cache hit | no Gradle child process; correct source/timestamp; runnable only after fingerprint match |
| Invalidation | flavor/module/settings/catalog/wrapper/build-logic changes stale; source edits do not |
| Cache safety | hashed key; authorized root; no symlinks/path escape; atomic write; corruption/bounds miss |
| Lifecycle | root/generation/plugin change rejects late load/write/run; window cleanup; disabled plugin safe |
| Performance | FilesRecovery cache restore and tree interaction measured; 16 MiB/32,768-task limit observed |
| Accessibility | labels, status announcements, tree semantics, keyboard, focus, non-color-only stale state |
| Localization | English and Chinese plugin names, settings, cache states, diagnostics, actions |
| Packaging | production frontend/native checks plus installed desktop smoke on the representative workspace |

## Validation commands by phase

- Focused deterministic scripts for the changed plugin, Settings, Tasks, protocol, and shell units.
- `npm run check`, complete deterministic frontend suite, and production build for every integrated
  frontend phase.
- Rust format, strict Clippy, workspace tests, and protocol generation/diff checks for native phases.
- Browser interaction tests for Settings navigation, both trees, cache states, focus, and cancellation.
- Packaged installed-app smoke at PMTC7; unit tests alone do not close the plan.

Noisy Gradle/compiler/test output is retained in temporary evidence files and summarized by failing
task, primary error, and relevant source location.

## Rollback and migration

- PMTC1 defaults every known bundled plugin to enabled, preserving current behavior.
- PMTC2 defaults Android Tasks to `all-tasks-tree`; corrupt/unknown settings fall back per field.
- Removing a setting or plugin ignores its stored values without breaking other plugin preferences.
- PMTC4 can temporarily fall back to the complete tree if Quick Action projection fails; execution
  authority remains the complete snapshot.
- PMTC5/PMTC6 cache schema changes are misses, never in-place assumptions. Cache deletion loses only
  acceleration data.
- A failed cache read/write/fingerprint never blocks ordinary Git/editor/terminal use and never
  causes automatic Gradle execution.
- Every phase is independently revertible and writes no metadata into the user's repository.

## Implementation status

- PMTC0: planned in this document; implementation begins only after the documentation-only commit.
- PMTC1–PMTC7: not started.
