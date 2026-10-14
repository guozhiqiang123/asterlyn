# ADR-0019: Bundled plugin contribution kernel before an external plugin ABI

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Asterlyn was not originally planned around a plugin system. Real usage now shows that Android
projects are a primary workload, while Gradle build, install, and uninstall tasks have no structured
UI. Adding Android-specific process execution, project detection, commands, and panels directly to
the application shell would solve the immediate symptom but would repeat that coupling for every
future ecosystem.

The repository already has useful internal seams: feature-owned controllers and views, a dynamic
window-scoped command registry, supervised terminal sessions, bounded workspace authorization, and
typed reconciliation. Those seams have not yet survived a real project-tooling integration, and the
product roadmap intentionally defers a stable third-party extension ABI until that evidence exists.

Repository configuration is untrusted. Evaluating a Gradle build, including task discovery, can run
repository-controlled code. A plugin model must therefore not turn project detection into automatic
code execution or inherit the terminal's direct-user-input authority.

## Decision

Asterlyn will introduce a **bundled plugin contribution kernel** now and defer a public external
plugin ABI. The first consumer is a bundled Android/Gradle plugin. “Bundled” means trusted,
compile-time application code shipped and reviewed with Asterlyn; it does not mean that plugin code
may bypass host capabilities.

The contribution kernel is window-scoped and lifecycle-bound to the exact workspace activation. A
bundled plugin may contribute only through host-owned registries:

- project detectors over an already-authorized bounded catalog;
- application commands with stable plugin-qualified IDs;
- task providers that return declarative task descriptors;
- task presentation consumed by one host-owned Tasks tool window;
- optional settings descriptors after the settings contribution contract is introduced.

The first kernel does not load dynamic libraries, scan project-local executable plugins, inject
scripts into the WebView, add arbitrary Tauri commands, or expose raw DOM, filesystem, Git, PTY,
network, credential, or process handles. Feature-owned bundled views remain ordinary reviewed
application code; external plugins will not inherit that implementation privilege.

Every activation is keyed by plugin ID, workspace root, and workspace generation. Project switches,
window destruction, plugin failure, or plugin deactivation dispose commands, providers,
subscriptions, requests, and output streams from that activation. A late result from an earlier
activation cannot modify the current project.

Task execution is a separate product-neutral host capability, not a terminal shortcut and not an
Android-specific command. It accepts a reviewed executable identity, an argument array, an exact
authorized working directory, a bounded environment policy, and cancellation/output budgets. It
never constructs a shell command. The task service owns process supervision and typed outcomes;
plugins own ecosystem meaning and cannot spawn processes directly.

Workspace trust is required before either Gradle task discovery or task execution because both can
evaluate repository-controlled build logic. Detection itself remains read-only and performs no
process work. The first execution request explains its provenance and exact executable/arguments;
denial leaves the workspace usable without tasks. Trust is stored as versioned host application
data keyed by canonical workspace identity, not as repository content or renderer-only storage.

The bundled Android/Gradle plugin initially detects only bounded evidence such as
`settings.gradle`, `settings.gradle.kts`, `gradlew`, `gradlew.bat`, and Gradle wrapper metadata. It
prefers the repository wrapper and does not silently fall back to a global Gradle installation.
Task discovery invokes the wrapper through the task service with fixed host-owned discovery
arguments. Task execution accepts only a task identity returned by the current discovery result;
free-form shell text is not a plugin API.

The future external plugin host will be a separate decision. It must use a versioned manifest and
protocol, explicit permissions, process isolation, bounded communication, compatibility checks,
installation integrity, disable/recovery behavior, and upgrade/rollback rules. It must not load
untrusted native code into the Tauri host. The internal contribution interfaces are allowed to
change until at least the Android/Gradle integration has exercised activation, commands, discovery,
execution, cancellation, project switching, errors, settings, and upgrade compatibility.

## Consequences

- Android/Gradle behavior stays out of the shell, workspace, Git, terminal, and task-runner cores.
- The product gets a useful plugin-shaped integration before claiming a stable ecosystem API.
- The Tasks tool is a host surface; plugins contribute task data and commands rather than arbitrary
  shell markup or process access.
- Gradle discovery is visibly gated because it can execute repository build logic.
- Existing direct terminal input remains independent from structured task execution.
- External plugin installation, marketplace, project-local plugins, dynamic libraries, arbitrary
  WebView code, ambient filesystem/process access, and a stable SDK remain out of scope.

## Revisit triggers

Revisit this decision when all of the following are true:

1. At least two bundled ecosystem plugins use the contribution kernel.
2. Their contracts have survived one compatibility migration and one disabled/failing-plugin case.
3. Workspace trust, task supervision, cancellation, output bounds, and lifecycle cleanup have
   cross-platform evidence.
4. A written external-plugin threat model and signing/distribution policy is ready for review.

