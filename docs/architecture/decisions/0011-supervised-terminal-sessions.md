# 0011: Supervised, window-scoped terminal sessions

## Status

Accepted on 2026-09-14 for the first Stage 3 terminal slice.

## Context

Asterlyn needs an integrated terminal without turning the presentation layer into a process owner,
granting repository content ambient execution, or loading a terminal emulator during ordinary
editing. A browser terminal widget does not create a pseudo-terminal (PTY), while a pipe-backed
child process cannot correctly support interactive shells, full-screen programs, terminal resize,
job control, or signals on all target platforms.

The persistent workbench already separates the activity rail from resizable tool content. A narrow
left dock is unsuitable for an interactive terminal, so the activity entry and the terminal surface
must not be assumed to occupy the same region.

## Decision

Terminal is an independently owned Stage 3 capability. Its activity icon appears in the reorderable
left rail, while activation opens the existing resizable bottom tool region and replaces the Git
History surface there. The editor and left tool remain mounted. The Terminal header uses one title
and always exposes a visible, keyboard-operable Hide action.

The frontend loads `@xterm/xterm` and `@xterm/addon-fit` only when Terminal is first opened. One
`TerminalController` owns serializable status, session identity, generations, user actions, and
disposal. One `TerminalView` owns the xterm object, fit addon, resize observer, input subscription,
native event subscriptions, and focus. Neither xterm nor DOM objects enter application or persisted
state.

A new product-neutral `asterlyn-terminal` Rust crate owns shell selection, PTY creation, bounded
input and dimensions, reader lifetime, and explicit close. It uses `portable-pty`; `src-tauri` only
authorizes the active window/workspace, maps versioned commands and events, and supervises sessions
by window label. The first slice permits at most one live terminal per project window. The host
generates opaque session identifiers and targets output and exit events only to the owning window.

Starting a terminal is an explicit user action. It launches the current user's platform shell with
the exact active project root as its working directory. Repository files and configuration cannot
select an executable, arguments, startup command, environment override, or automatic task. The
initial slice does not add task execution or a workspace-trust claim. Hiding preserves the live
session; explicit Close, project replacement, window destruction, or application disposal closes
the PTY and child. PTY teardown and child termination are both attempted so foreground jobs cannot
remain attached after ownership ends.

Native output crosses the protocol as bounded base64 byte chunks carrying protocol version,
session ID, and monotonic sequence. Bytes remain bytes until xterm decodes terminal escape
sequences. Writes, resize, and close require the exact current session ID and owning window. Input
is capped per command, rows and columns are validated, output reads use fixed-size chunks, and xterm
retains at most 5,000 scrollback lines. Output has no application-level replay buffer. A hidden
terminal therefore consumes the shell/PTY process and xterm scrollback it already owns, but no
additional repository scan, polling loop, or recurring renderer.

The first slice deliberately does not enable the WebGL renderer, automatic web links, OSC-driven
application actions, workspace-command discovery, terminal tabs, split terminals, shell selection,
session restoration, or persistent output. Clipboard uses the operating-system/WebView's ordinary
explicit copy and paste path; terminal output receives no authority to write the clipboard.

## Dependency review

- `@xterm/xterm` 6.0.0, MIT, published npm distribution, zero runtime dependencies. It is emitted as
  a lazy frontend chunk and contributes its required CSS only to the packaged static assets.
- `@xterm/addon-fit` 0.11.0, MIT, published npm distribution. It provides container-to-terminal
  dimension calculation and is loaded in the same lazy boundary.
- `portable-pty` 0.9.0, MIT, published crates.io distribution from the WezTerm project. It supplies
  Unix PTY and Windows ConPTY abstraction behind the product-neutral Rust capability.

Package-manager lockfiles record registry integrity and transitive resolution. Asterlyn does not
copy code, icons, themes, or assets from another installed editor. T1 acceptance records the actual
frontend chunk, native binary, Debian package, and process-tree movement before deciding whether the
resource cost is acceptable.

## Invariants

1. A terminal session belongs to one native window and one active canonical project root.
2. No terminal command accepts an arbitrary working directory, executable, startup command, or
   repository-supplied environment.
3. Late output, resize results, and exit events are ignored unless their session identity and
   controller generation still match.
4. Hiding a terminal changes presentation only; Close and ownership disposal terminate it.
5. Terminal input/output never passes through Git or workspace domain state.
6. Terminal-created file and Git changes re-enter Asterlyn only through the existing native watcher
   and authoritative reconciliation path.
7. Every Start, Restart, Clear, Hide, and Close activation has immediate state feedback; asynchronous
   start and termination end in an explicit success, no-op, or failure result.

## Consequences

- Interactive shells and full-screen terminal applications can behave consistently across Unix PTY
  and Windows ConPTY without making Tauri's pipe-oriented shell API a domain dependency.
- The terminal has a measurable process and scrollback cost only after first use.
- One-session scope keeps lifecycle and resource ownership testable before tabs or tasks multiply
  concurrency.
- Shell startup files still affect the interactive shell exactly as they do in an external terminal;
  Asterlyn does not parse or reinterpret them.

## Revisit triggers

- Terminal tabs, splits, tasks, run configurations, remote workspaces, or session restoration require
  more than one session per window.
- Cross-platform acceptance finds that PTY closure does not reliably terminate a foreground process
  tree.
- Measured high-throughput output blocks the reader or UI despite bounded chunks and xterm buffering.
- Workspace trust or task discovery begins launching commands not typed directly by the user.
