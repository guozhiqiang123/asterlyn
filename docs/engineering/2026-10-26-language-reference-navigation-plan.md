# Declaration and reference selection — 2026-10-26

Status: planned before implementation. Baseline: `7a71d92`.

The user asks to choose among multiple references and align navigation with Android Studio and
VS Code. The previous iteration handles several **definitions**, but does not query **references**.
These are distinct language requests; a symbol having many uses must not make an ordinary jump
from a use to its single definition ambiguous.

## Contract and references

- A use's Ctrl/Command-click or F12 queries its definition. One foreign target opens directly.
  Several definitions require a picker; do not choose the first silently.
- When the only definition is the symbol containing the original hit/caret in the same buffer,
  query references instead of jumping to the same selection. This is our declaration/usages
  convenience behavior. Shift+F12 explicitly queries references from any supported source location.
- One reference from declaration navigation opens directly. Multiple references require choosing;
  explicit Shift+F12 always opens the reference list, including a singleton.
- Use a bounded searchable location picker for definitions/references: file name, line/column and
  path, count, filter, Up/Down/Home/End, Enter, Escape and outside dismissal. Filtering does not
  issue language requests. No preview file reads or automatic edits are introduced.
- At most 512 references retained/scanned, clear truncation feedback, no silent first-sixteen cap.
  Definitions keep their sixteen-result bound. Both use the existing guarded catalog file opener.
- Preserve source snapshot/epoch/workspace/current editor checks through both definition and
  reference requests, picker filtering and selection. Source edits, tab changes, new queries,
  dismissal and destruction invalidate old selections. Log request kind/outcome/count only.
- Native host constructs only `textDocument/references` with `includeDeclaration: false` and the
  already validated document/position. No arbitrary LSP method, server command or file authority.

Official behavior consulted (2026-10-26):
[Android Studio navigation and Find Usages](https://developer.android.com/studio/intro/keyboard-shortcuts),
[IntelliJ code navigation](https://www.jetbrains.com/help/idea/navigating-through-the-source-code.html),
[VS Code definitions and reference Peek](https://code.visualstudio.com/docs/editing/editingevolved).
Their shortcuts and UI forms differ. This iteration aligns direct-single/choose-multiple and
separate definition/reference intent. It does **not** claim to implement VS Code's inline editable
Peek, Android Studio's full Find Usages tool window, or its complete keymap.

## Stages and gates

1. Commit this plan before code.
2. Add host references whitelist and immutable native request construction; pure bounded result
   normalization, same-symbol detection, searchable picker and editor routing. Keep SDK/package
   versions and execution authority unchanged.
3. Actual TypeScript actor and real-project reference assertions; Chromium/WebKit real mouse and
   keyboard tests for single/multiple/self results, filtering, stale intermediate requests,
   source changes and disposal. Existing definition tests must remain meaningful.
4. Typecheck/build/scripts, relevant Rust actor/format/Clippy gates, then fresh signed native
   package, canonical local replacement and saved-icon restart logs. Record artifact identities,
   resource/accessibility samples and remaining limitations. Make staged local commits; no push.
