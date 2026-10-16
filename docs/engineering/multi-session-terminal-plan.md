# Multi-session Terminal implementation plan

Date: 2026-10-16

Status: implemented and installed; manual product acceptance pending

Governing decision: [ADR-0029](../architecture/decisions/0029-supervised-terminal-workspace.md)

## Outcome

Turn the one-session Terminal into a bounded host-owned Terminal workspace. Users can keep several
independent Shell tabs and every reviewed Gradle task receives its own retained task tab without
closing or clearing a Shell.

## Delivery slices

### MT0 — Record ownership and limits

- Add ADR-0029, this implementation plan, documentation-map entries, and host contract versioning.
- Mark the singular clauses in ADR-0011 and ADR-0026 as superseded without rewriting their
  historical decisions.
- Update the Terminal interaction plan and architecture overview to name the multi-session owner.

Commit boundary: documentation only.

### MT1 — Lift the native one-session restriction

- Key native sessions by opaque session ID while retaining exact window and canonical-root
  ownership.
- Enforce eight live PTYs per window under the registry lock.
- Make close, root replacement, owner removal, and registry drop operate on exact or complete owned
  session sets.
- Preserve protocol version `1`, event sequencing, queues, dimension/input validation, and shell
  selection.
- Add deterministic Rust tests for sibling isolation, limit rejection, stale/cross-owner access,
  root replacement, and owner cleanup.

Commit boundary: product-neutral native kernel and narrow Tauri authorization tests.

### MT2 — Add a host Terminal workspace model

- Introduce stable tab identity, ordering, selection, Shell/task kind, tab limits, and deterministic
  close/selection decisions outside DOM code.
- Add one shared Terminal event router and session-qualified dispatch.
- Create one controller/view pair per Shell tab without changing controller transport bounds.
- Dispose every tab on workspace replacement and window/application teardown.

Commit boundary: frontend foundation and pure lifecycle tests; no visible tab strip yet.

### MT3 — Deliver Shell tabs

- Render a keyboard-accessible tablist, tab panels, `+`, exact close controls, active status, and
  localized titles through the host presentation style system.
- Route existing Restart, Clear, Close, input, resize, appearance refresh, and shortcuts to the
  selected Shell tab only.
- Keep hidden Shells alive, reveal/focus selected content, and reject creation visibly at limits.
- Update the keyboard coverage ledger and English/Chinese localization.

Commit boundary: Terminal UI and interaction tests.

### MT4 — Route tasks to independent tabs

- Upgrade the host-private task-terminal session adapter to find/create tabs by exact task session.
- Preserve ordered output, cancellation, terminal status, truncation, notification, and later
  reveal without touching Shell tabs.
- Retain completed task transcripts until explicitly closed or safely evicted at the total-tab
  bound.
- Keep one-running-task-per-workspace native policy unchanged.

Commit boundary: task projection and cross-feature tests; no Plugin SDK change.

### MT5 — Acceptance and local installation

- Run focused Terminal/task suites, complete frontend tests/build, Rust terminal and Git gates,
  formatting, native packaging, strict signing, and built/installed rendered smokes.
- Measure process and memory movement for one, four, and eight Shell tabs; verify all child
  processes disappear after project/window closure.
- Exercise FilesRecovery with two Shell tabs plus successful and failed Gradle task tabs.
- Preserve the previous application, replace `/Applications/Asterlyn.app`, relaunch FilesRecovery,
  and record exact artifact identity and remaining manual checks.

Commit boundary: acceptance evidence only when tracked evidence changes.

## Implementation and verification evidence

Implementation commits:

- `84ccf3e` records the governing ADR, contracts, and delivery plan.
- `8dd5cec` replaces the native one-session slot with a bounded, owner-scoped session registry.
- `ddb835c` adds the shared event router and pure bounded tab model.
- `32705bc` delivers the host tab strip, independent Shell/task resources, retained task output,
  localization, and keyboard behavior.
- `3c27c4d` starts a requested Shell before the lazy renderer reports dimensions, then reconciles
  to the fitted size so startup output cannot depend on view timing.

Automated verification completed on 2026-10-16:

- TypeScript type checking passed.
- The complete frontend script suite passed: 1,175 tests.
- Focused Terminal/controller/router/tab coverage passed: 21 tests.
- `asterlyn-terminal` passed all 7 Rust tests, including eight-session admission, sibling isolation,
  exact close, root replacement, and owner cleanup.
- Terminal Clippy passed with warnings denied; the complete Rust workspace test suite passed.
- The production frontend and native application bundle built successfully. Vite still reports the
  existing advisory for one 500.42 kB shared chunk; the repository's entry-chunk hard gate passes.

Local package and installation evidence:

- `/Applications/Asterlyn.app` is the newly built `0.1.8` arm64 application with identifier
  `dev.asterlyn.desktop`; strict deep code-sign verification passes with an ad-hoc hardened-runtime
  signature suitable for local installation.
- Installed and packaged executable SHA-256 values match:
  `56420853f40259ca0304b87748b739d0958cec4a6b241c81f0a1c775c7839b74`.
- DMG SHA-256:
  `d7f91b80782316da1dd44753e32831765ceb7083e6485ab98666f781e27a7857`.
- The immediately replaced build remains recoverable at
  `~/Library/Application Support/Asterlyn Install Backups/20261016-multi-tab-terminal-prefinal/Asterlyn.app`;
  the earlier pre-feature backup was left untouched.
- Launching the installed build with FilesRecovery produced one visible layer-0 application window,
  rendered the tab workspace, and advanced the initial tab header to the running `zsh` state.
- A browser-rendered integration probe mounted the same xterm workspace with non-zero geometry;
  pure interaction tests cover creation, selection, close selection, safe task eviction, and limits.
- With FilesRecovery and one live Shell, the host process RSS snapshot was 56,736 KiB. Normalized
  one/four/eight-tab memory comparison and hands-on native keyboard/mouse behavior remain part of
  the user's manual acceptance because macOS accessibility inspection exposed no application
  windows for this locally signed build even though CoreGraphics confirmed the visible window.

## Acceptance matrix

| Scenario | Required result |
| --- | --- |
| Open Terminal for the first time | One Shell tab starts lazily at the exact workspace root |
| Press `+` | A second independent Shell/PTY appears without clearing the first |
| Switch tabs during output | Only selected content is visible; hidden tab keeps receiving output |
| Input or resize after switching | Targets only the selected Shell's exact native session |
| Close one Shell | Only that PTY terminates; siblings remain interactive |
| Create the ninth live Shell | Rejected with visible bounded feedback; existing tabs unchanged |
| Replace project | Every old tab/view/PTy is disposed before a new Shell can start |
| Close project window/application | Every owned child process and listener is released |
| Start Gradle task with Shells open | New task tab opens; no Shell is closed or cleared |
| Task succeeds/fails/cancels/crashes | Task tab retains transcript and terminal status |
| Reveal prior task output | Selects its exact retained task tab when present |
| Close running task tab | Requests cancellation; tab remains until terminal result |
| Twelve-tab pressure | Only oldest inactive completed task tab may be evicted |
| Attempt parallel Gradle execution | Existing one-task workspace policy remains authoritative |
| Malformed/stale terminal event | Cannot mutate another or replacement tab |

## Rollback

The UI can temporarily expose only the first Shell tab while retaining the plural native registry.
Task routing can fall back to its existing bounded result dialog without changing reviewed
execution. No persisted schema is introduced, so removing the tab workspace requires no migration.
The local application replacement remains recoverable through its dated backup.
