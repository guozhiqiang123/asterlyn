# ADR-0030: Plugin run targets and the Android workbench

- **Status:** Accepted for implementation
- **Date:** 2026-10-16

## Context

The first independent plugin proved workspace matching, managed settings, task discovery, reviewed
Gradle execution, task caching, Terminal routing, notifications, and lifecycle cleanup. Its product
surface is still named Tasks and its only executable model is one exact Gradle task. That model is
not sufficient for an Android Studio-style Run action.

Running an Android application requires an explicit application module and variant, a current
install/build plan, a launchable application identity, a selected online device, and a supervised
multi-step session. Device discovery also requires invoking `adb`, which is an external developer
tool rather than a workspace-relative executable. Neither concern belongs in the host shell, and
neither may be hidden in task metadata or implemented by granting a plugin a raw process handle.

The Android/Gradle package has consequently outgrown its current display name. Renaming its stable
plugin ID would, however, orphan enabled state, workspace trust, remembered task reviews, settings,
and cache data.

## Decision

### Product identity and compatibility

The integration is presented as **Android** with an Android-development description and a host-
owned semantic device icon. The existing plugin ID `dev.asterlyn.android-gradle` remains stable.
The package/repository may adopt an Android-wide name only through an explicit artifact migration;
display-name changes never migrate identity.

The single Tasks surface evolves into a host-rendered Android workbench with three bounded views:

- **Run** — active run configuration, selected target, validation and latest session state;
- **Tasks** — the existing cached hierarchical Gradle task collection; and
- **Devices** — the current transient execution-target snapshot and refresh state.

The title bar remains host-owned. The plugin describes semantic actions and state; the host renders
Run, Stop, Refresh, Settings, and Close controls with the common presentation system. Plugins do
not contribute DOM, CSS, SVG markup, or Terminal tabs.

### Generic plugin contracts

The Plugin SDK gains separately versioned, bounded contracts for:

1. `plugin.workspace-tool` — one declarative host-rendered tool identity and view list;
2. `plugin.execution-targets` — transient provider snapshots with stable target IDs, labels,
   semantic status, selection eligibility, metadata, refresh, and cancellation;
3. `plugin.run-configurations` — stable configurations with provider-owned metadata, validation,
   target requirements, an exact run plan, and selection;
4. `plugin.run-sessions` — host-owned queued/running/succeeded/failed/cancelled state and exact
   workspace-generation ownership;
5. `plugin.process-query` — an experimental first-party-only capability for exact, statically
   admitted, bounded external-tool queries; and
6. `plugin.workspace-state` — namespaced, versioned, size-bounded workspace preferences whose
   schema and migration remain plugin-owned.

An execution target is intentionally not called a device in the SDK. Future integrations may
provide browsers, simulators, containers, remote hosts, or other targets without changing the
host model. Android-specific fields remain bounded provider metadata interpreted only by the
Android plugin.

### Restricted external-tool queries

Plugins still receive no process, PTY, shell, environment, or filesystem handle. A package that
needs a query declares the exact query in its static manifest: stable query ID, executable
resolution policy, fixed argument vector, timeout, and output budget. Activation receives only a
request/result port keyed by that admitted query ID. The plugin cannot replace the executable,
arguments, working directory, environment, or limits at runtime.

The first Android declaration resolves `adb` from bounded Android SDK locations and PATH, then runs
only `adb devices -l`. It has no stdin, shell, network configuration, or inherited tracing; output
is captured to fixed limits and the child is terminated on timeout, cancellation, workspace
replacement, plugin deactivation, window destruction, or application shutdown.

This capability remains first-party experimental. Dynamic third-party installation stays blocked
until the external-plugin threat model defines native admission and permission storage for process
queries.

### Android execution targets

The Android plugin owns parsing and semantics for `adb devices -l`. A target has a stable serial,
display label, emulator/physical classification when known, and one of `online`, `offline`,
`unauthorized`, or `unknown`. Only `online` targets are selectable for Run.

Device snapshots are transient and are never written to the Gradle task cache. The plugin may
remember the last explicit target ID in its namespaced workspace state, but it must revalidate that
ID against every current snapshot. Exactly one online target may be selected automatically only
when no explicit valid selection exists. Multiple online targets are never guessed.

Discovery is on demand and while the workbench is visible; the first implementation uses bounded
one-shot queries. A future event stream such as `track-devices` requires a separate streaming
contract and lifecycle evidence.

### Android run configurations

The Android plugin owns module, variant, install/build task, application ID, launcher activity,
launch arguments, and Android-specific validation. The host persists only the selected stable
configuration ID and target ID under the plugin namespace.

An exact discovered install task may be exposed as an incomplete configuration, but it must not be
presented as full Run until application ID and launcher activity are authoritatively known. Build
scripts are not parsed with ad-hoc regular expressions as final authority. Android project-model,
merged-manifest, or built-artifact metadata may supply those fields in a later compatible provider
revision.

A complete Run session is host-supervised:

```text
validate current workspace/configuration/target
  -> execute reviewed Gradle build/install plan
  -> revalidate the same target
  -> execute the admitted Android launch plan
  -> publish terminal status and notification
```

The host owns cancellation, Terminal projection, notifications, stale-result rejection, and the
one-active-mutating-task rule. The plugin owns sequencing and ecosystem meaning but never creates a
Terminal tab or starts a process directly.

## Lifecycle and failure rules

- Every snapshot and session is bound to plugin ID, workspace root, and workspace generation.
- Deactivation aborts target discovery and prevents late query results from publishing.
- Workspace replacement cancels active discovery and Run; retained Terminal history remains under
  the existing Terminal policy.
- A missing ADB executable produces an actionable unavailable state, not an empty device list.
- Unauthorized and offline devices remain visible with their status but cannot be selected.
- A failed device refresh preserves the last snapshot as stale only while the same activation is
  current.
- Disabling the plugin removes the Android activity entry and disposes all providers and sessions.
- No target serial, command output, package identity, or Terminal transcript enters telemetry.

## Consequences

The host gains reusable run/target/session infrastructure without importing Android semantics.
The Android plugin becomes a coherent development workbench rather than a Gradle-task label. The
first milestone can ship useful device discovery and configuration selection before claiming full
application launch parity.

The SDK and host adapter become broader and require strict validation, bounds, stale-result tests,
and cross-repository compatibility fixtures. Full Android Studio-equivalent Run remains gated on an
authoritative Android application model; the UI must expose that limitation instead of guessing.

## Rejected alternatives

- **Call ADB from plugin JavaScript.** This grants ambient process/filesystem authority and has no
  native lifecycle backstop.
- **Run ADB through the Gradle task contract.** Task executables are workspace-relative and reviewed
  for different authority; weakening that rule would make every task review unsafe.
- **Store devices in task metadata/cache.** Device state is transient and has independent refresh,
  selection, and failure semantics.
- **Name the plugin Android Debug.** No debugger, breakpoints, JDWP, frames, or variables exist yet;
  the name would over-promise.
- **Guess a module, variant, device, application ID, or activity.** Ambiguity must be visible and
  resolved explicitly.

## Acceptance gates

Implementation is complete only when current/oldest SDK fixtures, workspace replacement,
deactivation, query timeout, missing ADB, no device, one device, multiple devices, offline device,
unauthorized device, selection persistence, keyboard/focus, light/dark theme, memory bounds, local
package replacement, and rollback evidence are recorded.
