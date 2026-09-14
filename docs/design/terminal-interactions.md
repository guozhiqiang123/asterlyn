# Integrated terminal interaction plan

## Outcome

The first terminal phase adds a dependable, explicitly opened shell for the current project while
preserving Asterlyn's lightweight idle path. The activity rail gains a Terminal entry, but the
terminal itself uses the resizable bottom tool window so useful command width does not compete with
the Files or Changes dock.

## T1 — One supervised terminal per project window

T1 is delivered through independently revertible local commits:

1. Record the ownership, protocol, resource, security, and dependency decisions.
2. Extend activity ordering and layout state so Terminal and Git History are mutually exclusive
   bottom tools. Add a one-title Terminal header, visible Hide action, empty/start state, and
   keyboard-accessible entry without loading a terminal runtime.
3. Add the product-neutral Rust PTY capability and versioned Tauri commands/events. Starting is
   authorized to the active window's exact project root; write, resize, and close are bound to the
   opaque current session; window destruction is a native cleanup backstop.
4. Add the feature-owned controller and lazy xterm view. The first activation starts the shell,
   input and output stream without broad workbench rendering, resize is animation-frame-coalesced,
   and stale events cannot enter a replacement session.
5. Complete lifecycle feedback, error recovery, restart, clear, close, keyboard focus, accessibility,
   resource limits, deterministic tests, native smoke coverage, and package evidence.

The first activation starts a terminal immediately and shows a named starting state. Hiding keeps
the session available and returns focus to the activity entry. Reactivating reveals and focuses the
same terminal. Close terminates the session and returns the panel to an explicit stopped state;
Restart replaces the old session only after ownership has been released. Clear affects xterm's
screen/scrollback projection and does not send `clear` or any other command to the shell.

Terminal and Git History share the bottom dock because both are wide, secondary work surfaces. If
Git History is visible, selecting Terminal replaces it; selecting Branches replaces Terminal. The
stored bottom height is shared so switching tools does not jump the editor. The activity ordering
remains user-draggable and backward-compatible with existing saved orders.

## T1 acceptance

- Pure layout tests cover persisted-order migration, Terminal/Git mutual exclusion, hide/reveal, and
  bottom-height retention.
- Rust tests cover shell resolution, exact-root authorization inputs, one-session replacement rules,
  session mismatch rejection, input and dimension bounds, explicit close, reader completion, and
  window cleanup without requiring an interactive installed shell where a deterministic fake suffices.
- Protocol tests cover every command argument/result and every output/exit event model.
- Frontend tests cover lazy loading, one xterm owner, input/write routing, fit/resize coalescing,
  hidden-session preservation, stale-event rejection, restart/close, action feedback, localization,
  keyboard focus, and disposal.
- Native Linux smoke starts in the selected project directory, exchanges a marker through the PTY,
  resizes, closes, and confirms the session no longer accepts input.
- The full TypeScript, frontend, Rust, formatting, build, and Debian gates pass. Acceptance records
  exact emitted chunk sizes, package size, a process-tree comparison before and after first Terminal
  activation, and known Windows/macOS interaction gaps.

## Deferred phases

### T2 — Daily terminal controls

Add multiple named tabs, new/close/reopen actions, terminal search, shell selection, scrollback and
font settings, working-directory display, and explicit copy/paste commands. Each window receives a
bounded session count and total output budget before this phase can close.

### T3 — Cross-platform hardening

Exercise Windows ConPTY and macOS installed packages with interactive shells, full-screen programs,
IME/CJK input, signals, foreground jobs, resize storms, sleep/wake, project switching, and process
tree cleanup. Platform-specific launch differences remain in the terminal adapter rather than the
controller or shell view.

### T4 — Shell integration and tasks

Add verified shell integration, current-working-directory tracking, command markers, task/run
configuration surfaces, and optional language/build tooling. Repository-defined commands require a
separate workspace-trust and provenance decision; they cannot inherit T1's direct-user-input model.

## Non-goals for T1

- No automatic command execution, task discovery, or repository startup script.
- No remote shell, container shell, or elevated process.
- No shell-output indexing, persistence, telemetry, hyperlink activation, or AI ingestion.
- No claim that terminal support completes Stage 3 recovery, task, or cross-platform exit gates.
