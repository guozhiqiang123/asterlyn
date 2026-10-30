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

## Code-location Back / Forward — 2026-10-30 implementation plan

Add window/workspace-local source-location history behind registered customizable
`workbench.navigation.back` / `workbench.navigation.forward` commands. On macOS
ship Command+Option+Left/Right; other platforms retain custom binding support.
Use existing focus arbitration and avoid modal/settings/terminal interception.

History stores at most 100 project-document identities and UTF-16 selections,
never source buffers, hidden editors or persisted repository state. Record file
activation, explicit search/definition jumps and meaningful cursor selections;
coalesce ordinary cursor movement/dragging rather than storing every keystroke.
Editing maps existing locations through the editor's changes. Replay suppresses
new history, restores focus/selection and reveals the target. A new navigation
after Back discards Forward. Workspace changes clear history; targets are checked
against the current catalog, and closed files reopen through ordinary authorized
editor loading. Missing files are skipped, blocked opens preserve history, and
late loads cannot replay into another workspace. Source history excludes Diff,
conflict, image and synthetic dependency-preview documents in this first stage.

Validate bounded/coalesced history, edit mapping, branches, missing/closed files,
workspace cancellation and shortcut scope/conflict/customization. Use real rendered
editors in Chromium/WebKit, then a signed native package, canonical installation,
stored-icon reopen and actual Command+Option gestures with diagnostic receipts.
Android indexing work remains deferred by the user's latest priority.

### Implementation and acceptance — 2026-10-30

The commands now ship in the normal registry, palette and customizable keybinding
profile. `EditorNavigationHistory` owns bounded metadata; the CodeMirror adapter
reports selections and edit mappings, and the composition adapter authorizes file
reopening through the existing editor session. A new file activation also cancels
an outstanding replay. Command-click records the clicked source before requesting
a definition, so Back returns to that symbol rather than an unrelated old caret.
Search navigation coordination and navigation copy types were extracted into their
own modules; existing source ownership ceilings were retained.

- Functionality: `npm run check`, all **1,356** script tests, and the production
  build passed. Six history tests cover replay, selections, coalescing, edit
  mapping, branches, missing/blocked targets, bounds and asynchronous cancellation.
  Real Chromium/WebKit editors passed actual Command+Option arrow keys, cross-file
  and same-file restoration, closed-file reopening, edit mapping and Forward
  invalidation. The existing definition/reference gesture suite passed both engines.
- Performance/memory: a 150-navigation rendered exercise retains one editor DOM
  and at most 100 history locations. History owns identities and coordinates only;
  edit mapping scans that bounded list and disposal/project changes release it.
  The separate existing 20-cycle definition/menu check measured a local Chromium
  retained-heap delta of 170,004 bytes; this is a sample, not a universal memory bound.
- Accessibility: the commands use localized titles, existing command availability
  and focus scopes. Rendered and installed native checks restore editor focus and
  selected text through keyboard input. Dialogs, settings and the terminal keep
  their existing shortcut handling.
- Native delivery: the complete 0.1.22 bundle was ad-hoc signed and passed strict
  deep verification. A clean-instance rendered native smoke passed with a 30-second
  readiness window. Initial concurrent-instance attempts lacked the shell marker
  or exited normally; their logs are retained alongside the successful clean run.
  Canonical installation preserved application root inode `203606126` on device
  `16777234`; first launch and reopen both used the stored icon bookmark and
  recorded frontend readiness. Installed executable SHA-256 is
  `5be25955174566805c65b3cb17f78b49ac966d92aa86ff56316d3490724a3416`.
- Installed interaction: `.gitignore` selection `ci-artifacts/` → `package.json`
  selection `"private": true` → Back/Forward restored both exact selections.
  Same-file navigation restored the earlier selection and then the later selection.
  Session `session-1793327221478-23027-0` recorded four `editor.navigation` success
  events in Back/Forward/Back/Forward order (sequences 25–28).
- Evidence: `/tmp/asterlyn-navigation-20261030/` contains script/rendered/build
  logs, artifact and installation receipts, and `native-navigation.json`. The
  accepted ZIP is `Asterlyn-0.1.22-navigation-macos.app.zip`, 25,224,288 bytes,
  SHA-256 `d81a036d0434e3d166da3512014670c4de8b4c55c373dbf81bea1948e83ba4a2`.
  This is an uncommitted local acceptance build based on `b1edd139`; the worktree's
  separately edited Diff styling was preserved.

Known limits: history is session-local and source-editor-only; Diff/conflict/image
and synthetic dependency previews do not contribute locations. Back can return
from such a preview to the latest source location. External changes made while a
file is closed receive best-effort coordinate clamping when reopened, rather than
semantic relocation. macOS has shipped defaults; Windows/Linux accept custom
bindings but have no new default or native acceptance claim in this change.

### Manual acceptance — 2026-10-30

The user accepted the installed feature and authorized its commit. The final
reinstallation used a fresh 0.1.22 build based on `469a0e8`, including the same
navigation changes. Whole-bundle signing, strict verification, native rendering
and both stored-icon launches passed; the current `ads-framework` workspace was
preserved. The installation receipt is
`/tmp/asterlyn-local-install-20261030-103524/installation.json`; the installed
executable SHA-256 is
`45f91d6b6ff55309f8ca4a9133bf8289777fbfdd4de8e24c0c3f3d0834e893af`.
The final reopen recorded frontend readiness in
`session-1793327919440-28041-0`. No implementation changes were made after the
1,356-test, Chromium/WebKit and installed interaction acceptance above.
