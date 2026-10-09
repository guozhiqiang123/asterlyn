# Conflict editor fill-height fix

## Context

The split conflict editor fills the available workbench height, but CodeMirror MergeView deliberately
forces each nested editor and scroller to `height: auto` so the outer MergeView remains the vertical
scroll owner. With a short file, the nested editor therefore paints only its content height and the
rest of each pane exposes the surrounding chrome background. The first fix (`bce3473`) added a
percentage minimum-height chain. Manual acceptance rejected it: the line-number borders still ended
near the top. Its CSS contract and native startup smoke tests did not measure editor geometry and
were insufficient evidence for the claimed visual fix.

Actual browser measurement found a full-height editor containing a content-height scroller. The
percentage minimum resolves through auto-height flex boxes, not a definite viewport height.
CodeMirror also aligns scroller children at the top and gives gutters a document-derived pixel
minimum-height. Consequently, stretching the editor alone does not stretch the gutters.

## Invariants

- Ours, Result, and Theirs paint and accept editor interaction across the full available pane height,
  including one-line and empty documents.
- MergeView remains the single vertical scroll owner; the fix must not introduce three nested
  vertical scrollbars or regress synchronized scrolling for long files.
- Unified conflict mode and the docked horizontal scrollbar geometry remain unchanged.

## Implementation

Make each MergeView editor wrapper a column flex container and give its editor and scroller
`flex: 1 0 auto`. Short documents fill the available space without relying on percentage heights;
long documents can still grow, and MergeView remains the outer vertical scroll owner. Set both
before/after gutter containers to `align-self: stretch; height: auto`, preserving CodeMirror's
document-height minimum while extending their borders over empty space.

## Validation

Replace the two implementation-only height regex assertions with a real-browser layout gate:

```sh
npm exec playwright install chromium webkit
npm run test:conflict:rendered
```

The fixture mounts the production `ConflictEditor`, its real CodeMirror dependencies, and the
production CSS. It has no Git writes or connection to the user's Flutter checkout. Chromium and
WebKit check actual editor, scroller, content, and before/after line-number gutter rectangles for
empty, blank-Result, and single-line documents in dark/light themes, viewport resizing, and
split/unified switching. A click near the bottom must still focus Result. An expanded 800-line
fixture verifies outer-owner scrolling, three-pane linking in both directions, and docked horizontal
scrollbars without nested vertical overflow. Optional `ASTERLYN_LAYOUT_ARTIFACTS` saves screenshots;
`ASTERLYN_CHROME_CHANNEL=chrome` uses an installed Chrome instead of Playwright's bundled Chromium.

Run focused layout tests, the frontend script suite, TypeScript checking, production/native
packaging, signature checks, and installed-app startup smoke. Native startup smoke is only a startup
gate, not proof of conflict-editor geometry.

## Implementation result

- Baseline rejection reproduced by the new gate: `cm-scroller` was only 68.89px in a 753px viewport.
  Restoring the flex/gutter fix makes the same gate pass.
- Both browser engines pass 16 rendered scenarios each. All tested short-file inner boxes and gutter
  borders reach the viewport bottom at 753px and after resizing at 503px. Screenshots have been
  visually inspected, including the line-number border that prompted manual rejection.
- Environment: macOS 15.6.1 arm64, Playwright 1.62.1, Chromium 151 and WebKit 26.5. Playwright is a
  development-only MIT-licensed test dependency, not part of the shipped application runtime.
- Focused layout/navigation/style tests: 45 passed. Frontend script suite: 934 passed. TypeScript
  checking, production web/native packaging, strict ad-hoc signature verification, and native shell
  smoke checks of the built and installed executables passed.
- The freshly built app is installed and running at `/Applications/Asterlyn.app`. Build and installed
  executable SHA-256 match:
  `31fb2581c9584420341c6979fe2b93ba7c03f73e78eeece1d58cb9d928a3ca36`.
  The prior installed app is recoverable at
  `target/local-app-backups/Asterlyn-before-gutter-stretch-20261009-1606.app`.
- Acceptance archive: `target/release/bundle/macos/Asterlyn-gutter-stretch-20261009-macos-arm64-signed.zip`,
  9,261,284 bytes, SHA-256
  `e9db2c21e1c2fc1fc054af9f987a60639f8ce2e222471c3e62cc6800ce11bf19`.
