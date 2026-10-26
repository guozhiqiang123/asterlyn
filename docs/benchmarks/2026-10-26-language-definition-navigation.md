# Definition pointer navigation — 2026-10-26

The [plan](../engineering/2026-10-26-language-definition-navigation-plan.md) was committed as
`8e2547a` before implementation. This extends the already admitted TS/JS provider's ordinary
source editor; it does not change the immutable plugin package or native execution approval.

## Functional acceptance

`npm run test:lsp:definition` uses real Playwright keyboard/mouse events in Chromium and WebKit,
the actual TextEditor/CodeMirror adapter, the actual host context menu and definition navigator.
The fixture records server queries rather than calling the definition method directly.

- Ctrl + left button addresses the pointer's symbol while the original caret is elsewhere.
  macOS Command + left button also works. Releasing the modifier removes the underline. Moving
  the pointer issues zero definition requests. Normal click, right click, Ctrl + right click,
  line-number gutter interaction and dragging issue zero definition requests.
- WebKit's Control-click event order includes an intermediate DOM selection change. The held
  primary gesture survives this caret adjustment and its own context menu is suppressed.
- Cross-file navigation selects the exact `target` symbol, centers/focuses the destination and
  retains its unsaved text. The fixture includes BOM, CRLF, an emoji, and a Unicode/space path.
  A real rendered assertion caught the old BOM-stripping off-by-one before acceptance.
- Same-file and F12 navigation share the implementation. Held F12 does not repeat requests.
  Multiple definitions use a host menu with keyboard selection; Escape restores source focus.
- Pending results after editing, ordinary clicking, changing tabs, Escape, a newer lookup and
  editor disposal do not apply stale navigation. No candidate/menu DOM remains after disposal.
  Read-only source editors do not acquire an editable language overlay.
- Unknown/external targets produce localized feedback and no arbitrary file read. Pure tests
  additionally cover malformed Location/LocationLink data, surrogate splits, invalid target
  ranges, duplicates, bounded choices, a read-only catalog destination, delayed opens into the
  wrong active tab/workspace, and competing target opens.

The actual-server opt-in workspace test also opens the real `src/app.ts` snapshot and queries
its `projectTextBlameAvailability` call. TypeScript resolves the exact symbol range in
`src/features/files-editor/text-blame-availability.ts`. Original source bytes are checked unchanged.
The complete actual-project diagnostics/hover/definition/completion and cross-file test took
approximately 1.66 seconds locally. No native execution approval is automatically granted.

## Resource and accessibility evidence

Two rendered runs completed in 5.0–16.3 seconds for Chromium and 3.4–3.9 seconds for WebKit,
including twenty additional navigation/menu cycles per engine; the slower run shared the machine
with build/test work. Chromium post-GC retained JS heap deltas were +146,032 and +353,308 bytes
over those twenty cycles. These are local fixture samples, not a large-project memory ceiling or
a per-click latency guarantee.

One mounted gesture controller owns bounded event listeners and removes them on destruction.
Targets scan at most 128 returned entries and retain at most sixteen unique choices. Menus reuse
the host's semantic roles, keyboard navigation, Escape and focus restoration; F12 provides the
keyboard-only equivalent. Native document/request limits and server supervision are unchanged.
Navigation logs contain only outcomes and target counts, not source, symbols or paths.

## Quality gates and delivery

- Nine focused definition tests and the complete 1317 script tests pass with concurrency four.
- Typecheck, production build, existing language editor rendering, actual bundled package
  activation, Rust formatting and all-target strict Clippy for `asterlyn-language-service` pass.
- Actual TypeScript workspace acceptance passes without disk mutations.
- Preview and release quality jobs install Chromium/WebKit and run the real pointer suite.
- Native signed package, canonical replacement and saved-icon reopen: pending; exact identities
  will be recorded after packaging and installation.

## Current limits

Targets must exist in the current authoritative workspace catalog; third-party library files
outside that catalog get an explicit status. Rust, historical/Diff/conflict editors, back/forward
navigation history, references and WorkspaceEdit remain follow-up capabilities. Native macOS
startup/provider registration and browser-engine gestures are separate evidence; Windows/Linux
desktop pointer acceptance and the user's manual acceptance of this build remain open.
