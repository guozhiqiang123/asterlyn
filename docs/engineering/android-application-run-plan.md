# Android application Run delivery plan

This plan implements
[ADR-0031](../architecture/decisions/0031-supervised-staged-plugin-run-sessions.md) across the
Asterlyn host and the independent Android plugin repository. It continues AW5–AW7 from the Android
workbench plan. Documentation, SDK/native foundation, plugin behavior, presentation, packaging,
and acceptance land as separately reviewable commits.

## Scope

The milestone delivers ordinary Android application Run: choose an exact application
module/variant and online device, execute the reviewed Gradle install task, acquire authoritative
identity from the final APK, launch the exact component with ADB, retain the Terminal transcript,
and expose deterministic Stop/success/failure state.

It does not deliver source debugging, JDWP attach, breakpoints, variable inspection, Logcat,
instrumentation tests, app links, wireless pairing, emulator creation, parallel Runs, or a general
run-configuration editor.

## AR0 — decisions and contract registry

- Land ADR-0031, this delivery plan, registry entries, documentation-map entries, and the plugin
  repository ownership update.
- Record the static-package and runtime authority expansion separately from fixed process queries.
- Keep the existing incomplete Run view and all task/device behavior functional.

Gate: every owner, permission, slot type, state, bound, failure path, compatibility axis, and
rollback route is documented before executable declarations change.

## AR1 — SDK staged Run declarations

- Add bounded staged Run plan, artifact request/result, resolved application descriptor,
  parameterized tool-action request/result, and Run phase/result types.
- Keep configuration and target IDs stable, bounded, cloned, frozen, and validated at the host
  adapter.
- Add subscription and selection routing for run-configuration providers.
- Preserve the old one-task provider form as an optional compatibility path.
- Add current/oldest SDK, invalid shape, duplicate ID, count/text/metadata limit, and missing-
  capability fixtures.

Gate: the independent plugin compiles against the new SDK while the previously pinned 0.2.0
artifact remains admissible and operational.

## AR2 — native declared tool operations and artifact containment

- Extend static package admission with typed operation declarations and explicit `query` or
  `mutation` intent.
- Resolve only declared executable candidates and substitute only validated typed slots.
- Canonicalize `workspaceArtifact` below the active workspace, reject symlink escape, enforce
  suffix and size/count bounds, and never accept an arbitrary working directory.
- Launch without shell/stdin/interactive helpers, capture bounded streams, enforce timeout and
  cancellation, and reap the child tree on every terminal path.
- Bind operations to plugin ID, workspace root/generation, provider/configuration/target/session,
  and phase revision.

Gate: Rust tests cover every slot rejection, containment edge, executable resolution path,
timeout, cancellation, workspace replacement, plugin deactivation, window destruction, shutdown,
and registry cleanup.

## AR3 — host Run-session runtime

- Add one window/workspace-scoped Run controller and immutable snapshots for idle, queued,
  building, resolving, validating, launching, succeeded, failed, and cancelled states.
- Route the install phase through the existing reviewed task controller and dedicated Terminal tab.
- Preserve one transcript and append host-owned phase markers without exposing Terminal authority
  to the plugin.
- Add exact target revalidation immediately before launch.
- Route Stop to the active Gradle child or declared tool operation.
- Publish terminal results through the notification center and keep retained history after the
  active session releases its resources.

Gate: stale callbacks cannot update another activation/session; only one workspace mutation runs;
all terminal states return the Run control to an idle/retryable state.

## AR4 — Android configuration and artifact model

In the independent plugin repository:

- derive one configuration per exact verified `install<Variant>` task with explicit module and
  variant metadata;
- expose all candidates, require selection when more than one exists, and persist only the stable
  selected ID under the plugin namespace;
- invalidate selection and resolved identity when the task/configuration fingerprint changes;
- extend install-task artifact hints to the exact module APK output root;
- parse bounded AGP output metadata and final APK-manifest tool output;
- normalize application ID and launcher component, including relative names and
  `activity-alias`, without guessing multiple launchers; and
- return staged install, inspect, and ADB launch plans through SDK contracts only.

Gate: unit fixtures cover multi-module, multi-flavor, suffix, alias, TV, split/base APK, stale
metadata, missing APK, zero/multiple launcher, malformed/truncated tool output, and deterministic
configuration ordering.

## AR5 — host-rendered Run interaction

- Render custom themed configuration and target selectors and keep them keyboard accessible.
- Display module, variant, package/component when resolved, current phase, and retained latest
  result.
- Bind the title-bar action to Run while idle and Stop while active; prevent duplicate activation.
- Show actionable disabled reasons and exact Gradle, artifact, target, or launch failure ownership.
- Preserve Tasks and Devices content, selection, and scroll while Run rerenders.
- Add the Run action to keyboard/command coverage or record it as an explicit component-local
  action until configuration identity is stable enough for a global command.

Gate: interaction tests cover mouse, keyboard, 200% zoom, light/dark/system themes, narrow panel,
selection persistence, no scroll jump, no duplicate session, and retained failure/success history.

## AR6 — cross-repository packaging and installed acceptance

- Publish a new Plugin SDK fixture and plugin tarball with source commit, digest, manifest schema,
  capability versions, and rollback artifact.
- Pin the exact artifact in the host and run focused scripts, plugin verification, `npm run check`,
  `npm run build`, relevant Rust tests, native build, and rendered smoke.
- Replace and relaunch the local installation.
- Validate FilesRecovery and SuperBoost with a real online device where available: selection,
  install, launch, Stop, device disconnect/unauthorized, failure notification, Terminal retention,
  workspace close, and app shutdown.
- Record timing, output/memory bounds, accessibility, known limitations, installed bundle identity,
  and rollback evidence.

## Commit sequence

1. `docs: plan supervised Android application Run`
2. `feat(plugin-sdk): add staged Run and tool-operation contracts`
3. `feat(native): supervise declared plugin tool operations`
4. `feat(run): orchestrate staged plugin Run sessions`
5. `feat(android): resolve Run configurations and APK identity`
6. `feat(workbench): operate Android Run sessions`
7. `build(android): bundle staged Android Run plugin`
8. `docs: record Android application Run acceptance`

Every commit keeps the host buildable. Cross-repository artifact pins change only after the
corresponding SDK or plugin source commit passes its own verification.

## Implementation checkpoint — 2026-10-16

The first supervised Android application Run slice is implemented and installed for human
acceptance.

- Plugin SDK `1.5.0` defines typed tool operations and staged Run plans without exposing process,
  shell, PTY, filesystem, Terminal, or notification handles to plugins.
- The native host admits only `android.apk.inspect` and `android.adb.launch`, validates every typed
  parameter, contains APK paths below the active workspace, and owns timeout, cancellation, output
  bounds, child cleanup, and application/window lifecycle cleanup.
- The host Run session owns build/install, artifact resolution, target revalidation, launch,
  retained Terminal output, terminal notification, Stop, and one-active-session enforcement.
- Android plugin `0.3.0` derives configurations only from exact runnable `install<Variant>` tasks in
  workspaces with Android evidence. Instrumentation-test install tasks are excluded. Selection is
  plugin-namespaced workspace state.
- After Gradle succeeds, the plugin accepts only one APK identity from the installation output and
  discovered artifacts. AAPT badging supplies the final application ID and one unique ordinary or
  Leanback launcher component; missing, malformed, truncated, or ambiguous identity fails closed.
- The Run and device selectors are host-rendered controls. The title-bar Run action is enabled only
  for a ready configuration and currently online selectable target, and changes behavior to Stop
  while the host session is active.

FilesRecovery acceptance evidence:

- the real `tasks --all` output contained 15,980 tasks and projected 25 application Run
  configurations;
- an existing flavor APK resolved to application ID `com.photo.recovery.global.tt` and launcher
  component `com.files.recovery.page.SplashActivity` through AAPT, without reading Gradle/source
  declarations as final authority; and
- the current Android SDK and one connected online physical device were discovered successfully.

Automated verification:

- Android plugin: type check, 59 tests, and build passed;
- host frontend: type check, production build, and all 1,193 script tests passed;
- native host: 102 tests passed and two operating-system watcher tests remained intentionally
  ignored for installed acceptance;
- built and installed rendered-shell smoke checks passed; and
- the Vite main entry remained within its 500 kB hard budget at 499.63 kB.

Local package and installation:

- accepted archive:
  `target/release/bundle/macos/Asterlyn-0.1.8-local-2026-10-16-android-run-final.app.zip`;
- archive size: 10,019,838 bytes; SHA-256:
  `87f6955df28f567ea498d6e79880d6980ed621522595f3b43248f9ed0d9fc017`;
- packaged and installed executable SHA-256:
  `05310245089af5b383099bca99ef146f1572bd5a29ca7caefabc4a3aea5ec1bb`;
- `/Applications/Asterlyn.app` passed strict deep signature verification and was relaunched with
  FilesRecovery; and
- the pre-feature installation is recoverable at
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261016-android-run/Asterlyn.app`.

The first automatically bundled candidate was rejected because its resources were not sealed. It
was never accepted as the final installation; the final bundle was deep ad-hoc signed with hardened
runtime and strictly reverified before replacement.

Human acceptance still owns the final product gate: choose a FilesRecovery variant and device,
confirm the reviewed Gradle install, verify automatic application launch, inspect the retained
Terminal history and notification, and exercise Stop/device-disconnect retry. This slice does not
claim debugger, Logcat, split-APK Run, parallel Run, or full Android Studio parity.
