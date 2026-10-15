# ADR-0020: Managed bundled plugins and verified task snapshot cache

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

ADR-0019 introduced a window-scoped bundled plugin contribution kernel and intentionally deferred a
public plugin ABI. The Android/Gradle integration has now exercised activation, task discovery,
supervised execution, cancellation, and host-owned task presentation. Daily use exposed the next
product gaps:

- bundled plugins have no discoverable management or configuration surface;
- plugin-owned tool windows have no standard route to their settings;
- Android Quick Actions and the complete Gradle task list use different presentation models; and
- a large Android project must execute Gradle task discovery again after every activation even when
  none of its build configuration changed.

The representative `/Users/gzq/AndroidStudioProjects/FilesRecovery` workspace exposes roughly
16,000 Gradle tasks. Keeping that snapshot only in an activation-local closure produces long blank
or loading states, wastes CPU, and makes a successful discovery feel disposable. Persisting an
unchecked task list, however, would let removed or renamed tasks survive flavor, module, included
build, wrapper, or plugin changes. Gradle discovery also evaluates repository-controlled code, so a
cache must not become a way to run stale identities or silently execute Gradle.

## Decision

### Bundled plugin management

Asterlyn will add one host-owned `Plugins` section to global Settings. Every compile-time bundled
plugin is listed even when it does not match the active workspace. A bundled plugin can be enabled
or disabled, but cannot be uninstalled. Disabling it disposes its active contributions in every
window and prevents subsequent activation; it does not delete application code, repository files,
trust decisions, or cached snapshots.

Plugin metadata and settings are declarative and bounded. Plugins do not render arbitrary Settings
DOM and do not read or write profile storage. The host owns a versioned plugin-preference store,
cross-window synchronization, validation, migration, localization, and diagnostics. This store is
separate from general appearance/editor preferences so adding plugin-specific settings does not
continually expand the core `AppPreferences` model.

The first Android/Gradle setting is a mutually exclusive task presentation mode:

- `all-tasks-tree` (default): workspace, Gradle project/module, task group, task;
- `quick-actions-tree`: workspace, Gradle project/module, action kind, variant/task.

Both modes use the same host-owned tree interaction, task identity, filtering, keyboard navigation,
focus restoration, trust, confirmation, execution, and output lifecycle. Quick Actions remain a
bounded projection of the current complete snapshot; they are not aliases or a second execution
API.

### Typed settings navigation from plugin tools

The shell will define a typed `PluginSettingsTarget` containing a plugin ID and an optional stable
setting focus ID. A plugin-backed tool header may expose that target through the host-owned tool
window contract. The shell renders a standard Settings button beside the close button and routes it
through `openSettings({ section: "plugins", pluginId, focus })`.

Plugins cannot pass selectors, URLs, markup, or callbacks into Settings. A multi-provider tool with
one active plugin navigates directly to that plugin. If a future tool aggregates multiple active
plugins, the same button opens the Plugins section with the contributing entries visible rather
than choosing a hidden default.

### Verified persistent task snapshots

Gradle task snapshots will be persisted in host-owned application data, never in the repository,
the plugin closure, recent-task history, or browser local storage. The native cache key is derived
from the canonical workspace root, platform, plugin ID, and provider ID; raw paths are not used as
directory names. Writes are atomic and cache data is treated as disposable acceleration data.

Each cache record contains:

- cache schema, plugin version, provider ID, parser version, and discovery protocol version;
- canonical workspace identity and discovery command policy;
- a bounded configuration fingerprint and its input metadata;
- discovery and last-validation timestamps; and
- declarative task descriptors only.

It never contains live execution state, output, arbitrary environment values, repository file
contents, trust grants, or artifact results.

The configuration fingerprint is computed by a host capability over an authorized bounded set of
Gradle model inputs. It includes path, existence, length, modification time, and a SHA-256 content
digest for relevant files such as settings/build scripts, Gradle properties, version catalogs,
wrapper properties/scripts, `buildSrc`, `build-logic`, and included-build configuration. It also
includes the canonical root, platform, plugin/provider/parser/cache versions, discovery flags, and
the effective Gradle/Java executable identity needed by the discovery policy. File contents and
secret property values are never persisted; only digests and non-secret metadata are stored.

A snapshot is runnable only after all of the following match:

1. canonical workspace and current activation generation;
2. enabled plugin and current provider identity;
3. cache, plugin, parser, and discovery protocol versions;
4. complete, non-truncated fingerprint input coverage; and
5. the newly computed fingerprint.

The UI may show an unverified or stale cached tree immediately to avoid a blank panel, but every
task action remains disabled until verification succeeds. On a match, the cached snapshot becomes
ready without running Gradle. On a mismatch, watcher ambiguity, overflow, unsupported schema,
corruption, bounds failure, or verification error, the old tree remains visibly stale and cannot be
run. The user must explicitly Refresh; Gradle is never invoked merely because a project opened or a
watcher fired.

Manual Refresh always bypasses the cache, uses the existing trust/review/cancellation lifecycle,
and replaces the snapshot only after successful bounded parsing and an atomic cache write. A failed
or cancelled refresh keeps the previous snapshot as stale evidence. Before executing a task, the
host rechecks the activation and verified fingerprint generation so a task from a newly dirtied
snapshot cannot start.

Watcher events that touch fingerprint inputs mark the provider dirty. Workspace-catalog changes,
root ambiguity, truncated paths, backend overflow, plugin/parser upgrades, and configuration input
set changes also mark it dirty. Ordinary source/resource edits do not invalidate Gradle task
discovery. A bounded maximum cache age provides a conservative fallback for dynamic build logic not
fully represented by file inputs; expiry marks the snapshot stale but still does not auto-run
Gradle.

The initial resource limits are:

- at most 4,096 fingerprint inputs and 64 MiB of hashed configuration bytes;
- at most 32,768 task descriptors and 16 MiB per serialized snapshot;
- at most 32 workspace/provider entries and 128 MiB total, evicted least-recently-used; and
- a 24-hour maximum verified reuse age.

Crossing a limit fails closed to an actionable, refreshable state. These limits may change with
recorded benchmark evidence without changing the trust model.

## Consequences

- Built-in integrations become discoverable and controllable without claiming that external plugin
  installation exists.
- Plugin-specific UI preferences remain host validated and synchronized across windows.
- Every plugin tool can offer a consistent, accessible route to its global Settings entry.
- Large Android projects can reopen with a useful task tree without repeatedly evaluating Gradle.
- Flavor, module, wrapper, version-catalog, included-build, and build-logic changes invalidate the
  snapshot by content rather than by path presence alone.
- Stale snapshots remain useful visual context but never grant execution authority.
- The native host gains bounded cache and fingerprint capabilities, while plugins still receive no
  raw filesystem or process access.

## Non-goals

- No marketplace, download, install, update, or uninstall flow for external plugins.
- No stable public plugin settings ABI or arbitrary plugin-rendered Settings UI.
- No automatic Gradle refresh on project open or file change.
- No caching of task output, process state, recent arbitrary commands, APK/AAB artifacts, or trust.
- No promise that file hashing can model every environment-dependent Gradle build; the age bound and
  manual Refresh are the fallback.

## Revisit triggers

Revisit this decision when an external plugin host is designed, when more than one plugin contributes
to the same tool window, when benchmark evidence requires different cache bounds, or when a safe
declarative approval model can justify optional automatic background discovery.
