# Editor Patch popover acceptance evidence

Date: 2026-10-12

## Delivered behavior

- Ordinary editable text files expose each added, modified, or deleted gutter block as a keyboard-
  focusable Patch trigger.
- The anchored popover compares only the selected block in a full-width unified layout, with old/new
  line-number columns, diff prefixes, semantic removed/added styling, and one shared scrollbar.
- Previous and next actions move across the freshly derived Patch list, keep selection and editor
  scroll aligned, and disable at the first/last boundary.
- Rollback restores only the selected block into the current CodeMirror buffer. It remains unsaved,
  participates in normal Undo, and performs no direct Git, staging, or filesystem mutation.
- Read-only state disables rollback. Document or baseline changes close stale Patch state.
- Repository text is rendered through DOM text content, so HTML-like source stays literal.
- The tooltip root and scrolling comparison surface own explicit opaque theme backgrounds, preventing
  editor source text from bleeding through empty Patch areas.
- A document-level pointer boundary closes the popover on outside interaction without treating its
  own controls or active gutter trigger as accidental dismissals.
- Escape, outside click, explicit close, active-marker toggle, and rollback all clear the selected
  Patch highlight together with the popover.
- Clicking a currently visible gutter marker opens the Patch in place without recentering or
  otherwise moving the editor viewport; Previous/Next navigation retains explicit positioning.
- Patch placement uses the visible editor scroller as its available rectangle, automatically flips
  above/below the selected block, and converts height pressure into internal Patch scrolling instead
  of allowing the header or actions to be clipped by editor chrome.

## Automated evidence

| Gate | Result |
| --- | --- |
| TypeScript and architecture checks (`npm run check`) | Passed |
| Frontend regression suite (`npm run test:scripts`) | 951 passed, 0 failed |
| Focused Patch projection/rollback tests | 7 passed, 0 failed |
| Rendered Chromium interaction | Passed |
| Rendered WebKit interaction | Passed |
| Production frontend build (`npm run build`) | Passed in 550 ms |
| Native macOS arm64 application bundle | Passed; version 0.1.3 |
| Installed `/Applications/Asterlyn.app` verification | Signature valid; installed bundle matches the accepted build |

The rendered interaction covers opening a marker, before/after isolation, previous/next boundaries,
literal markup handling, exact single-block rollback, Undo restoration, marker recomputation,
read-only rollback gating, Escape/outside-click/explicit close behavior, and absence of browser page
errors. A long middle-of-file Patch additionally proves that the selected code remains the primary
scroll target while the complete popover stays inside the visible editor and its body scrolls
independently under height pressure.

## Safety boundary

Rollback changes the editor buffer only. Existing dirty-state, save confirmation, staging, and Git
operation flows retain ownership of all persistent mutations.

## Local macOS acceptance package

- Artifact: `target/release/bundle/macos/Asterlyn-0.1.3-local-2026-10-12-editor-patch-v6.app.zip`
- Size: 9,289,335 bytes
- SHA-256: `e0d4c5cc34cacd46bf042c9538efffa713ede4ec532ce30d13907715cd66beec`
- Architecture: Apple Silicon arm64
- Bundle identifier: `dev.asterlyn.desktop`
- Signing: locally ad-hoc signed with hardened runtime; strict deep verification passed
