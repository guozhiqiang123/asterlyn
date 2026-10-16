# Android workbench and device-discovery delivery plan

This plan implements [ADR-0030](../architecture/decisions/0030-plugin-run-targets-and-android-workbench.md)
across the Asterlyn host and the independent Android plugin repository. Each phase is a separately
reviewable commit; a later phase cannot weaken an earlier lifecycle or authority boundary.

## Scope

The milestone delivers a renamed Android product surface, a generic host workbench/run/target
foundation, bounded ADB device discovery, explicit configuration and target selection, and a safe
path to full application Run. It does not claim a source debugger, Logcat, wireless pairing,
emulator creation, parallel Gradle runs, or authoritative application launch until the Android
model fields are available.

## Phase AW0 — decisions and compatibility baseline

- Land ADR-0030, this delivery plan, the contract-registry entries, and plugin-repository plan.
- Record stable plugin ID and current package/artifact compatibility.
- Keep the old Tasks behavior operational throughout migration.

Gate: documentation names every authority, version axis, persistence owner, bound, failure state,
and rollback path before SDK declarations change.

## Phase AW1 — SDK contracts and adapters

- Add bounded workspace-tool, execution-target, run-configuration, run-session, process-query, and
  workspace-state declarations.
- Validate IDs, localization keys, statuses, metadata, counts, text sizes, timeouts, and output
  budgets at the import boundary.
- Reject unknown required kinds while preserving plugins that do not use the new optional contracts.
- Add current-host, oldest-supported-host, invalid-shape, duplicate-ID, and limit fixtures.

Gate: the Android artifact can compile against the new SDK while the 0.1.7 artifact remains
admissible and behaves exactly as before.

## Phase AW2 — native bounded process-query service

- Resolve only statically admitted executable candidates; never accept a renderer-selected path or
  argument vector at execution time.
- Launch without a shell, stdin, inherited interactive helpers, or unbounded environment.
- Capture stdout/stderr independently with fixed producer and retention limits.
- Enforce timeout, cancellation, one in-flight query per provider, and window/workspace ownership.
- Terminate and reap children on cancellation, replacement, destruction, and shutdown.

Initial Android query:

```text
query ID: adb.devices
executable: platform-tools/adb (SDK roots), then adb from PATH
arguments: devices -l
timeout: 10 seconds
retained output: 256 KiB combined maximum
```

Gate: Rust lifecycle tests prove no child or registry entry survives every terminal path.

## Phase AW3 — Android execution-target provider

In the plugin repository:

- change display name to Android and description to Android development tooling;
- declare the admitted `adb.devices` query and execution-target capability;
- parse CRLF/LF output, daemon preamble, repeated serials, long fields, malformed lines, emulator
  serials, and `device`, `offline`, `unauthorized`, and unknown states;
- expose a transient snapshot with explicit unavailable/error/stale states;
- remember only an explicit target ID through namespaced workspace state and revalidate it;
- cancel or ignore every late result after disposal or activation replacement.

Gate: fixtures cover no ADB, no device, one online device, multiple online devices, offline,
unauthorized, mixed states, timeout, malformed output, and workspace switch.

## Phase AW4 — host-rendered Android workbench

- Replace the visible Tasks identity with the active plugin's admitted workspace-tool identity.
- Use a semantic device icon supplied by the host icon set; no plugin SVG or CSS.
- Render Run, Tasks, and Devices tabs with shared keyboard/focus, empty/loading/error/stale states.
- Keep Run/Stop/Refresh/Settings/Close in the host title bar. Refresh targets the active view.
- Preserve the existing task tree, filtering, cache, disclosure, selection, Terminal routing, and
  task review behavior inside the Tasks view.
- Remove host checks for the Android plugin ID where equivalent provider metadata is available.

Gate: the workbench is hidden when the plugin is disabled or unmatched, remains usable when one
provider fails, and is accessible by keyboard at 200% zoom in light and dark themes.

## Phase AW5 — run configurations

- Derive exact module/variant/install-task candidates only from the current verified task snapshot.
- Keep ambiguous candidates explicit and require a user selection.
- Persist the selected configuration and target IDs under the plugin namespace.
- Disable full Run with a visible reason until application ID and launcher activity are
  authoritatively available.
- Add the Android project-model provider needed to populate those fields; do not make regex parsing
  of Gradle build files the final source of truth.

Gate: configuration invalidation after a Flavor/task change is visible, recoverable, and never runs
the stale task.

## Phase AW6 — supervised build, install, and launch

- Validate the current configuration and online target immediately before execution.
- Route the Gradle build/install step through existing reviewed task execution and its dedicated
  Terminal history.
- Revalidate the target, then execute the statically admitted ADB launch operation with the exact
  serial, application ID, and activity from the current configuration.
- Keep one host-owned Run session state across both steps; Stop cancels the active child/Gradle task.
- Publish success/failure through the host notification center and retain the Terminal transcript.

Gate: success, Gradle failure, device disconnect, unauthorized transition, launch failure,
cancellation, window close, app shutdown, and retry all end in one deterministic session state.

## Phase AW7 — packaging and acceptance

- Release a versioned Android plugin artifact and record its source commit, digest, SDK version,
  manifest identity, and rollback artifact.
- Pin the artifact in the host, run focused tests, `npm run check`, `npm run build`, relevant Rust
  tests, and the installed native smoke flow.
- Replace the local application, relaunch it, and validate FilesRecovery and SuperBoost with real
  devices where available.
- Record performance, memory, accessibility, lifecycle, known limitations, and rollback evidence in
  a benchmark document.

## Commit sequence

1. `docs: plan plugin run targets and Android workbench`
2. `feat(plugin-sdk): add workbench run target contracts`
3. `feat(native): supervise bounded plugin process queries`
4. `feat(android-plugin): discover Android execution targets`
5. `feat(workbench): render Android run tasks and devices`
6. `feat(android-plugin): contribute Android run configurations`
7. `feat(run): supervise Android build install and launch`
8. `docs: record Android workbench acceptance`

Every commit keeps both repositories buildable. Cross-repository artifact bumps happen only after
the corresponding plugin repository commit passes its own verification.
