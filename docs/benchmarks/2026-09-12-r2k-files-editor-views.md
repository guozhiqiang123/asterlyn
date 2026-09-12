# R2k Files, Editor, and Search view ownership

## Scope

This R2 checkpoint moves quick navigation, workspace-search results, recoverable replacement
dialogs, editor tabs and menus, Markdown mode controls, image-preview markup, and Diff controls out
of `AsterlynApp`. A dedicated `EditorSurface` now owns the lazy CodeMirror instances, Markdown
preview timer and dynamic import, linked scrolling, split-pane listener, mounted-editor identity,
measurement frame, and explicit disposal.

## Evidence

- Source concentration: `src/app.ts` decreased from 6,860 lines at R2j to 6,224 lines. The new
  feature files are 391, 322, and 171 lines, all below the 800-line decomposition trigger.
- Focused behavior: eight feature-view tests pass, including quick navigation, replacement error
  presentation, editor file-state tabs, open-file menu, Markdown mode selection, and Diff controls.
- Broader behavior: all 230 frontend script tests and TypeScript checking pass.
- Production build: the main startup chunk is 409.50 kB uncompressed and 100.93 kB gzip, below the
  500 kB architecture gate. CodeMirror and Markdown preview remain behind first-use dynamic
  imports after their lifecycle moved to `EditorSurface`.
- Browser acceptance: the demo opens the file-navigation dialog, selects `README.md`, mounts the
  editor, and exposes Source, Split, and Preview controls after the extraction.

## Interpretation

The result is **improved**. Editor runtime objects, timers, splitter listeners, and Markdown preview
state now have one owner and one disposal boundary. Workspace navigation and replacement markup no
longer live in the application shell. Startup size remains stable.

## Limitations and next action

The browser demo does not exercise native file persistence or large Markdown documents. Complete
R2 by narrowing the remaining shell-owned event wiring, running native Rust and desktop smoke
validation, and recording the residual composition adapter as the next R3 decomposition target.
