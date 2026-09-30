# Keyboard shortcut management plan

- **Status:** Implemented; local automated acceptance complete, installed-app interaction pending
- **Date:** 2026-09-29
- **Scope:** Application-local command discovery, dispatch, customization, persistence, conflict
  handling, Settings presentation, and editor/terminal integration.

## Implementation checkpoint

KS0–KS6 were implemented on 2026-09-29. The shipped boundary uses stable command IDs, one
window-scoped command service, scope-indexed keybinding resolution, a separately versioned override
profile, cross-window reload, a dedicated Settings surface, and explicit xterm arbitration. The
window binding captures matched application commands before CodeMirror's internal keymap and leaves
unmatched events untouched; this gives user-defined editor-scope bindings deterministic precedence
without reconfiguring or recreating retained editor states. Component navigation and layered Escape
remain locally owned.

The accepted architecture is recorded in
[`ADR-0018`](../architecture/decisions/0018-command-and-keybinding-system.md), and validation evidence
is recorded in
[`2026-09-29-keyboard-shortcut-management`](../benchmarks/2026-09-29-keyboard-shortcut-management.md).

## Objective

Build one window-scoped shortcut system that makes every supported shortcut discoverable,
customizable, conflict-checked, and routed through the same command execution path as the command
palette and other application surfaces.

The completed system must provide:

1. stable command identities independent of labels, locale, UI placement, and default shortcuts;
2. platform-aware defaults plus user-defined replacement, additional, disabled, and reset states;
3. focus- and capability-aware dispatch that does not steal text from inputs, CodeMirror, dialogs,
   or the integrated terminal;
4. a dedicated **Keyboard Shortcuts** Settings section with search, recording, conflict repair, and
   per-command or global reset;
5. versioned, validated, cross-window synchronized persistence that stores only user overrides;
6. one execution and availability policy for the command palette, shortcut dispatcher, menus, and
   future native-menu accelerators;
7. deterministic lifecycle, performance, security, accessibility, and cross-platform gates.

This is an application-local system. Registering operating-system-wide global hotkeys is outside
this plan.

## Current-state audit

The existing code has useful pieces, but they do not yet form a shortcut system.

| Area | Current behavior | Consequence |
| --- | --- | --- |
| Window dispatch | `ShellEventBinding.handleWindowKeydown` hard-codes command palette, workspace search, quick open, recent files, refresh, save, find, and layered Escape behavior. | Shortcut matching is coupled to shell composition callbacks and cannot be listed, replaced, or conflict-checked. |
| Command palette | `AsterlynApp.navigationCommands()` creates a separate list and `executeNavigationCommand()` owns a separate switch. | Palette and keyboard routes can drift. `Open Repository` currently advertises the primary+O shortcut even though the global handler does not implement it. |
| Editors | Text, Diff, and editable Diff each install CodeMirror keymaps. `Mod-f` is repeated; editable Diff also owns `Mod-s`. | A window-only dispatcher cannot safely customize these keys without a CodeMirror adapter. |
| Terminal | xterm receives its input directly and has no application-shortcut arbitration layer. | A broad global listener could send application shortcuts to the PTY or steal terminal control sequences. |
| Settings | `SettingsController` selects five sections and `PreferenceStore` persists schema-v8 scalar application preferences in one local-storage record. | A structured, independently evolving keymap would enlarge the general preference schema and its shallow equality path. |
| Local keyboard behavior | Dialogs, lists, splitters, selects, search fields, and project rows own local Escape, Tab, Enter, Space, and arrow-key behavior. | These are component interaction contracts, not application commands, and must not be pulled indiscriminately into customization. |
| Presentation | Shortcut labels are produced ad hoc through `primaryShortcut()` and command metadata stores a display string. | Labels can disagree with the effective user binding and cannot update after customization. |

The first implementation goal is therefore not a Settings table. It is one command and dispatch
boundary; the Settings UI becomes a client of that boundary.

## Scope and non-goals

### Included

- application commands with stable IDs, localized metadata, availability, execution, and default
  keybinding contributions;
- one- and two-stroke shortcuts, for example `Primary+P` and `Primary+K Primary+S`;
- platform-neutral `Primary` defaults displayed as Command on macOS and Control elsewhere;
- user replacement, additional binding, disable-default, reset-command, and reset-all operations;
- exact and prefix conflict detection across focus scopes;
- cross-window reload when a profile changes;
- command-palette and visible shortcut-label integration;
- curated CodeMirror command integration and terminal pass-through arbitration;
- English and Simplified Chinese Settings copy and accessible shortcut descriptions.

### Excluded from the first release

- operating-system-wide hotkeys while Asterlyn is unfocused;
- arbitrary macros, scripts, shell commands, command arguments, or conditional expressions supplied
  by the user;
- workspace/repository-provided keymaps, because they introduce a separate trust and precedence
  model;
- cloud synchronization and named keymap profiles;
- Vim/Emacs emulation layers;
- customization of focus trapping, list navigation, text composition, or other widget semantics;
- import/export until the on-disk schema and validation behavior have survived the first release.

## Non-negotiable design rules

1. **Commands and keybindings are separate.** A command owns behavior; a keybinding refers to the
   command by stable ID. Labels and shortcuts never identify behavior.
2. **Features retain business ownership.** The central registry may describe and invoke a feature
   contribution, but must not reimplement Git, Files, Editor, Terminal, or Settings policy.
3. **The composition root does not become the command switch.** `AsterlynApp` wires contributions;
   it must not acquire another growing command-ID switch or keydown branch.
4. **Availability is revalidated at invocation.** A shortcut is only another invocation route and
   cannot bypass current workspace identity, dirty-buffer, exact-object, authorization, or busy
   checks.
5. **Only handled events are consumed.** Composition, dead-key, unknown, unmatched, and terminal
   pass-through events retain native behavior. Pending chords and matched commands are consumed.
6. **Accessibility navigation is not a keymap.** Tab, arrow, Enter, Space, and layered Escape remain
   with the component or dialog unless a separately registered application command is justified.
7. **Defaults evolve independently of users.** Persistence stores overrides against stable binding
   IDs, never a copied resolved keymap.
8. **No arbitrary execution from storage.** Persisted data can name a registered command and key
   sequence only; it cannot contain code, command arguments, shell text, or predicates.
9. **One owner per listener and timer.** Window listeners, chord timers, store subscriptions, editor
   adapters, and terminal adapters all have idempotent disposal.

## Target architecture

### 1. Command layer

Add a browser-independent, window-scoped command layer under `src/application/commands/`:

- `command-model.ts` — branded `CommandId`, localized metadata keys, categories, availability, and
  invocation-source types;
- `command-registry.ts` — registration, duplicate-ID rejection, ordered discovery, and disposable
  unregister operations;
- `command-service.ts` — current availability check, invocation, async error routing, visible blocked
  reason, and in-flight policy;
- `command-contribution.ts` — the narrow feature contribution contract.

A contribution has this conceptual shape:

```ts
interface CommandContribution {
  readonly id: CommandId;
  readonly category: CommandCategory;
  readonly titleKey: string;
  readonly detailKey?: string;
  readonly keywordsKey?: string;
  readonly userBindingScopes: readonly KeybindingFocusScope[];
  availability(): CommandAvailability;
  execute(source: CommandInvocationSource): void | Promise<void>;
}
```

The registry owns discovery, not feature state. Closures supplied by the owning runtime read the
current feature state immediately before execution. The command service catches failures and uses
the existing feedback path; feature controllers retain cancellation, exact-object checks, and
authoritative reconciliation.

The command palette must consume the registry projection. Buttons, menus, and future native menus
may invoke `CommandService`, so enabled state and feedback no longer drift by entry point.

### 2. Keybinding layer

Add a feature-owned subsystem under `src/features/keybindings/`:

- `keybinding-model.ts` — strokes, sequences, default rules, resolved rules, profile overrides, and
  dispatch results;
- `keybinding-normalizer.ts` — event capture, canonicalization, platform-primary mapping, formatting,
  and accessible labels;
- `keybinding-context.ts` — typed focus/capability snapshot and overlap matrix;
- `keybinding-resolver.ts` — compiled lookup, chord state, precedence, and conflict analysis;
- `keybinding-store.ts` — schema validation, local persistence, cross-window reload, and change
  notifications;
- `keybinding-controller.ts` — search/filter/edit/reset/conflict UI state;
- `keybinding-view.ts` and `keybindings.css` — Settings presentation only.

The shared resolver is pure TypeScript and has no DOM, storage, CodeMirror, xterm, or feature
imports. A composition runtime supplies registered commands, default binding contributions, the
current platform, and a typed context snapshot.

### 3. Event and adapter ownership

- `src/shell/window-keybinding-binding.ts` owns exactly one bubbling window `keydown` listener, one
  chord timeout, and its `AbortController`.
- `ShellEventBinding` retains shell clicks, window lifecycle, focus traps, pointer dismissal, and
  layered Escape until those behaviors have separately justified commands. Its hard-coded
  application shortcuts are removed as they migrate.
- `src/features/files-editor/editor-keybinding-adapter.ts` projects supported resolved bindings into
  CodeMirror through a reconfigurable `Compartment`. Text, Diff, and editable Diff stop repeating
  their own application bindings.
- `src/features/terminal/terminal-keybinding-adapter.ts` integrates through xterm's custom key event
  handler. Only commands explicitly allowed in terminal focus are intercepted; all other keystrokes
  continue to the PTY.
- `src/composition/keybinding-runtime.ts` owns registrations, store/resolver/controller lifetime, and
  adapter wiring. It exposes narrow projections and callbacks instead of adding keymap state to
  `AppState`.

### 4. Focus and context model

Each event receives one primary focus scope:

```text
dialog | shortcut-recorder | settings | terminal | text-editor | diff-editor |
history | files | changes | branches | workbench-input | workbench
```

The snapshot also carries typed capabilities such as workspace open, Git repository available,
editable document active, dirty document, modal open, and command surface open. Application code
may define predicates from these fields; users cannot author expressions in v1.

The distinction is important:

- **focus scope** decides whether a binding is eligible and which surface has precedence;
- **command availability** decides whether the eligible command can execute now and supplies a
  reason when blocked.

An in-scope matched command is consumed even when currently unavailable, then reports its blocked
reason. An out-of-scope or unmatched binding is not consumed.

## Key representation and matching

### Canonical sequence

```ts
type KeySequence = readonly [KeyStroke] | readonly [KeyStroke, KeyStroke];

interface KeyStroke {
  readonly key: string;
  readonly primary: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}
```

- `key` is derived from normalized `KeyboardEvent.key`, so a shortcut follows the character a user
  recorded under the active keyboard layout rather than a hidden physical scan position.
- Alphabetic keys are case-normalized; Shift remains an explicit modifier.
- Named keys use a fixed catalog (`Enter`, `Escape`, `ArrowLeft`, `F1`, and so on).
- The platform command modifier is stored as `primary`; on macOS it maps to Meta and elsewhere to
  Control. A separately pressed macOS Control or non-macOS Meta remains explicit.
- Modifier-only input, `Dead`, `Process`, `Unidentified`, active IME composition, and AltGraph-derived
  ambiguous events are rejected by the recorder.
- A sequence contains at most two strokes. Unlimited sequences increase ambiguity and accessibility
  cost without a current product need.

### Dispatch order

1. Ignore disposed bindings, IME composition, dead/unknown keys, and already handled component
   events.
2. Let shortcut recording own all recordable keys without invoking commands.
3. Let an open modal or component-local accessibility handler retain its keys.
4. Resolve editor or terminal adapters when those surfaces own focus.
5. Resolve focused-tool bindings, then workbench bindings.
6. If the first stroke is a valid chord prefix, consume it, show a non-modal “waiting for second
   key” status, and expire after 1.2 seconds.
7. Execute one winning command or report a blocked reason. If nothing matches, preserve native
   behavior.

`event.repeat` is ignored unless the command explicitly declares that repetition is safe. A rule may
not be both a complete sequence and a prefix of another rule in an overlapping scope; conflict
validation prevents timeout-dependent behavior.

## Default rules, precedence, and conflicts

Every shipped rule receives a stable binding ID distinct from its command ID:

```ts
interface DefaultKeybindingRule {
  readonly id: string;
  readonly commandId: CommandId;
  readonly sequence: KeySequence;
  readonly scopes: readonly KeybindingFocusScope[];
  readonly platform?: "macos" | "windows" | "linux";
  readonly terminalPolicy?: "intercept" | "pass-through";
}
```

Effective rules are resolved in this order:

1. platform-reserved combinations that the recorder rejects;
2. user replacements or disabled shipped rules;
3. user-added alternatives;
4. shipped platform-specific rules;
5. shipped cross-platform rules.

Conflict policy:

- an exact duplicate in overlapping scopes is a hard conflict;
- a one-stroke sequence that prefixes a two-stroke sequence in overlapping scopes is a hard
  conflict;
- the same sequence in provably disjoint focus scopes is allowed and displayed as contextual;
- replacing a conflicting binding requires an explicit **Replace** action that removes only the
  identified conflicting override/default slot; silent reassignment is forbidden;
- operating-system/window lifecycle combinations and unavailable WebView combinations are rejected;
- common text-editing combinations are protected in editable fields and require an explicit
  application command plus compatible scope before they can be captured;
- terminal control sequences remain pass-through unless the target command contribution explicitly
  opts into terminal interception.

The platform-reserved table is versioned and tested rather than embedded as scattered conditionals.
It includes combinations never delivered by an operating system as well as Asterlyn window-lifecycle
combinations that do not yet have a safe customizable contract.

## Persistence and synchronization

Do not add keybindings to `AppPreferences`. The profile has a separate owner, schema, storage key,
and synchronization channel:

```ts
interface KeybindingProfileV1 {
  readonly version: 1;
  readonly revision: number;
  readonly replacements: readonly {
    readonly bindingId: string;
    readonly commandId: string;
    readonly sequence: KeySequence | null;
  }[];
  readonly additions: readonly {
    readonly id: string;
    readonly commandId: string;
    readonly sequence: KeySequence;
  }[];
}
```

- Storage key: `asterlyn.keybindings.v1`.
- `null` replacement disables one shipped binding without deleting knowledge of it.
- Additions inherit the command's declared user-binding scopes; users cannot inject predicates.
- Every write re-reads and applies a targeted mutation before incrementing `revision`, so serialized
  edits from different windows do not erase unrelated overrides.
- A dedicated BroadcastChannel plus the storage event reloads other windows. The source window does
  not process its own signal.
- Unknown command and binding IDs survive version changes or feature absence and appear as orphaned
  overrides that the user may remove; they never execute.
- Invalid profiles fall back to shipped defaults, emit a visible recoverable Settings diagnostic,
  and are not silently overwritten before the user resets them.
- Parsing accepts at most 2,048 overrides, two strokes per sequence, bounded string lengths, and a
  256 KiB serialized profile. Excess or malformed input fails closed.

Import/export can be added later against this same schema after compatibility policy is accepted.

## Settings experience

Add `keybindings` to `SettingsSection` and add localized navigation copy **Keyboard Shortcuts / 快捷键**.
The page is a specialized feature view rather than a collection of ordinary scalar setting rows.

### Page layout

- sticky search field that matches localized command name, category, command ID, aliases, and a
  typed shortcut such as `cmd shift p`;
- filters for **All**, **Modified**, **Conflicts**, and category;
- table/list columns for command, effective shortcuts, focus context, and source/status;
- badges for default, modified, disabled, conflict, unavailable, and unknown command;
- row actions: record/replace primary, add alternative, remove alternative, disable default, reset
  command;
- a guarded **Reset all shortcuts** action with confirmation and a precise modified-count summary;
- current effective shortcuts formatted from the resolver, never copied from static command labels.

### Recorder behavior

- activating a row enters an inline recorder with focus and an announced instruction;
- one or two strokes are shown as they are captured;
- Enter accepts a valid sequence, Escape cancels, and Backspace/Delete clears the current sequence;
- IME and modifier-only events do not finish capture;
- conflicts are shown before persistence with the conflicting command, scope, and source;
- **Replace** is explicit; **Cancel** preserves both existing bindings; no silent swap occurs;
- saving restores focus to the edited row and announces the result through a polite live region.

Relevant buttons, command rows, and menu items update shortcut badges and `aria-keyshortcuts` from
the effective binding. Decorative `kbd` text alone is not considered accessible discovery.

## Editor and terminal integration

### CodeMirror

CodeMirror's default editing/navigation keymap remains an editor implementation detail until a
specific action is promoted to a registered Asterlyn command. The first migration covers:

- find in current editor;
- save current editable document;
- folding commands already exposed as product shortcuts;
- future editor commands only after they can execute against the active editor through a stable
  adapter.

The adapter uses one reconfigurable compartment per retained editor state. A profile update
reconfigures mounted and cached editor states without recreating documents, losing history, or
mounting hidden views. Read-only Diff never receives mutation commands; editable Diff receives save
only through the same command service.

### Terminal

xterm receives every key by default. Its adapter asks the shared resolver whether a binding is both
matched and explicitly allowed in terminal focus. Only then does it suppress PTY input and invoke
the application command. Shell control sequences such as Control+C, Control+Z, Control+D, and normal
text input are not intercepted by generic workbench bindings.

The command palette may be allowed in terminal focus through an explicit rule; opening it must not
send either chord stroke to the shell.

## Initial command migration

Migrate the existing application shortcuts without changing their user-visible defaults:

| Stable command ID | Current/default route |
| --- | --- |
| `workbench.commandPalette.open` | Primary+Shift+P |
| `workspace.quickOpen.open` | Primary+P |
| `workspace.recentFiles.open` | Primary+E |
| `workspace.search.open` | Primary+Shift+F |
| `editor.find.open` | Primary+F in editor/Diff scopes |
| `editor.file.save` | Primary+S in editable editor scopes |
| `workbench.refresh` | Primary+R |
| `workspace.repository.open` | Primary+O; this closes the current palette/dispatcher mismatch |
| `workbench.tool.files.toggle` | initially unbound |
| `workbench.tool.changes.toggle` | initially unbound |
| `workbench.tool.branches.toggle` | initially unbound |
| `workbench.tool.terminal.toggle` | initially unbound |

History filter focus keeps Primary+F in its mutually exclusive history-focus scope. Layered Escape,
focus traps, list navigation, splitter movement, select navigation, command-surface row navigation,
and ordinary text editing remain component-local in the first release.

## Delivery sequence

### KS0 — Characterization and architecture baseline

1. Land this plan and an inventory test for every current application shortcut and visible label.
2. Record reserved platform combinations and the focus-scope overlap matrix.
3. Add ownership gates that prevent new application shortcuts from being added directly to
   `ShellEventBinding` or `AsterlynApp`.

**Gate:** no behavior changes; existing shortcut tests and full frontend checks remain green.

### KS1 — Command foundation

1. Add the command registry/service/contribution types and lifecycle tests.
2. Register the current navigation commands through feature/composition contributions.
3. Make the command palette read the registry and invoke the command service.
4. Keep current keyboard routing temporarily, but make it invoke command IDs rather than feature
   callbacks.

**Gate:** palette order, localization, enabled state, feedback, and current shortcuts are unchanged;
palette and direct invocation execute the same handler in tests.

### KS2 — Resolver and window routing

1. Implement normalization, formatting, context snapshots, compiled lookup, chords, conflict
   detection, and reserved-key validation as pure modules.
2. Add the disposable window binding and move migrated application shortcuts out of
   `ShellEventBinding`.
3. Derive visible shortcut labels from resolved defaults.

**Gate:** exactly one global application-shortcut listener exists; no duplicate invocation occurs;
IME, input, modal, repeat, unavailable, and chord-timeout behavior are covered.

### KS3 — Profile persistence

1. Add `KeybindingStore`, schema validation, targeted mutations, cross-window signals, and invalid
   profile diagnostics.
2. Resolve shipped defaults with user replacement/addition/disable operations.
3. Preserve orphaned overrides and provide reset operations.

**Gate:** upgrades change untouched defaults, user overrides survive reloads, sequential multi-window
edits preserve unrelated changes, corrupt/oversized input fails closed, and no arbitrary data reaches
command execution.

### KS4 — Settings management UI

1. Add the Settings navigation entry, specialized controller/view/styles, localized copy, search,
   filters, and effective binding rows.
2. Add the accessible recorder, exact/prefix conflict review, add/remove/disable/reset, and reset-all
   confirmation.
3. Keep row identity and focus stable during edits and external profile reloads.

**Gate:** all operations work with keyboard only, conflict changes are never silent, screen-reader
names/status are meaningful, and English/Chinese layouts pass constrained-width browser checks.

### KS5 — Editor, terminal, and presentation integration

1. Add the CodeMirror compartment adapter and remove duplicated application `Mod-f`/`Mod-s`
   definitions where the shared system owns them.
2. Add xterm pass-through arbitration with explicit terminal-allowed commands.
3. Update command palette, command center, menus, buttons, tooltips, and `aria-keyshortcuts` from the
   effective profile.

**Gate:** editors retain document/history/scroll state after profile edits; terminal control and text
input are unchanged; shortcut labels update live in every open window.

### KS6 — Hardening and release acceptance

1. Exercise macOS, Windows, and Linux reserved keys, layouts, modifier labels, dead keys, IME, modal
   focus, editor focus, terminal focus, and multiple windows.
2. Run performance, lifecycle, malformed-profile, accessibility, build, package, install, and manual
   acceptance gates.
3. Record final evidence in a dated benchmark document and convert the accepted architecture into an
   ADR.

## Performance and resource budgets

- Compile resolved bindings into scope-indexed maps and a two-level chord trie; do not scan all
  commands on each keydown.
- Dispatch p95 must remain below 1 ms for 2,000 effective bindings on the reference development
  machine.
- Settings search must complete below 50 ms for 5,000 command rows. Introduce row windowing before
  the catalog exceeds 300 visible rows rather than mounting an unbounded list.
- Profile parsing must remain below 10 ms at its accepted 256 KiB maximum.
- Keydown must not trigger a workbench render. Only chord status, availability feedback, or command
  effects may update presentation.
- One resolver, one store subscription, one global listener, and at most one chord timer exist per
  window. Disposal leaves no window/document listeners, timers, observers, or editor/terminal
  callbacks.

## Security and stability contract

- A binding invokes only a command already registered by trusted application code.
- Profiles contain no command arguments, filesystem paths, repository identities, URLs, scripts, or
  shell fragments.
- Command execution revalidates all business and authorization state at invocation time.
- Unknown and unavailable commands cannot execute; a rejected command produces bounded feedback and
  never throws through the DOM event loop.
- Registry disposal cancels pending chords that reference removed contributions.
- Async command policy is explicit per command (`allow`, `drop-while-running`, or feature-owned
  cancellation); key repeat cannot accidentally start concurrent Git or workspace mutations.
- Storage failures keep the in-memory effective profile unchanged and report a recoverable Settings
  error. A failed write is never presented as saved.
- No repository file may install or override shortcuts in this phase.

## Validation matrix

| Gate | Required evidence |
| --- | --- |
| Model | normalization, platform-primary mapping, formatting, one/two-stroke parsing, and invalid-key property tests |
| Resolver | exact match, disjoint/overlapping scope, prefix conflicts, priority, timeout, repeat, unavailable, and disposal tests |
| Store | defaults, replace/add/disable/reset, schema bounds, corrupt storage, orphan retention, revision, and cross-window reload tests |
| Command service | duplicate registration, unregister, availability recheck, async rejection, in-flight policy, and invocation-source tests |
| Shell | one listener, no duplicate dispatch, IME/dead-key/input/modal preservation, and no new hard-coded application shortcuts |
| Editor | text/Diff/editable-Diff focus, dynamic reconfigure, save/find/fold, read-only protection, and retained state tests |
| Terminal | ordinary input and control-sequence pass-through, explicitly allowed interception, chord suppression, and dispose tests |
| Settings | localized discovery, capture, conflicts, keyboard-only editing, focus restoration, live-region feedback, and reset tests |
| Presentation | command palette, tooltip/`kbd`, and `aria-keyshortcuts` all show the effective binding after live changes |
| Performance | 2,000-binding dispatch, 5,000-command search, bounded DOM, parse budget, idle CPU, and listener/timer census |
| Project gates | `npm run check`, `npm run test:scripts`, `npm run build`, ownership/style gates, and `git diff --check` pass |
| Installed app | packaged macOS, Windows, and Linux smoke covers defaults, customization, reload, editor, terminal, and reserved shortcuts |

## Manual acceptance checklist

- Change Primary+P, close Settings, reopen quick open with the new key, restart the app, and verify the
  change remains.
- Add a second command binding without losing the default; remove it and reset the command.
- Disable one default and verify it no longer appears in the palette or `aria-keyshortcuts` output.
- Attempt exact and prefix conflicts and verify nothing changes until **Replace** is confirmed.
- Use the same sequence in two disjoint focus scopes and verify each surface executes its own command.
- Edit Chinese text with an IME and type dead-key/AltGraph characters without opening application
  commands.
- Use find/save in text editor, read-only Diff, and editable Diff; verify only valid commands execute.
- Run terminal Control+C/Control+Z/Control+D and ordinary text, then open an explicitly allowed
  application command; verify only that command is intercepted.
- Open two application windows, edit a binding in one, and verify the other updates without restart.
- Corrupt the stored profile in a test build and verify defaults remain usable with a visible reset
  path.
- Reset all shortcuts and verify the current platform defaults, labels, and command palette agree.

## Rollback strategy

KS1 through KS5 are separate rollback units. During migration, each command has exactly one active
keyboard owner; the old hard-coded branch is removed in the same change that enables its resolved
rule. The separate profile key means disabling the new Settings surface does not alter general
preferences. User overrides remain dormant and recoverable if a feature contribution is rolled back,
because unknown IDs are retained but never executed.

No implementation phase is complete until its focused tests, full frontend suite, build, lifecycle
census, and ownership gates pass. Packaging and installed-app verification are mandatory at KS6, not
assumed from browser behavior.
