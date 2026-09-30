# Android Studio macOS keymap defaults — 2026-09-30

## Outcome

Asterlyn's macOS shipped defaults now include 45 rules covering 41 commands. The added compatibility
set is derived from the effective Android Studio 2026.1.4 keymap `macOS copy1`, whose parent is
`Mac OS X 10.5+`. Windows and Linux continue to resolve the original ten platform-neutral defaults.

The source inspection combined the active keymap selector, its personal override file, the bundled
parent keymap, and the running IDE's accessible menu shortcut values. No Android Studio keymap,
implementation source, or branded asset is stored in Asterlyn, and Android Studio is not a runtime
dependency.

## Accepted behavior

- macOS tool windows use Command+1 Files, Command+3 Search, Command+0 Changes, Command+9 Branches
  and Log, and Option+F12 Terminal.
- Files receives the compatible locate, open, create, rename, cut/copy/paste, and recursive
  expand/collapse bindings.
- Editor tabs and Diff navigation share Control+Shift+arrow combinations only in disjoint focus
  scopes. F4 and Option+S likewise resolve to the active Files, Changes, History, or Diff semantic
  target.
- Git entry points use Command+T Update, Command+Shift+K Push review, Command+Option+N Create Branch,
  Command+R Rename Branch, and Control+V Git Operations.
- The user's active IDE keymap removes Refresh and uses Command+R for Rename. Asterlyn therefore
  resolves its stable Refresh binding ID to Command+Shift+Y on macOS, matching the inspected Reload
  All from Disk menu action, while Windows/Linux retain Control+R.
- Direct discard, delete, reset, and restore actions remain unassigned. Existing review,
  confirmation, revalidation, and recovery routes are unchanged.

## Compatibility limits

- Android Studio's modifier-only Search Everywhere gesture cannot be represented by Asterlyn's
  intentional one- or two-keystroke command model; Asterlyn's existing command-surface default is
  retained.
- Actions explicitly unassigned in `macOS copy1`, IDE-only actions, and actions without equivalent
  safety semantics are not guessed or transferred.
- Command+W remains reserved for native window lifecycle. Close Editor Tab uses Android Studio's
  alternative Control+Shift+F4 binding.
- Shifted bracket shortcuts are matched through the browser's logical `{` and `}` key values; the
  architecture continues to follow `KeyboardEvent.key` rather than physical scan codes.

## Verification

| Gate | Result |
| --- | --- |
| TypeScript check | passed |
| Focused normalization, platform resolution, conflict, safety, and dispatch tests | 12 passed |
| Full frontend/delivery suite | 801 passed |
| Production frontend build | passed; main chunk 424.59 kB, below the 500 kB budget |
| Default-rule audit | 45 macOS rules, 41 commands, no exact or prefix conflict in overlapping scopes |
| Keybinding stress benchmark | dispatch p95 0.003 ms; Settings search p95 39.789 ms; profile parse p95 3.890 ms |

The latest macOS arm64 acceptance archive is
`.artifacts/packages/Asterlyn-readonly-diff-focus-20260930-150152.zip` (8,979,696 bytes), SHA-256
`5cd2c7c1499cb826b5924c62d7a3f8677e61483c280fa469176d528ef5269dd4`. The application is ad-hoc
signed with hardened runtime and passes `codesign --verify --deep --strict`. Its executable SHA-256
is `761177eae35c502587199201fa315708a570ab2742f95c449844c881a5100436`; the installed executable at
`/Applications/Asterlyn.app` matches it exactly. The previous installation is recoverable from
`/Users/gzq/.Trash/Asterlyn-before-readonly-diff-focus-20260930-150152.app`. The installed native
smoke rendered the application shell within the 6,000 ms gate, and PID 1730 remained live after the
installed app was relaunched for manual interaction.

## macOS keycap typography correction

Installed inspection found that the Keyboard Shortcuts list inherited the configurable editor font.
JetBrains Mono rendered ordinary keys such as `F4`, while macOS modifiers and arrows fell back to
other glyph fonts with visibly different size and baseline metrics. Shortcut pills and the recorder
now use one explicit system UI/symbol font stack with a fixed UI-relative size, weight, line height,
and tabular numerals. The presentation no longer changes when the editor font preference changes.
An ownership test locks this separation so the shortcut keycaps cannot silently return to the
editor-font variable.

## Context-routing correction

The initial compatibility pass still collapsed Files and Changes into the broad `workbench` focus
scope. That allowed contextual shortcuts such as Command+R, F4, and Option+S to resolve against a
different panel's retained selection. The routing model now assigns one mutually exclusive scope to
Files, Changes, Search, Stash, History, Editor, and Diff. Remote review, replacement review, generic
dialogs, and History text input are isolated separately; ordinary inputs do not inherit their parent
surface's commands. Shared workbench scopes are centralized so global commands remain available
without widening feature commands.

The regression gates now verify the complete surface matrix, reject exact and prefix conflicts,
require every shipped rule scope to be declared by its command, and assert that contextual command
families cannot leak into another surface. In particular, F4 and Option+S dispatch to Files open,
Changes source, Diff source, or History current-file actions only in their matching focus scope.

## Native Option-key correction

Installed interaction then exposed a native-event mismatch hidden by the original synthetic tests.
On macOS, Option+S may report `KeyboardEvent.key` as `ß`, while Command+Option+N can report a dead
key. The shipped rules and Settings UI correctly represented the base keys `S` and `N`, so those
native events did not match. The normalizer now recovers the base alphanumeric key from
`KeyboardEvent.code` only for macOS Option strokes. Regression fixtures use the actual `ß` and dead
key event shapes and verify Option+S dispatch across Files, Changes, Diff, and History scopes.

## Read-only editor focus correction

Installed interaction also showed that selecting text inside a historical read-only Diff did not
make that Diff the browser's keyboard owner. CodeMirror removes `contenteditable` for these panes;
the text selection remained visible while the key event target stayed outside `.cm-editor`, so the
otherwise-correct Diff-scoped Option+S rule was ineligible. A shared focus-ownership extension now
makes read-only content explicitly focusable and transfers pointer focus without granting mutation
rights. Ordinary text editors, historical Diffs, editable Diffs, and conflict projections all
install the same contract, and context-menu focus restoration now targets CodeMirror content rather
than its outer shell.
