# ADR-0026: Task activation and host Terminal routing

Date: 2026-10-15

Status: accepted

## Context

The Tasks surface currently treats a primary-row click as both selection and execution. This makes
inspection error-prone, differs from the surrounding tree interactions, and causes an expensive or
destructive task to start before the user has clearly activated it.

Approved tasks also execute through the native task manager while their progress remains associated
with the Tasks confirmation dialog. Users expect an explicitly started command to open the host's
integrated Terminal and to keep its output, completion status, cancellation, and later reveal in one
recognizable execution surface. Plugins must not gain direct access to a terminal, shell string, DOM,
or host feature callback in order to provide that experience.

## Decision

### Activation contract

- A single primary-row click selects the task and never starts it.
- A primary-row double-click selects and activates the task.
- `Enter` activates the selected task; existing retry and reveal-output actions remain explicit
  single-click controls.
- Selection must not rebuild the collection, change expansion, or move its scroll position.
- Pointer activation is deduplicated: the two `click` events that precede `dblclick` only update
  selection, while `dblclick` produces exactly one execution request.

### Execution and presentation boundary

`plugin.tasks` remains a data and planning contract. A plugin can provide only a bounded task plan;
it cannot open the Terminal, write bytes, construct host UI, or bypass review. The native task
manager remains the sole process authority and executes the exact reviewed executable, argument
vector, working directory, and environment policy. The host never converts that plan into an
executable shell string.

Introduce the host-private `host.task-terminal-session` presentation contract between the task
execution runtime and the integrated Terminal feature. It carries only host-owned session identity,
reviewed display metadata, ordered output frames, lifecycle state, and cancel/reveal intent. It is
not part of the public Plugin SDK and grants no new plugin permission.

User-activated task runs use this Terminal presentation mode. Provider discovery, cache refresh,
and other background task work remain background operations and must not steal focus or open the
Terminal.

### Session lifecycle

1. Review and remembered authorization complete through the existing native boundary.
2. When native execution starts, the host opens the bottom Terminal tool and begins a task session.
3. The Terminal shows a safely formatted, display-only command summary and streams stdout/stderr in
   native event order. Display quoting is never reused for execution.
4. The session remains visible after success, failure, cancellation, or crash so its transcript and
   terminal status can be inspected. The terminal transition immediately disables stdin, stops the
   live cursor, and presents the retained transcript as completed; it does not leave an interactive
   terminal session running. “Reveal output” reopens that same completed task presentation.
5. While a task is active, the Terminal stop action delegates to the existing native cancellation
   path. Starting an interactive shell explicitly ends the retained task presentation.

The first implementation preserves the existing one-session-per-window Terminal resource model. A
task presentation replaces the visible interactive-shell session for that window; an active shell is
closed before the task transcript takes ownership. The native task itself is not moved into a shell
and continues to be supervised by the task manager. A later PTY task runner would require a separate
native capability and security review.

### Ownership and bounds

- Task execution owns preparation, review, process lifecycle, output ordering, and cancellation.
- Terminal owns rendering, focus, transcript presentation, clear/new-session controls, and panel
  visibility.
- Shell layout owns opening the bottom tool; neither Tasks nor plugins manipulate layout DOM.
- Session and output identity are checked on every transition. Stale frames are ignored.
- Existing native output limits remain authoritative; any pre-mount Terminal buffering is bounded
  and discarded on session replacement.
- Missing Terminal presentation is recoverable: execution continues under native supervision and a
  bounded error is reported, rather than starting a second process.

## Consequences

Task selection becomes safe and predictable, while explicit activation gains a durable, familiar
execution surface. The cross-feature dependency is expressed through a narrow host port rather than
by coupling the Android/Gradle plugin to Terminal internals.

The Terminal must support a task-session mode in addition to its interactive-shell mode, including
output that arrives before the lazily loaded terminal view is ready. Tests must distinguish
single-click selection, double-click/keyboard activation, background discovery, exact one-run
routing, cancellation, stale output, and retained terminal results.

## Rejected alternatives

- **Keep single-click execution.** It makes selection indistinguishable from activation and is too
  easy to trigger accidentally.
- **Let the plugin invoke Terminal APIs.** This leaks host UI and process authority across the plugin
  boundary and cannot be safely versioned.
- **Paste a command string into the interactive shell.** Quoting becomes an execution boundary,
  reviewed arguments can change meaning, and shell startup state makes behavior nondeterministic.
- **Open Terminal for discovery and refresh.** Background plugin work would repeatedly steal focus
  and turn workspace startup into visible terminal noise.
- **Duplicate execution in Terminal.** The reviewed native process and the visible shell process
  could diverge or both run; one native execution must remain the source of truth.
