# ADR-0028: Workspace-matched plugin surfaces

Date: 2026-10-16

Status: accepted

## Context

The Tasks activity entry is currently a fixed host control. It is enabled for every open workspace
even when no enabled plugin can contribute tasks. The Android/Gradle plugin already receives a
bounded host-owned workspace catalog and owns a `matches` predicate, but that activation result is
not connected to workbench surface visibility. An ordinary folder can therefore expose an empty
Tasks panel, and disabling the plugin does not remove the irrelevant entry.

Future plugins also need to decide whether they apply to a workspace without receiving arbitrary
filesystem access or manipulating host navigation directly. The host needs one reusable policy that
combines plugin preferences, workspace matching, successful activation, and committed contributions
before exposing a contribution-backed surface.

## Decision

### Workspace matching boundary

- The host supplies an immutable, bounded workspace-evidence snapshot. The current evidence kind is
  the authorized workspace catalog containing relative paths, platform, and truncation state.
- Each plugin owns its domain predicate through the versioned `plugin.workspace-match` contract. It
  may inspect supplied evidence but cannot read the filesystem, process environment, DOM, or layout.
- The host evaluates matching independently of enablement so Settings can truthfully report whether
  a plugin applies. Executable activation receives only plugins that are both enabled and matched.
- A thrown or malformed predicate fails closed for that plugin and cannot affect core tools or other
  plugins. Workspace identity and generation guard every result.

### Contribution-backed surface availability

The host-private `host.activity-availability` policy has three states:

- `available`: the activity can be opened in the current workspace;
- `disabled`: the stable core activity remains visible but cannot currently run;
- `hidden`: no admitted active contribution backs the optional surface, so no entry is rendered.

An optional plugin-backed surface becomes available only after the plugin is enabled, matches the
current workspace, activates successfully, and commits the contribution type consumed by that
surface. A match alone never exposes UI. For the Tasks surface, at least one active task-provider
contribution is required; the rule is provider-based and contains no Android/Gradle plugin ID.

When availability is revoked by a preference change, workspace evidence change, activation failure,
or project replacement, the host removes the entry and closes that surface if it is open. Persisted
activity order retains hidden tool IDs so reactivation restores the user's relative ordering. Core
Files, Search, Git, and Terminal availability semantics remain unchanged.

Plugins do not contribute icons, CSS, DOM, arbitrary activity buttons, or layout callbacks through
this decision. A future public custom-panel contract requires a separate capability, schema,
presentation adapter, and security review; it can consume the same host availability policy after
admission.

### Android/Gradle applicability

The Android/Gradle package applies to a complete bounded Gradle workspace only when a platform-
matching wrapper exists at the workspace root:

- POSIX: `gradlew`;
- Windows: `gradlew.bat`.

Build scripts, wrapper metadata, Android manifests, or nested wrapper files alone do not activate
the plugin. Android manifest evidence remains useful for Android-specific quick-action semantics but
is not required for the complete Gradle task tree. The package owns this predicate and its fixtures;
the host owns evidence acquisition, enablement, activation, and surface presentation.

## Consequences

Ordinary folders and unsupported Gradle-like folders no longer show an empty Tasks entry. Disabling
the only matching task plugin removes the entry immediately; enabling it reevaluates the current
evidence and restores the surface without reopening the project.

The lifecycle remains generic: adding another task-provider plugin requires no shell change. The
host can later extend the availability policy to separately admitted contribution-backed surfaces
without granting plugins direct layout authority.

## Rejected alternatives

- **Let the Android plugin hide a host button.** This crosses the plugin/DOM boundary and makes
  cleanup, ordering, focus, and multi-window behavior unverifiable.
- **Check for `gradlew` in `app.ts`.** This couples host composition to one plugin's project model and
  duplicates the existing workspace-match contract.
- **Show Tasks whenever a plugin merely matches.** Activation may fail or produce no provider; a
  visible empty surface would still be possible.
- **Keep the entry disabled.** The requirement is contextual relevance, not only action blocking;
  optional contribution-backed surfaces are hidden when absent.
- **Allow direct plugin filesystem probes.** The authorized catalog is already bounded and
  lifecycle-scoped; broader reads would expand authority without improving this decision.
