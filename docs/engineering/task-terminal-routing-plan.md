# Task activation and Terminal routing implementation plan

Date: 2026-10-15

Status: accepted for implementation

Governing decision: [ADR-0026](../architecture/decisions/0026-task-activation-and-terminal-routing.md)

## Outcome

Make Tasks safe to browse and make user-started Gradle tasks visibly usable: a click selects, a
double-click or `Enter` executes, and the reviewed native process streams into the host Terminal.
Plugins continue to contribute plans and localized semantics only.

## Delivery slices

### TT0 — Record the boundary

- Add ADR-0026, this plan, and the `host.task-terminal-session` registry entry.
- Record that the contract is host-private and does not expand the Plugin SDK.

Commit boundary: documentation only.

### TT1 — Separate selection from activation

- Make primary-row `click` selection-only.
- Add delegated primary-row `dblclick` activation with one execution per gesture.
- Preserve `Enter`, retry, reveal-output, selection, expansion, and scroll behavior.
- Add interaction regression tests and localized activation guidance where exposed.

Commit boundary: Tasks interaction and its focused tests.

### TT2 — Add the host task-terminal session port

- Define typed begin, append, complete, reveal, and cancel semantics under the host application
  boundary.
- Add Terminal task-session mode with a bounded pre-mount transcript, stale-session filtering,
  display-only command summary, lifecycle footer, cancellation, clear, and explicit return to a new
  interactive shell.
- Keep interactive PTY input disabled while a task transcript owns the Terminal surface.
- Add focused tests for lifecycle, bounds, replacement, stale frames, and localized rendering.

Commit boundary: host Terminal capability with no plugin-specific imports.

### TT3 — Route reviewed user task runs

- Inject the host task-terminal port into the plugin task composition runtime.
- Route only user-activated task execution; keep discovery/refresh in background mode.
- Open and focus the bottom Terminal after native start, stream each ordered output frame once,
  complete the retained transcript, and make reveal-output reopen it.
- Reuse native cancellation and exact reviewed execution. Never serialize task arguments for shell
  execution.

Commit boundary: composition wiring and cross-feature acceptance tests.

### TT4 — Product acceptance and packaging

- Validate English and Chinese copy, keyboard/focus behavior, dark/light/system presentation, and
  the existing Tasks tree/flat interactions.
- Exercise a real FilesRecovery Gradle task for review, Terminal opening, live output, result,
  cancellation, and remembered authorization.
- Run focused tests, full frontend/native quality gates, package macOS, preserve the previous local
  application, and overwrite the local installation for manual acceptance.

Commit boundary: acceptance evidence and packaging metadata only when the evidence changes tracked
files.

## Acceptance matrix

| Scenario | Required result |
| --- | --- |
| Single-click a task | Row becomes selected; no preparation, dialog, Terminal, or process starts |
| Double-click a task | Exactly one preparation starts and normal authorization policy applies |
| Press `Enter` on selection | Same activation semantics as double-click |
| Click retry/reveal | Explicit action still works on one click without accidental duplicate run |
| Discovery/cache refresh | No Terminal focus change; progress remains in Tasks |
| Confirm a reviewed run | Bottom Terminal opens after native start and identifies the exact task |
| Arguments contain spaces/metacharacters | Native argument vector is unchanged; display quoting is inert |
| stdout/stderr arrive early | Bounded transcript replays after lazy Terminal mount without loss/duplication |
| Cancel from Terminal | Existing native task is cancelled; no shell or second task is spawned |
| Task finishes/fails/crashes | Transcript and terminal status remain revealable |
| Start a new interactive session | Retained task presentation is cleared and one supervised shell starts |
| Rapid task/session replacement | Stale frames cannot mutate the current Terminal session |
| Tree/flat, filter, load more | Selection and scroll remain stable through activation lifecycle |

## Rollback

TT1 can be reverted independently to the previous pointer behavior. TT3 can be disabled at the
composition seam so native tasks fall back to the existing execution dialog without changing task
plans or authorization records. TT2 introduces no persisted schema and can be removed without data
migration. The packaged application replacement remains recoverable through the dated installation
backup.
