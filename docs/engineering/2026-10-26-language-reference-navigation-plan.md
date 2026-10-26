# Declaration and reference selection — 2026-10-26

Status: implemented; automated gates pass, native delivery pending. Baseline: `7a71d92`.
Initial plan commit: `1f4d58a`, before implementation.

The user asks to choose among multiple references and align navigation with Android Studio and
VS Code. The previous iteration handles several **definitions**, but does not query **references**.
These are distinct language requests; a symbol having many uses must not make an ordinary jump
from a use to its single definition ambiguous.

## Contract and references

- A use's Ctrl/Command-click or F12 queries its definition. One foreign target opens directly.
  Several definitions require a picker; do not choose the first silently.
- When the only definition is exactly the hit/caret word's range in the same buffer,
  query references instead of jumping to the same selection. This is our declaration/usages
  convenience behavior. A broad containing function/body range is insufficient evidence. Shift+F12
  explicitly queries references from any supported source location; Alt+F7 (Option+F7 on macOS)
  provides the Android Studio Find Usages alias.
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

## Execution record

- Stages 1–3 implemented. Native constructs a read-only references request excluding declarations;
  source URI and exact identifier range control declaration fallback. A searchable accessible
  location picker replaces the transient command menu for all multiple-definition/reference choices.
- Eleven focused navigation tests and all 1320 scripts pass; typecheck/build, existing language
  editor rendering, formatting and strict all-target Clippy for the host and language crate pass.
- Chromium/WebKit real mouse/keyboard tests include Ctrl/Command declaration-to-usages, explicit
  references/Find Usages, filtering without new requests, mouse/keyboard selection, viewport bounds,
  512-result clipping feedback, stale intermediate responses and all prior definition checks.
- Actual native actor proves declarations are excluded from references; real Asterlyn `app.ts`
  call → declaration → references loop passes without saving source. Native delivery follows.
