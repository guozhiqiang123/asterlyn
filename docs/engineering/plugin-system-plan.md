# Plugin system and Android/Gradle integration plan

## Outcome

Add a plugin-shaped project-tooling architecture without freezing a premature third-party ABI, then
use a bundled Android/Gradle plugin to provide a discoverable Gradle task UI with safe build,
install, uninstall, cancellation, and output workflows.

The implementation is incremental. Every phase is independently testable and committed before the
next phase begins. The architecture decision is recorded in
[`ADR-0019`](../architecture/decisions/0019-plugin-contribution-kernel.md).

## Non-goals for the first delivery

- No marketplace, downloaded plugins, project-local executable plugins, or stable public SDK.
- No native dynamic-library loading or arbitrary JavaScript injection.
- No plugin access to raw Tauri commands, DOM ownership, Git internals, PTY handles, credentials,
  network, or unrestricted filesystem/process APIs.
- No automatic Gradle invocation when a project opens.
- No Gradle DSL reimplementation, full Android project model, debugger, emulator manager, or ADB
  device manager in the first slice.
- No global `gradle` fallback when the project wrapper is absent.

## Target architecture

```text
Bundled Android/Gradle plugin
  |-- ProjectDetectorContribution ----> authorized workspace catalog
  |-- CommandContribution ------------> window CommandRegistry
  |-- TaskProviderContribution --------> host-owned Tasks tool
  `-- TaskExecutionRequest ------------> supervised task application service
                                                |
                                                v
                                   product-neutral task process runner

Window/plugin activation = plugin ID + canonical workspace root + workspace generation
```

The plugin owns Android and Gradle semantics. The host owns lifecycle, workspace authority, trust,
command discovery, task presentation, process policy, output bounds, cancellation, and cleanup.

## Delivery phases and commit boundaries

### PS0 — Decision, threat boundary, and implementation plan

1. Accept ADR-0019.
2. Record this phased plan, trust boundary, non-goals, parallel work, and acceptance matrix.
3. Update the documentation map, architecture overview, and roadmap language so bundled project
   integrations do not imply that the public Stage 6 extension ABI has shipped.

Exit gate: the first code change can be evaluated against an agreed ownership and security model.

Commit boundary: documentation only.

### PS1 — Window-scoped bundled plugin kernel

1. Add product-neutral plugin IDs, descriptors, activation context, contribution types, diagnostics,
   and disposable activation handles.
2. Add a registry that validates unique plugin-qualified command/provider IDs.
3. Activate matching bundled plugins from an immutable workspace evidence snapshot.
4. Dispose an old activation before installing a new root or generation.
5. Contain one plugin's activation error so other bundled plugins and the editor remain usable.
6. Register one inert Android/Gradle plugin whose detector reports evidence only.

Exit gate: deterministic tests cover duplicate IDs, activation order, failure isolation, stale
workspace replacement, disposal, and no-match behavior. No process can be started in this phase.

Commit boundary: kernel, detector fixture, and focused tests.

### PS2 — Host-owned Tasks tool and command contributions

1. Add a core Tasks activity entry and bottom tool host with empty, unavailable, loading, error, and
   detected-provider states.
2. Let active bundled plugins register stable commands through the existing `CommandRegistry` and
   unregister them on disposal.
3. Let plugins contribute declarative task-provider snapshots; the shell renders them through the
   Tasks feature rather than plugin-owned arbitrary markup.
4. Add task search, grouping, keyboard navigation, refresh, and explicit Run controls.
5. Add every new user-visible action to the shortcut coverage ledger and localization catalogs.

Exit gate: the Android detector can make the Tasks tool available and show a non-executing Gradle
provider placeholder; project switching removes it without replacing unrelated workbench regions.

Commit boundary: Tasks surface and contribution adapters, still with no process execution.

### PS3 — Workspace trust and supervised task execution

1. Add versioned workspace trust state in host-owned application data keyed by canonical root.
2. Add a product-neutral task domain crate or cohesive capability with typed executable, arguments,
   environment policy, status, exit outcome, cancellation, and output-truncation models.
3. Authorize every start against the invoking window's exact active workspace and generation.
4. Spawn the executable directly with argument arrays, a fixed working directory, sanitized
   inherited environment, bounded output, and process-tree cancellation.
5. Stream sequenced output through a versioned Tauri event and reject stale session events.
6. Stop owned task processes on cancel, project replacement, window destruction, and app exit.
7. Add a review/confirmation surface that shows task provenance and exact command data before the
   first repository-controlled execution.

Exit gate: fault tests cover denial, stale generation, path escape, executable replacement, output
overflow, cancellation, non-zero exit, process crash, window cleanup, and no-shell execution.

Commit boundary: trust and task runner capability before any Gradle invocation.

### PS4 — Android/Gradle discovery

1. Detect wrapper and settings/build evidence from the authorized catalog without running code.
2. Require trust and explicit Refresh before the first Gradle invocation.
3. Run the exact project wrapper with fixed discovery arguments such as `tasks --all` plus
   host-owned plain-console/non-interactive flags.
4. Parse bounded task output into task path, group, description, and project identity while retaining
   an explicit unsupported-output state.
5. Cache only an activation-qualified disposable projection; never treat it as workspace truth.
6. Expose Refresh Gradle Tasks through the Tasks UI and command palette.

Exit gate: fixtures cover Groovy/Kotlin settings, multi-module task paths, wrapper absence,
Windows wrapper selection, malformed/large output, Gradle failure, cancellation, and project switch.

Commit boundary: safe task discovery and parser.

### PS5 — Gradle task execution loop

1. Run only a task identity from the current discovery snapshot.
2. Show queued/running/succeeded/failed/cancelled state and bounded live output.
3. Permit one active Gradle task per workspace initially; a second request receives an explicit busy
   result rather than silently killing or multiplexing the first.
4. Add Cancel, Retry, and Reveal Output with stable focus and accessible live-state announcements.
5. Reconcile project files and Git working-tree slices after a successful task without replacing
   History, refs, editor buffers, or unrelated tool state.
6. Record recent tasks as bounded profile data without storing arbitrary command strings.

Exit gate: a representative Android fixture can run `clean` and `assembleDebug`, report failure and
cancellation, and survive project/window lifecycle changes.

Commit boundary: general Gradle task execution.

### PS6 — Android build/install/uninstall shortcuts

1. Derive Android quick actions only from current discovered task identities, such as available
   `assemble*`, `bundle*`, `install*`, and `uninstall*` tasks.
2. Present module/variant choices when task names are ambiguous; never guess a hidden default.
3. Run install/uninstall through the same reviewed task service and output lifecycle.
4. Add bounded artifact discovery and Reveal actions after successful APK/AAB builds.
5. Defer direct ADB device selection and raw APK/AAB installation until a separate typed device and
   package-install capability is approved.

Exit gate: available Gradle install/uninstall tasks are one-click discoverable but still explicit,
cancellable, and traceable to the exact wrapper/task identity.

Commit boundary: Android-focused task affordances.

### PS7 — External plugin host (deferred stage gate)

Only after the ADR revisit triggers are met:

1. Define a strict manifest schema, API negotiation, host-version range, permission declarations,
   integrity identity, and migration behavior.
2. Run external plugins out of process behind a bounded versioned protocol; never load untrusted
   native code into the Tauri host.
3. Add per-capability grants, installation provenance, enable/disable/recovery UI, crash quarantine,
   timeouts, and diagnostics redaction.
4. Add signed distribution or an explicit unsigned local-development policy before installation UI.
5. Stabilize only the smallest contracts already proven by bundled plugins.

Exit gate: compatibility, security, crash isolation, upgrade, rollback, and cross-platform evidence
meets the Stage 6 extension gate.

Commit boundary: a separate future program, not part of the initial Android delivery.

## Parallel work plan

After PS0 commits, the following work can proceed in parallel when file ownership is disjoint:

| Track | Work | Dependency |
| --- | --- | --- |
| A | Plugin types, registry, activation, diagnostics | PS0 |
| B | Android evidence detector and Gradle output parser fixtures | PS0; no process execution |
| C | Tasks controller/view and shell layout integration | PS1 contribution types |
| D | Task runner Rust models, process supervision, and fault fixtures | PS0 security contract |
| E | Protocol generation, Tauri adapters, and demo adapter | PS3 task models |
| F | Localization, commands, shortcut ledger, accessibility tests | PS2 action inventory |

Tracks converge at the end of each phase. A later phase does not start merely because one parallel
track finished; its phase exit gate and integration commit must pass first.

## Acceptance matrix

Each implemented phase records:

- focused domain/controller/protocol tests;
- `npm run check`, deterministic frontend tests, and production build;
- Rust formatting, strict Clippy, workspace tests, and no-shell process-boundary checks where Rust
  changes are present;
- startup chunk impact and proof that Android/Gradle code stays lazy when no matching project is
  active;
- keyboard navigation, focus restoration, screen-reader labels/live state, localization, and
  empty/error/cancelled paths;
- activation/disposal behavior across project replacement and multiple windows;
- task output, process-tree, memory, idle CPU, cancellation latency, and truncation evidence once
  task execution exists;
- native package and installed-app acceptance at the phase boundary required by repository policy;
- known limitations and the next phase that owns them.

## Rollback policy

- Every phase is independently revertible and leaves existing Git/editor/terminal workflows usable.
- Disabling the bundled Android plugin removes its contributions but never edits repository files.
- A failed discovery or task process is disposable state; reopening a project starts from host truth.
- Trust denial is not an error and never degrades ordinary editing or Git features.
- No phase writes plugin metadata into the user's repository.

