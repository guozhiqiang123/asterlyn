# ADR-0018: Window-scoped command and customizable keybinding system

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Asterlyn previously implemented application shortcuts in `ShellEventBinding`, repeated find/save
bindings inside several CodeMirror configurations, and maintained a separate command-palette switch.
Those paths could drift, had no stable discovery model, and could not safely support user-defined
shortcuts, conflict repair, terminal pass-through, or cross-window updates.

## Decision

Each desktop window owns one command registry and service. Commands have stable IDs, localized
metadata closures, declared user-binding focus scopes, current availability, and one execution
closure. Keyboard dispatch and the command palette invoke the same service, which rechecks
availability, drops duplicate in-flight execution, and contains asynchronous failures.

Keybindings are a separate feature. Shipped rules refer to command IDs and stable binding IDs. User
state stores only replacements, disabled defaults, and additions under the versioned
`asterlyn.keybindings.v1` key. Parsing is bounded and fail-closed; profiles contain no arguments,
paths, scripts, or predicates. A dedicated synchronization channel reloads other windows.

The resolver compiles exact sequences and two-stroke prefixes by focus scope. It rejects IME,
dead-key, AltGraph, modifier-only, window-reserved, accessible-navigation, and unsafe text-editing
captures. Exact and prefix conflicts require an explicit replacement. Unknown command overrides
survive upgrades but never execute.

One capture-phase window listener owns application-command routing. Capturing lets a matched custom
editor binding take deterministic precedence over CodeMirror without rebuilding retained editor
states; unmatched events continue unchanged. Settings/dialog scopes retain their local behavior.
xterm uses its custom key-event boundary and intercepts only `keydown` events for rules explicitly
allowed in terminal focus, so ordinary text and terminal control sequences remain PTY input.

Settings provides localized discovery, search, state/category filters, recording, conflict display,
add/replace/disable/reset operations, invalid-profile repair, and live effective shortcut labels.

The durable user-action and shortcut ledger is maintained by product surface in
[`keyboard-shortcut-coverage.md`](../keyboard-shortcut-coverage.md). Every new user-visible action
must be classified there as a registered customizable command, component-local keyboard behavior,
or an explicitly justified exclusion. This classification, localized command metadata, and an
explicit default-binding decision are part of the feature's definition of done rather than a later
shortcut-system cleanup.

## Consequences

- Keyboard, palette, and future menu routes share command availability and execution behavior.
- New application commands require a registry contribution rather than another shell keydown branch.
- New user-facing controls require a same-change entry in the per-surface shortcut ledger; commands
  ship discoverable and customizable even when risk or conflicts justify leaving the default empty.
- Per-window listener, store, chord timer, subscriptions, and terminal adapter have explicit disposal.
- Native global hotkeys, repository-provided keymaps, macros, arbitrary conditions, and profile
  import/export remain out of scope.
- Windows and Linux installed interaction remain release-platform gates; the local macOS package is
  evidence for this host only.
