# ADR-0029: Supervised multi-session Terminal workspace

Date: 2026-10-16

Status: accepted for implementation

Supersedes: the one-session-per-window limit in [ADR-0011](0011-supervised-terminal-sessions.md)
and the task-replaces-shell presentation in
[ADR-0026](0026-task-activation-and-terminal-routing.md)

## Context

The first Terminal slice intentionally permits one live PTY per project window. The native registry
is keyed only by window label, the frontend owns one `TerminalController` and one `TerminalView`,
and a reviewed plugin task temporarily closes the interactive shell before projecting output into
that same xterm surface. This proved lifecycle, security, transport bounds, and installed-package
behavior, but it cannot support independent Shell tabs or preserve a task transcript without
displacing the user's Shell.

`portable-pty` can supervise multiple PTYs. Terminal events, input, resize, and close already carry
opaque session IDs, so the transport has the required multiplexing identity. The missing foundation
is ownership above the PTY: a bounded per-window native session set, a host-owned Terminal workspace
model, one presentation per tab, and lifecycle rules that clean up every child process.

## Decision

### Native multi-session kernel

`asterlyn-terminal` owns a bounded set of sessions keyed by opaque native session ID. Every session
also records its owning window and canonical workspace root. Start counts the current owner's live
sessions under the registry lock and rejects the request when the per-window PTY limit of eight is
reached. Write, resize, and close require both the invoking window and exact session ID; a session
owned by another window is indistinguishable from a stale session.

Project replacement terminates every session owned by that window whose canonical root differs
from the next root. Window destruction removes all of the window's sessions. Dropping the registry
still terminates every retained child through `TerminalSession` ownership. One failed or exited PTY
does not replace or invalidate its siblings.

The command/event protocol remains version `1`: its serialized fields already identify individual
sessions and the semantic change only lifts a host-side cardinality restriction. No executable,
working directory, environment, or shell-string authority is added.

### Host Terminal workspace

One `TerminalPanel` becomes a window-scoped Terminal workspace containing a bounded ordered set of
tabs and one selected tab ID. A tab has a stable host-generated ID, workspace root, kind (`shell` or
`task`), localized title, lifecycle status, and its own `TerminalView`. Shell tabs additionally own
one `TerminalController` and native PTY identity; task tabs own one reviewed task-session projection.
DOM/xterm objects remain inside the Terminal feature and never enter application or persisted state.

The workspace allows at most twelve tabs and at most eight Shell/PTy tabs. Creating a Shell at the
limit is rejected with visible feedback. Before adding a task tab at the total limit, the host may
evict only the oldest inactive completed task tab; it never silently kills a Shell or an active
task. If no safe eviction exists, task execution continues under native supervision and the host
reports that Terminal presentation was unavailable.

Only the selected tab is visible and receives keyboard input. Hidden Shell tabs retain their PTY,
xterm scrollback, and bounded output handling. Each tab retains the existing 5,000-line xterm
scrollback, 512-KiB pre-mount buffer, 256-KiB native output queue, sequence validation, and explicit
truncation markers. The tab bounds therefore also bound aggregate retained presentation and native
queue cost.

### Tab interaction and accessibility

Terminal owns an accessible tablist above the tab content. `+` creates a Shell in the current
workspace. A tab click selects; its close control closes only that tab. The selected tab is exposed
with `aria-selected`, each tab controls one tabpanel, arrow keys move selection, `Home`/`End` select
the first/last tab, and `Delete` requests close for the selected tab. Focus moves to the nearest
surviving tab after close and to the terminal content after activation.

Closing a live Shell first terminates its native session, then removes its presentation. A running
task tab cannot be discarded: its close action requests cancellation and the tab remains until a
terminal task result arrives. Completed task tabs can be closed without affecting the bounded task
result retained by the Tasks feature. Hiding the Terminal panel preserves every tab.

Tabs are transient window state. They are not restored after application restart and their output
is never written to preferences, repository files, telemetry, search indexes, or plugin state.

### Task routing and plugin boundary

`host.task-terminal-session` advances to host-private contract version `2`. Beginning a reviewed
task creates or selects a dedicated task tab; it never closes, clears, writes into, or executes
through a Shell tab. Ordered task output and terminal status remain supplied by the native task
manager, not by a plugin or PTY. Reveal locates the task tab by the exact review/session ID.

The current native `TaskManager` continues to allow only one running plugin task per workspace.
Multi-tab Terminal therefore supports multiple retained task histories, not parallel Gradle task
execution. Relaxing task concurrency requires a separate resource, mutation, cancellation, and
workspace-reconciliation decision.

Plugins receive no Terminal, tab, DOM, or process API. They continue to provide reviewed task plans;
the host decides whether and where to present an admitted execution.

### Failure and lifecycle rules

- Failure to create one tab or PTY leaves all existing tabs usable.
- Late native events are routed only to the controller whose exact session ID matches; closed-tab
  events are ignored.
- Switching workspace disposes every old tab and terminates every old PTY before installing the new
  workspace. Opening Terminal in the new workspace creates one Shell lazily.
- Closing a project window disposes all xterm instances, event subscriptions, observers, PTYs, and
  active task ownership through existing native window cleanup.
- Application shutdown relies on the same per-window cleanup plus Rust ownership as a final backstop.
- The global Terminal event subscription is shared by the workspace and fan-outs only to bounded
  tab listeners, avoiding one native WebView subscription per tab.

## Consequences

Shells and build histories become independent, so a task no longer destroys the user's interactive
context. The implementation must replace singular assumptions at the native registry, frontend
panel, header commands, tests, and task projection seam before presenting a tab strip.

Multiple PTYs increase processes and memory by design. Fixed per-window PTY/tab limits, unchanged
per-session queues, lazy xterm loading, and acceptance measurements are required before delivery.
The feature does not claim split terminals, restored sessions, shell selection, parallel plugin
tasks, remote terminals, or persistent transcripts.

## Rejected alternatives

- **Render tabs over one PTY.** Labels would not represent independent sessions and task output
  would still destroy Shell context.
- **Keep one xterm and replay stored bytes on switch.** Replaying escape sequences is not equivalent
  to preserving terminal state and would require a new unbounded transcript store.
- **Let plugins create Terminal tabs.** This would leak host UI and process authority across the
  plugin boundary.
- **Use task tabs to execute reviewed commands through a Shell.** It would replace the exact native
  argument-vector authority with quoting and mutable shell state.
- **Persist output and sessions across restart.** PTY processes and terminal emulation state cannot
  be safely reconstructed from preferences; persistence is a separate capability.
