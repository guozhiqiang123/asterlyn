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

#### PS6.1 — derive exact quick actions

1. Derive Android quick actions only from the current ready, runnable discovery snapshot and only
   for exact `assemble*`, `bundle*`, `install*`, and `uninstall*` task identities.
2. Preserve the discovered Gradle task ID as the execution identity. A quick action is presentation
   metadata, not an alias, command string, or second execution API.
3. Bound the projection to 512 actions and 32 candidates per same-kind/same-variant selection,
   deduplicate exact identities, and keep deterministic ordering.

#### PS6.2 — explicit module and variant choices

1. Render a host-owned Android shortcuts section ahead of the complete task list.
2. Show module, variant, and action kind for every candidate. When two modules expose the same
   action and variant, present every candidate and never select a hidden default.
3. Route mouse and keyboard activation through the existing task key and the PS5 reviewed execution
   lifecycle, including trust, confirmation, busy handling, cancellation, output, retry, and recent
   metadata.

#### PS6.3 — bounded build-artifact discovery

1. Only successful `assemble*` and `bundle*` plans may declare artifact search hints. Hints are
   workspace-relative directories ending in `build/outputs/apk` or `build/outputs/bundle`; plugins
   receive no filesystem bridge and cannot return discovered files themselves.
2. The native host resolves the active window/workspace identity again, rejects absolute paths,
   drive prefixes, empty, current, parent, NUL, and symlink path components, and treats missing
   output directories as an empty result.
3. Accept at most 8 hints of at most 4,096 bytes. Scan at most depth 8 and 512 directories, return
   at most 64 `.apk`/`.aab` regular files, skip symlinks and files over 1 GiB, and cap accepted file
   sizes at 2 GiB in total. Crossing a traversal/result/total-size bound sets `truncated`.
4. Validate the versioned native response again in the renderer, require the exact current
   root/generation and completed task identity, and discard stale asynchronous results after a
   workspace switch, retry, replacement run, or dismissal.

#### PS6.4 — reveal, lifecycle, and deferred authority

1. Show non-persistent artifact name, type, byte size, truncation state, and a Reveal action in the
   successful task output dialog. Reuse the existing workspace Reveal capability so the native host
   revalidates the current active root and path at the moment of use.
2. Artifact discovery runs after terminal success without extending plugin filesystem authority and
   without blocking task-provider state completion. Discovery failure is reported as bounded host
   diagnostics and never changes a successful Gradle task into a failed task.
3. Keep artifact paths out of recent-task profile storage and clear retained artifact state on
   workspace change or replacement execution.
4. Defer direct ADB device selection and raw APK/AAB installation until a separate typed device and
   package-install capability is approved. Gradle `install*`/`uninstall*` remains the only install
   authority in this stage.

Exit gate: available Gradle install/uninstall tasks are one-click discoverable but still explicit,
cancellable, and traceable to the exact wrapper/task identity. Multi-module ambiguity fixtures must
prove no implicit selection; artifact tests must cover invalid hints, missing directories, symlinks,
stable ordering, response validation, all bounds, stale workspace/run rejection, and safe Reveal.
Focused and complete frontend/native suites, production type checking/build, performance and retained
memory measurements, accessibility/focus checks, and a packaged desktop smoke test are required.

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

## Implementation status and acceptance evidence

### PS0 — accepted

- Commit: `69b8922` (`docs: plan bundled plugin system`).
- The decision, security boundary, phased delivery plan, roadmap distinction, and quality-gate
  references landed before implementation.

### PS1 — accepted locally on 2026-10-14

- Commit: `bfe37b9` (`feat: add bundled plugin kernel`).
- Added a window-scoped bundled plugin runtime with validated identifiers and versions, immutable
  cloned evidence, plugin-qualified contribution IDs, atomic contribution publication, serialized
  workspace transitions, failure isolation, diagnostics, and reverse-order disposal.
- Added a bounded path-only Android/Gradle detector and registered an inert compile-time plugin.
  The plugin starts no process and contributes no command or provider in this phase.
- Focused plugin and detector tests: 25 passed.
- Complete deterministic script suite: 1,007 passed.
- Frontend type check and production build: passed; the main production chunk remained 441.59 kB
  uncompressed, below the 500 kB gate. The PS1 plugin modules are not imported by the production
  composition root, so they add no startup request or runtime work yet.
- Rust, native packaging, accessibility, memory, cancellation, and task-output measurements were
  not applicable: PS1 changes no Rust code, UI, process execution, or installed application
  behavior. These gates become active in the phases that introduce those capabilities.
- Known limitation at this boundary: the Android plugin was intentionally detection-only; PS2 now
  supplies the host-owned Tasks surface and contribution adapters.

### PS2 — accepted locally on 2026-10-14

- Added a host-owned Tasks activity and bottom tool with localized empty, unavailable, loading,
  error, grouped-results, filtering, keyboard-selection, refresh, and explicit Run presentation.
- Added window-owned contribution adapters that project reviewed plugin commands into the existing
  command registry and task-provider snapshots into the Tasks controller. Workspace replacement
  clears old projections before new evidence is activated, and disposal unregisters both kinds.
- Connected plugin activation to the bounded project catalog and kept bundled plugin loading behind
  a dynamic import. Plain projects incur no Android detector request or activation work.
- The Android/Gradle plugin now exposes a non-executing Gradle provider placeholder when bounded
  Android evidence matches. It starts no process, reads no file contents, and exposes no runnable
  task in this phase; truncated evidence is reported explicitly.
- PS2-focused and adjacent deterministic tests: 76 passed. Complete deterministic script suite:
  1,022 passed. Frontend type check and production build: passed.
- The main production chunk is 455.88 kB uncompressed, below the 500 kB gate. The lazy bundled
  Android plugin chunk is 3.00 kB uncompressed.
- Architecture gates passed: `app.ts` remains below its non-growing reviewed ceiling, Tasks owns
  its controller/view/runtime and stable DOM host, and the new stylesheet has one declared entry
  point.
- Rust, native packaging, task-process, cancellation, output, and workspace-trust acceptance are
  not applicable because PS2 still cannot execute repository-controlled code. PS3 owns those
  security and process-supervision gates; PS4 owns Gradle discovery and runnable task snapshots.

### PS3 — accepted locally on 2026-10-14

- Added a product-neutral task domain crate plus host-owned trust store, review tokens, task
  manager, Tauri commands/events, demo and native adapters, execution controller, and accessible
  review/output UI. No Gradle command is runnable yet; PS4 remains the first discovery consumer.
- Starts use direct executable/argument arrays with a fixed canonical working directory and an
  allowlisted environment. Authorization binds the canonical root, activation generation,
  executable identity, review owner, and invoking window; path/symlink escape, executable
  replacement, stale review, and untrusted workspaces fail closed.
- Output from stdout and stderr receives one serialized sequence, uses bounded base64 chunks, and
  terminates with explicit outcomes. Native capture is capped at 2 MiB per stream and renderer
  retention at 1 MiB. Review issuance is capped at 256 per ten minutes, the trust store at 256
  roots/128 KiB, executable hashing streams files up to 64 MiB, and supervision polls every 50 ms.
- Cancellation covers explicit user cancellation, workspace replacement, window destruction,
  trust revocation, and app exit. Unix terminates the process group with a child fallback; Windows
  uses the explicit system `taskkill.exe` path plus direct-child fallback.
- Focused frontend/protocol and native security/process tests: 30 passed. Complete deterministic
  frontend suite: 1,030 passed. Complete Rust workspace suite: 318 passed and 2 pre-existing native
  watcher tests ignored. Frontend type checking, production build, Rust formatting, strict Clippy,
  and source-diff checks passed.
- The main production chunk remains 455.88 kB uncompressed. The lazy task-related chunk is 22.36
  kB and the lazy Android plugin chunk is 3.00 kB; neither is part of an unmatched project's
  activation path.
- The macOS arm64 application was built at
  `target/release/bundle/macos/Asterlyn.app`, ad-hoc signed with hardened runtime, and passed strict
  deep signature verification plus a six-second native liveness smoke. The verified archive is
  `target/release/bundle/macos/Asterlyn-0.1.8-local-20261014-ps3.app.zip`, 9,635,655 bytes, SHA-256
  `ce03b8d967d76e2f31de657fb78750c92519b115ac1bc1f762557485ad05db3f`; extracting the archive
  preserved its valid signature and arm64 executable.
- The rendered native-window probe is inconclusive in the current desktop session: both this build
  and the previously installed 0.1.8 application remained alive but System Events reported
  `WINDOW_MISSING`. This matched baseline means it is not attributed to PS3, but installed-window
  interaction remains an explicit manual acceptance item.
- No comparable resident-memory or idle-CPU series was captured, so resource impact is bounded by
  the limits above rather than claimed as measured improvement. Cancellation completed within the
  two-second focused-test gate. Windows process-tree behavior is compile-time implemented but was
  not compiled or exercised on this macOS-only host; Windows CI/native acceptance remains required.
- Known limitation at this boundary: execution infrastructure is intentionally not wired into the
  Tasks tool until PS4 supplies a current, activation-qualified Gradle discovery snapshot.

### PS4 — accepted locally on 2026-10-14

- Added bounded Android/Gradle discovery that selects only the platform-matching repository wrapper
  (`gradlew` or `gradlew.bat`) and returns a typed request with fixed `tasks --all`, plain-console,
  no-daemon, and no-scan arguments. Missing, mismatched, truncated, or unbounded wrapper evidence
  fails closed; there is still no global Gradle fallback or shell command construction.
- Extended provider contributions with a declarative refresh plan. The plugin can describe a
  request and consume a bounded result, but only the host can prepare the review, read/change
  workspace trust, obtain confirmation, start/cancel the task, and deliver terminal output.
  Provider disposal, evidence replacement, project replacement, and duplicate refreshes cancel or
  discard old work by exact workspace generation and contribution identity.
- Refresh Gradle Tasks is available from both the Tasks tool and command palette. The command title
  and execution review follow the active English/Chinese locale. Review focus is trapped and
  restored to the current Tasks surface; rerenders cannot replace the dialog with a stale task
  list, and the dialog never falls back to owning the application root before the shell exists.
- The parser accepts standard bounded Gradle task sections, CRLF, ANSI output, root and multi-module
  task paths, descriptions, and deterministic duplicates. It retains each task's project path,
  sorts deterministically, and reports explicit errors for failure, malformed/no-task output,
  overlong lines, more than 512 tasks, output over 2 MiB, or renderer/native truncation. PS4 task
  rows remain non-runnable until PS5 binds execution to the current discovery identity.
- PS4-focused plugin, discovery, task-controller, lifecycle, and view tests: 44 passed. The complete
  deterministic frontend suite: 1,039 passed. Frontend type checking, production build, and
  source-diff checks passed.
- On a 14,491-byte maximum-task fixture, 200 warmed parser runs measured 0.358 ms p50, 0.525 ms p95,
  and 0.841 ms maximum on this host; forced-GC retained-heap delta was -5,696 bytes, so no retained
  growth was observed in that isolated run. There is no new timer, watcher, or automatic Gradle
  process while idle: discovery begins only after explicit Refresh and confirmation.
- The main production chunk is 464.00 kB uncompressed, still below the 500 kB gate. The lazy bundled
  plugin chunk is 6.38 kB and remains behind Android evidence; the task-related lazy chunk remains
  22.36 kB. Plain unmatched projects do not load or invoke Gradle discovery.
- The final macOS arm64 application rendered its shell within the six-second native smoke gate and
  passed strict deep signature verification with an ad-hoc hardened-runtime signature. The verified
  archive is `target/release/bundle/macos/Asterlyn-0.1.8-local-20261014-ps4-final.app.zip`, 9,652,618
  bytes, SHA-256 `44239cad44592463d5e0eeb9e704efd7810b4239d39fc49af02e9e87908d1558`;
  extraction preserved its valid signature and arm64 executable.
- Known limitations: discovery parsing is fixture-backed rather than a compatibility promise for
  every Gradle version or third-party formatter; unsupported output remains an explicit error.
  Windows wrapper selection is covered, but Windows process behavior still needs native CI/manual
  acceptance. PS5 owns runnable task identities, busy handling, retry, live output, and post-task
  workspace reconciliation.

### PS5 — accepted locally on 2026-10-14

- Discovered Gradle rows are runnable only through their exact current provider/task identity. The
  bundled plugin returns fixed direct-argument plans (`task`, plain console, no daemon, no scan),
  while the host revalidates plugin/provider/task provenance and remains the sole owner of review,
  trust, confirmation, execution, cancellation, output, retry, and lifecycle aborts.
- One active task is permitted per workspace across windows. Concurrent refresh/run requests return
  an explicit busy error, and the native manager independently rejects a second process without
  replacing the first. Terminal delivery now occurs only after the workspace run lock is released,
  so an immediate Retry cannot race stale native ownership.
- The execution dialog presents localized queued/running/succeeded/failed/cancelled/crashed state,
  bounded live stdout/stderr, truncation and errors with polite/assertive live regions, Cancel,
  Retry, and Close Output. The current task row retains a localized terminal state plus Retry and
  Reveal Output; keyboard selection, modal focus trapping, dismissal, and focus restoration remain
  host-owned.
- Successful real task runs refresh the project-file catalog and only Git untracked/tracked
  working-tree state. Exact root/generation checks guard every asynchronous stage; History, refs,
  editor buffers, plugin evidence, and unrelated tools are not reset. Plugin-scoped evidence keys
  keep the discovered projection alive when builds add unrelated generated files.
- Recent task profile data is capped at 20 records and 64 KiB, validates atomically on read, and
  stores only plugin/provider/task IDs, label, terminal status, and timestamp. Executable paths,
  arguments, environment, and output are never persisted. Renderer output retention remains capped
  at 1 MiB and native capture at 2 MiB per stream.
- PS5-focused frontend tests: 43 passed. Native task-focused tests: 7 passed, including sequential
  `clean` and `:app:assembleDebug` Gradle-shaped fixture runs, nonzero failure, cancellation,
  process-tree cleanup, exact literal arguments, output bounds, cross-window busy rejection, and
  immediate retry. The complete deterministic frontend suite passed 1,056 tests. The complete Rust
  workspace passed 320 tests with 2 operating-system watcher tests ignored; formatting and strict
  Clippy also passed.
- Production type checking and build passed. The main chunk is 468.91 kB uncompressed, below the
  500 kB gate; the lazy bundled-plugin chunk is 7.46 kB and the lazy task-related chunk is 22.84 kB.
  An unmatched project still loads neither Android discovery nor task execution code and starts no
  plugin process or timer.
- On a 512-task maximum snapshot, 1,000 warmed queued-to-terminal projection updates measured
  0.0185 ms p50, 0.0338 ms p95, and 0.1384 ms maximum on this host. Forced-GC retained-heap delta was
  15,232 bytes. One thousand recent-profile writes took 10.90 ms total and produced a 3,001-byte,
  20-record payload. These are local observations, not cross-platform performance guarantees.
- The macOS arm64 application rendered its shell within six seconds, is ad-hoc signed with hardened
  runtime, and passed strict deep verification before and after archive extraction. The verified
  archive is `target/release/bundle/macos/Asterlyn-0.1.8-local-20261014-ps5-final.app.zip`, 9,661,103 bytes,
  SHA-256 `e8b331260691da0019489ff6e3d0eb06e4a3e52127cb0dbb41fe9bacdb51877b`.
- Known limitations: native Windows execution still requires Windows CI/manual acceptance; the
  Gradle-shaped end-to-end fixture proves the exact wrapper/task contract but is not a full Android
  SDK build. PS6 owns Android assemble/bundle/install/uninstall shortcuts, ambiguous module/variant
  selection, bounded APK/AAB discovery, and Reveal artifact actions.

### PS6 — accepted locally on 2026-10-14

- The bundled Android provider now annotates only exact ready/runnable `assemble*`, `bundle*`,
  `install*`, and `uninstall*` identities. The host independently validates that action kind,
  module, and variant reconstruct the same exact task ID before rendering a shortcut. The complete
  task list remains available; shortcuts are capped at 512 overall and 32 candidates per
  kind/variant ambiguity group, and every module candidate is shown instead of selecting a default.
- Shortcut activation reuses the PS5 task key and reviewed wrapper execution without a second
  command path. Install/uninstall therefore retains workspace trust, explicit confirmation,
  one-task busy handling, cancellation, bounded output, retry, and recent-metadata behavior.
- Successful assemble/bundle plans may declare only their conventional workspace-relative
  `build/outputs/apk` or `build/outputs/bundle` directory. The host validates at most 8 hints of
  4,096 bytes; the native command reauthorizes the active window/workspace, rejects absolute,
  parent/current, empty, drive-prefixed, NUL, and symlink components, skips links, and treats a
  missing output directory as empty.
- Native artifact traversal is capped at depth 8, 512 directories, 64 regular `.apk`/`.aab` files,
  1 GiB per file, and 2 GiB accepted size in total. The renderer revalidates protocol version,
  root, normalized unique paths, kinds, sizes, totals, and limits, then attaches a result only to
  the exact visible successful task presentation generation. Workspace changes, retries,
  replacement runs, and dismissal invalidate delayed results.
- The successful output dialog exposes localized artifact type, size, bounded/truncated state, and
  keyboard-focusable Reveal actions. Reveal reuses the existing host-owned workspace capability,
  which reauthorizes the current root and file path at invocation. Artifact paths are not persisted,
  and discovery failure is diagnostic UI state rather than a rewrite of Gradle success.
- PS6-focused frontend tests: 49 passed. The complete deterministic frontend suite passed 1,069
  tests. Four focused native artifact tests passed, covering invalid hints, sorting/deduplication,
  symlink skipping, and the result limit. The complete Rust workspace passed 324 tests with 2
  existing operating-system watcher tests ignored; formatting, production type checking, and
  workspace/all-target strict Clippy passed.
- The production build passed with `src/app.ts` at 8,780 lines. The main chunk is 470.66 kB
  uncompressed, below the 500 kB gate; the lazy bundled-plugin chunk is 9.40 kB and the lazy
  task-copy chunk is 23.22 kB. A non-matching project still starts no plugin process or timer.
- On a 512-action maximum snapshot, 1,000 warmed derivations measured 0.2538 ms p50, 0.3647 ms p95,
  and 3.7493 ms maximum on this host. A maximum 64-artifact response measured 0.0476 ms p50,
  0.0713 ms p95, and 0.3065 ms maximum over 1,000 parses. Rendering the 512-action host view 200
  times measured 0.7704 ms p50, 1.6939 ms p95, and 11.3064 ms maximum. After warm-up, 5,000
  derivation/parse replacements retained 8,704 additional heap bytes under forced GC. These are
  local observations, not cross-platform guarantees.
- On macOS 15.6.1 arm64 with Node.js 26.8.1, npm 11.19.0, Rust 1.97.1, and Git 2.48.1, the packaged
  app rendered its shell within six seconds, is ad-hoc signed with hardened runtime, and passed
  strict deep verification before and after archive extraction. The acceptance archive is
  `target/release/bundle/macos/Asterlyn-0.1.8-local-20261014-ps6-final.app.zip`, 9,693,748 bytes,
  SHA-256 `a774f7bb0027ba00a2d59d2bfcaf1189ace17f6ccb826e5c229b9e557550859a`.
- `/Applications/Asterlyn.app` was replaced from the verified build and relaunched after an exact
  executable hash match (`58e4ffb97cf98cc1c7ae98fa5fc8a3004f2d184dc7653025b73d13c35720502b`).
  The previous installation is recoverable at
  `/Users/gzq/Library/Application Support/Asterlyn Install Backups/20261014-ps6-preinstall/Asterlyn.app`.
- Known limitations: direct ADB device selection and raw APK/AAB installation remain deliberately
  unavailable; Reveal may include an older regular artifact already present in the exact bounded
  output directory. Native Windows acceptance still requires Windows CI/manual verification, and
  the Gradle-shaped fixtures are not a full Android SDK build.
