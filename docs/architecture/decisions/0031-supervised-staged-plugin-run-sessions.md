# ADR-0031: Supervised staged plugin Run sessions

- **Status:** Accepted for implementation
- **Date:** 2026-10-16

## Context

ADR-0030 introduced declarative run configurations and execution targets, but the first SDK shape
can return only one task execution plan. Android application Run is not one process. It must bind an
exact Gradle build task and online device, wait for the build result, resolve the exact variant APK,
install that artifact only on the selected device, acquire the final application identity, and only
then launch the application. Treating those phases as unrelated task clicks loses cancellation, stale-result,
Terminal, notification, and shutdown ownership.

Android build files are also not authoritative enough for application identity. Product flavors,
build types, `applicationIdSuffix`, manifest placeholders, manifest merging, and `activity-alias`
can all change the final package or launch component. A full Gradle project model can provide
pre-build configuration intelligence later, but it is not required to deliver a correct first Run.
The final APK already contains the identity installed on the device.

The existing `plugin.process-query` contract intentionally accepts only fixed arguments and is
read-oriented. Reusing it for renderer-selected serials, artifact paths, package names, or activity
names would silently broaden ambient process authority. Reusing the Gradle task authorization path
for ADB would similarly mix workspace-executable trust with external-device mutation.

## Decision

### Run means a host-supervised staged session

The Plugin SDK exposes a versioned staged Run plan. A plugin contributes configuration and target
semantics, plus pure phase callbacks that return bounded host-reviewed plans. It never receives a
process, shell, PTY, Terminal, filesystem, or notification handle.

The staged plan contains:

1. one exact reviewed task plan used only to build the selected variant;
2. an artifact-resolution request, including bounded sidecar names, bound to the completed task and
   current workspace generation;
3. typed declared install and launch actions produced only after authoritative metadata is
   resolved; and
4. result callbacks that update plugin-owned configuration state without owning host session state.

The host owns one active Run session per workspace and the complete state machine:

```text
queued
  -> building
  -> resolving-artifact
  -> validating-target
  -> installing
  -> launching
  -> succeeded | failed | cancelled
```

Every asynchronous result is accepted only when plugin ID, provider ID, configuration ID,
workspace root, workspace generation, session ID, and phase revision still match. Workspace
replacement, plugin deactivation, window destruction, application shutdown, or explicit Stop
cancels the active phase and prevents late callbacks from publishing.

The existing task Terminal tab is the visible Run transcript. Phase boundaries and the terminal
outcome remain visible after completion; the session returns to an idle, runnable state without
clearing history or leaving a live child. The host notification center publishes the terminal Run
result. A plugin may provide localization keys, not rendered markup or notification timing.

### Android identity is resolved from the final APK

The Android implementation derives module, variant, and exact install-task candidates only from the
current verified Gradle task snapshot. Ambiguous candidates require an explicit selection. An
install candidate becomes runnable only when the matching exact `assemble<Variant>` task exists.
After that build task succeeds, the plugin requests bounded artifact and
`output-metadata.json` sidecar resolution below the exact module APK output root.

The host transports bounded sidecar bytes without interpreting Android semantics. The plugin parses
AGP output metadata, requires an exact `variantName`, contains each referenced file beside the
metadata file, and initially accepts exactly one `SINGLE` APK. It then inspects the APK manifest
through a statically admitted Android SDK tool. The Android plugin parses that bounded output and supplies:

- final application ID;
- normalized launch component, including `activity-alias` identity;
- exact artifact identity and fingerprint; and
- the configuration fingerprint against which the metadata was resolved.

The parser accepts `MAIN` plus `LAUNCHER`, and may accept `LEANBACK_LAUNCHER` for a TV launch
configuration. Zero or multiple eligible components is an explicit incomplete/ambiguous state; it
is never guessed. Gradle/Groovy/Kotlin build files and source-code regexes are not final authority.

The resolved identity is session-scoped by default. A plugin may cache it only together with the
artifact and configuration fingerprint, and must discard it after any relevant Gradle/manifest
invalidation or missing artifact.

### Parameterized external-tool actions are separately admitted

A static plugin package may declare parameterized tool operations. Each declaration contains a
stable operation ID, executable resolution candidates, fixed argument templates, typed parameter
slots, timeout, output budget, and read or mutation intent. Runtime code supplies only slot values.
The host validates each value, substitutes arguments without a shell, strips interactive/tracing
environment, captures bounded output, and owns cancellation and child cleanup.

The initial slot kinds are deliberately narrow:

- `executionTargetId` — must equal a currently selectable target from the bound provider;
- `androidApplicationId` — bounded Android package identifier;
- `androidComponent` — bounded normalized package/activity component; and
- `workspaceArtifact` — canonical file below the active workspace with an admitted suffix.

The Android package declares separate operations for APK manifest inspection, selected-device APK
installation, and application launch. Install and launch are mutations and are admitted only inside
an explicit user-invoked Run session. The install operation accepts one contained APK and one
currently selectable target. There is no generic plugin API for arbitrary arguments, paths, working directories,
environment variables, stdin, shells, or background processes.

### Android Run execution

The accepted first Run flow is:

```text
select exact configuration and online target
  -> revalidate current task/configuration fingerprint
  -> execute reviewed Gradle assemble task in the host Terminal
  -> resolve the exact variant APK from bounded AGP output metadata
  -> inspect the final APK
  -> revalidate the same target from a fresh provider snapshot
  -> execute admitted adb -s <serial> install -r <apk>
  -> revalidate the same target again
  -> execute admitted adb -s <serial> shell am start -n <component>
  -> retain transcript and publish the terminal result
```

The explicit Run action authorizes the admitted install and launch phases for that exact session,
artifact, and target; it does not produce a second generic process-confirmation dialog. Existing
workspace trust and exact Gradle task-review policy still govern the build task.

### Destructive deployment recovery requires a fresh confirmation

An install failure does not widen the original Run authorization. A plugin may recognize one
bounded tool result and return a declarative deployment-recovery plan containing localized review
copy plus one separately admitted recovery operation. The host owns the alert dialog, focus,
queueing, cancellation, lifecycle checks, operation execution, transcript, and retry of the exact
original deployment request. The plugin never receives a dialog, DOM, process, or Terminal handle.

The first recovery is Android's exact `INSTALL_FAILED_UPDATE_INCOMPATIBLE` result. The Android
plugin may request `android.adb.uninstall` for the already selected serial and the application ID
proven by final APK inspection. The host must explain that uninstalling removes the existing
application and its local data. Cancellation preserves the installed application and ends Run as
cancelled. Confirmation executes only `adb -s <serial> uninstall <applicationId>`, revalidates the
same target, and retries the same contained APK once. No other install failure, free-form output,
package, target, artifact, repeated recovery, or silent uninstall is accepted.

### Presentation and selection

The host-rendered Run view contains:

- one custom themed configuration selector when multiple configurations exist;
- one custom themed target selector backed by current target-provider state;
- a Run control that changes to Stop while a session is active;
- current phase, elapsed state, and latest retained result; and
- actionable incomplete/failure reasons.

The control is disabled for stale configuration, ambiguous module/variant, absent launcher,
unselected/missing/offline/unauthorized target, unavailable Android tooling, or another active
workspace mutation. Rendering never clears the Tasks or Devices snapshots while Run is active.

## Ownership and dependency direction

The Android plugin owns Android semantics: task-to-configuration projection, variant identity,
output-metadata/APK-manifest interpretation, package/component normalization, launch-plan creation,
settings, localization, and plugin-state migration.

The host owns generic authority and lifecycle: declaration admission, typed slot validation,
workspace containment, child processes, task review, Run session state, target revalidation,
Terminal projection, Stop, notifications, shutdown cleanup, and all rendered controls.

Native code knows declared tool-operation and artifact-containment rules, but no Android product
policy. Host UI knows generic configurations, targets, phases, and errors, but no Gradle task names,
package rules, or Activity semantics.

## Failure and lifecycle rules

- A Gradle failure ends the session without artifact resolution, installation, or launch.
- Missing, stale, ambiguous, external, symlink-escaped, or over-limit artifacts fail closed.
- Missing, malformed, mismatched, truncated, or ambiguous AGP output metadata fails closed. Split
  APK output remains explicitly unsupported until target ABI/density/language matching and
  `install-multiple` are supervised by the host.
- A disconnected, replaced, offline, or unauthorized target prevents installation or launch and
  reports the exact phase failure.
- A signature-incompatible installed package may offer one explicit destructive recovery review.
  Decline cancels without mutation; approval uninstalls only the inspected package on the selected
  target, revalidates it, and retries the identical deployment once.
- Tool timeout, malformed/truncated output, non-zero launch status, cancellation, or child crash
  produces one deterministic terminal result and reaps the child tree.
- A running session is not invalidated merely because the task provider refreshes; the next Run
  must revalidate against the new snapshot.
- Plugin disable, workspace replacement, window close, and application shutdown leave no Run,
  Gradle, ADB, resolver, listener, or registry entry alive.
- Terminal output, device serials, package/component identities, and artifact contents do not enter
  telemetry or plugin persistence.

## Compatibility and versioning

`plugin.run-sessions`, artifact sidecars, and `plugin.tool-operations` are experimental first-party contracts. They are
additive Plugin SDK declarations with independently versioned native capability protocols and a
package-manifest schema revision. Old plugins remain admissible without the capabilities. A plugin
declaring an unsupported required operation is rejected before executable code loads.

The former single-task `run()` form remains source-compatible during this rollout but cannot claim
staged Run. It may be deprecated only after an independent plugin artifact and oldest-supported
host fixture prove the replacement.

## Rejected alternatives

- **Parse `build.gradle` or source files with regular expressions.** This cannot authoritatively
  resolve merged flavor/build-type identity.
- **Require the full Gradle Tooling API before shipping Run.** It improves pre-build intelligence
  but is not required when final APK metadata supplies the installed identity.
- **Execute Gradle `install<Variant>` as Run.** The task does not make the host-selected serial the
  installation authority and therefore cannot guarantee exact-device deployment when more than one
  device is connected.
- **Let plugin JavaScript spawn ADB or SDK tools.** This bypasses native admission and lifecycle.
- **Add runtime arguments to the fixed process-query API.** This converts a read-only query seam
  into ambient execution authority without a new permission boundary.
- **Launch with `monkey` and only an application ID.** It hides component ambiguity and cannot
  provide the exact reviewed component identity.
- **Guess the only-looking install task, target, APK, or launcher.** Every ambiguous identity must
  remain visible and require selection.

## Acceptance gates

Implementation is complete only after fixtures cover single/multiple application modules,
build-type and flavor variants, `applicationIdSuffix`, relative/full Activity names,
`activity-alias`, TV launcher, zero/multiple launchers, missing/stale/split artifacts, malformed and
truncated tool output, no/one/multiple/offline/unauthorized devices, device transition between
install and launch, Gradle/launch failure, Stop in every phase, retry, plugin disable, workspace
replacement, window close, app shutdown, retained Terminal history, notifications, accessibility,
performance, memory, package compatibility, installed-app validation, and rollback evidence.
