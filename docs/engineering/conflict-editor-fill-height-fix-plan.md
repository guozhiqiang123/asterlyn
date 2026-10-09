# Conflict editor fill-height fix

## Context

The split conflict editor fills the available workbench height, but CodeMirror MergeView deliberately
forces each nested editor and scroller to `height: auto` so the outer MergeView remains the vertical
scroll owner. With a short file, the nested editor therefore paints only its content height and the
rest of each pane exposes the surrounding chrome background.

## Invariants

- Ours, Result, and Theirs paint and accept editor interaction across the full available pane height,
  including one-line and empty documents.
- MergeView remains the single vertical scroll owner; the fix must not introduce three nested
  vertical scrollbars or regress synchronized scrolling for long files.
- Unified conflict mode and the docked horizontal scrollbar geometry remain unchanged.

## Implementation

Give every visible split MergeView editor and its CodeMirror scroller a `min-height: 100%` chain.
This complements MergeView's `height: auto !important`: short documents fill the pane, while long
documents may still grow and contribute to the outer MergeView's scroll extent.

## Validation

Add a CSS contract regression for the editor/scroller height chain, then run focused conflict layout,
navigation, unified-mode, and style ownership tests followed by the complete frontend, TypeScript,
production build, native Git, packaging, signature, and rendered installed-app checks.

## Implementation result

- Split Ours, Result, and Theirs now maintain a full-height editor/scroller minimum without replacing
  MergeView's outer vertical scroll ownership.
- Verified with 60 focused layout and navigation tests, 933 frontend script tests, TypeScript
  checking, the production web build, 133 `asterlyn-git` tests, release packaging, strict signature
  verification, and rendered smoke checks against both build and installed executables.
- The verified application is installed and running at `/Applications/Asterlyn.app`; the prior build
  remains recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-conflict-fill-height-20261009.app`.
- Acceptance archive:
  `target/release/bundle/macos/Asterlyn-conflict-fill-height-20261009-macos-arm64-signed.zip`,
  9,259,096 bytes, SHA-256
  `502516e1735cde158afe60a8cec37919997549bf28ad78db72d5b4f206c5e481`.
