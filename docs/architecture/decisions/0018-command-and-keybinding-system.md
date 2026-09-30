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

A stable shipped rule may declare a platform-specific sequence while retaining one binding ID.
This lets verified platform conventions evolve without orphaning a user's replacement or disabled
state. Platform compatibility sets are authored as Asterlyn configuration from equivalent action
semantics; external IDE keymaps are never loaded at runtime or copied into the repository.

Each key event is assigned one primary focus scope. Files, Changes, Search, Stash, History, Editor,
and Diff use mutually exclusive surface scopes; editable controls use `input`, with a dedicated
`history-input` scope retaining only History's find contract. Remote review, replacement review,
and generic dialogs are also separate, while the nested Push Diff is classified as Diff. A shipped
binding's scopes must be declared by its command, and surface commands may not declare another
surface's scope. Architecture tests enforce both invariants and dispatch the same reused shortcut
through every eligible and ineligible surface.

The event target is the focus-scope authority. All CodeMirror families install one shared
focus-ownership extension because a read-only CodeMirror content node otherwise loses native focus
when `contenteditable` is removed even though selection remains visible. The extension gives only
read-only content an explicit tab stop and focuses it on pointer interaction; it does not change the
separate read-only or editable facets. Text, historical Diff, editable Diff, and conflict views must
retain this contract so their application commands cannot fall through to a stale outer surface.

The resolver compiles exact sequences and two-stroke prefixes by focus scope. It rejects IME,
dead-key, AltGraph, modifier-only, window-reserved, accessible-navigation, and unsafe text-editing
captures. Exact and prefix conflicts require an explicit replacement. Unknown command overrides
survive upgrades but never execute.

On macOS, Option can transform `KeyboardEvent.key` into a symbol or dead key even though desktop
shortcut conventions name the underlying letter or digit. For Option-modified alphanumeric strokes,
normalization therefore uses `KeyboardEvent.code` only to recover that stable base key; all other
strokes retain logical-key matching. This keeps displayed, recorded, and dispatched shortcuts such
as Option+S and Command+Option+N consistent without changing IME or AltGraph fail-closed behavior.

One capture-phase window listener owns application-command routing. Capturing lets a matched custom
editor binding take deterministic precedence over CodeMirror without rebuilding retained editor
states; unmatched events continue unchanged. Settings/dialog scopes retain their local behavior.
xterm uses its custom key-event boundary and intercepts only `keydown` events for rules explicitly
allowed in terminal focus, so ordinary text and terminal control sequences remain PTY input.

Settings provides localized discovery, search, state/category filters, recording, conflict display,
add/replace/disable/reset operations, invalid-profile repair, and live effective shortcut labels.

Configurable shortcut text has one presentation owner. Render templates and localization catalogs
must not embed a command's default combination. Instead, command controls expose an initially empty
and hidden `data-command-shortcut` target; the window shortcut projector fills its compact primary
label, derives the control title from every effective binding, and derives `aria-keyshortcuts` from
every representable effective binding. Profile
changes refresh those projections in place, while disabling the last binding clears and hides stale
text and removes stale accessibility metadata. Context-menu models likewise identify commands and
may not carry an independent raw shortcut label.

Because ARIA has no notation for sequential chords, `aria-keyshortcuts` includes only effective
single-stroke bindings; the full accessible title still describes every binding, including chords.
Composite entry points must not advertise one child mode's shortcut as their own. Their individual
mode controls own those dynamic hints instead.

Component-local keyboard behavior remains separate. Fixed widget semantics such as list arrows,
Enter/Escape, or a dialog-only submit gesture may be described locally, but any platform-dependent
text is produced by the shared key-sequence formatter rather than written as `Ctrl/Cmd` prose. Local
help is marked explicitly so ownership tests can distinguish it from configurable command hints.

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
- A command binding, its visible hint, tooltip, and accessibility metadata cannot drift because they
  are all projections of the same effective per-window profile.
- Per-window listener, store, chord timer, subscriptions, and terminal adapter have explicit disposal.
- Native global hotkeys, repository-provided keymaps, macros, arbitrary conditions, and profile
  import/export remain out of scope.
- Windows and Linux installed interaction remain release-platform gates; the local macOS package is
  evidence for this host only.
