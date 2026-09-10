# E3.1 workbench navigation and preference evidence

## Scope and decision

E3.1 is locally accepted as the navigation and preference foundation for later editor groups. It makes the existing project tree operate like a durable tool window, reuses the established syntax presentation in Diff, and introduces a full settings route whose writable controls correspond only to implemented behavior.

The local machine remains Deepin 23.1 on Linux 6.12 with an AMD Ryzen 5 3600X, 19 GiB RAM, Rust 1.98.1, Node.js 24.19.0, and Git 2.47.2. This sub-slice produces no installer and makes no remote push; both remain reserved for a larger checkpoint.

## Functional and boundary evidence

- Project files and directories share one explicit selected-row model. The toolbar locates the active editable file, working-tree Diff path, or current commit-Diff path when it still exists; recursive expand and collapse operate on the selected directory and retain its selection.
- The tree combines the authorized tracked/non-ignored-untracked catalog with current change kinds and a separately typed ignored display catalog. Git supplies ignored files and collapsed directories with one bounded `ls-files` query. Ignored entries are visible context only: the authorized catalog used by file read/save, workspace search, replacement preview, replacement apply, and replacement rollback excludes them and is freshly rebuilt at each security boundary.
- Added, modified, deleted, renamed, conflicted, ignored, and unknown states use semantic palette tokens shared by the project tree, Changes rows, commit-file rows, and existing status badges. Textual status letters, file glyphs, labels, strike-through for deleted paths, and accessible titles keep color supplementary.
- Text and Diff adapters share one on-demand `EditorLanguageLoader`, filename matching, syntax theme, stale-load guard, fallback behavior, editor font/line-height variables, and tab-size compartment. A browser TypeScript working Diff reported one parser-ready editor with eight computed token colors in unified mode and two parser-ready editors with seven token colors each in split mode.
- Settings keeps the repository workbench mounted behind a dedicated full-workspace page. General, Appearance, Editor, Version Control, and Languages form stable groups. Application font size, editor font size, editor line height, tab display width, Diff layout, and whitespace visibility are bounded choices stored under one versioned repository-independent key. Invalid or legacy-shaped data fails to safe defaults. Localization, light/system themes, and per-language formatting are labelled planned and have no writable value.

Validation passes 97 frontend script tests, 28 `asterlyn-git` tests, 23 `asterlyn-workspace` tests, and ten desktop tests. Rust formatting, strict all-target Clippy, TypeScript checking, the production frontend build, and a six-second Linux release-executable liveness smoke check pass. The first all-workspace Clippy invocation omitted the documented user-local Tauri environment and failed while locating `javascriptcoregtk-4.1` and `libsoup-3.0`; rerunning through `scripts/with-linux-tauri-env.sh` used the existing isolated sysroot and passed without lowering any code check.

## Interaction and accessibility evidence

The deterministic production-like browser journey selected the `src` folder, observed enabled expand/collapse actions, recursively collapsed and expanded it, and retained `aria-selected="true"` throughout. Opening the `src/app.ts` working Diff, switching back to Files, and activating Locate selected `src/app.ts`, expanded its ancestors, scrolled it into view, and moved focus. File selection used the same full-row background as folder selection.

After changing application font to 13 px, editor font to 16 px, line height to 1.80, tab width to two, split/unified presentation, and whitespace visibility, a reload reproduced every selected value through visible controls and computed application typography. Settings navigation and Back retained the underlying workbench and editor state during ordinary use. Every compact icon button has a purpose-specific accessible name and disabled state; tree rows expose tree-item, selected, and expanded semantics; settings groups and Diff choices remain keyboard-operable native buttons/selects/checkboxes. Browser inspection found no warning or error console output during these journeys.

The populated project-tree plus split-Diff workbench contained 830 DOM nodes, two mounted CodeMirror editors, and 18 visible project rows. This is a focused complexity observation, not a memory benchmark.

## Build and resource movement

| Output | E2.3 | E3.1 | Movement |
| --- | ---: | ---: | ---: |
| CSS | 59.79 kB | 65.64 kB | +5.85 kB / +9.78% |
| CSS gzip | 11.53 kB | 12.54 kB | +1.01 kB / +8.76% |
| Main JavaScript | 589.31 kB | 608.79 kB | +19.48 kB / +3.31% |
| Main JavaScript gzip | 171.53 kB | 176.50 kB | +4.97 kB / +2.90% |
| Main JavaScript source map | 2,232.17 kB | 2,280.37 kB | +48.20 kB / +2.16% |
| All emitted JavaScript | 1,829,803 bytes | 1,849,287 bytes | +19,484 bytes / +1.06% |
| Sum of per-file gzip streams | 643,539 bytes | 649,420 bytes | +5,881 bytes / +0.91% |

Frontend size is **regressed**, primarily from settings rendering/state and the additional project-tree behavior. The existing greater-than-500-kB main-chunk warning remains open. CodeMirror parsers remain lazy chunks; no parser is moved into startup because Diff and text views share the loader rather than statically importing languages.

The rebuilt Linux release executable is 16,185,584 bytes, 17,544 bytes or 0.11% above E2.3's 16,168,040 bytes. Native executable size has **no material change**. No matched process-tree PSS/RSS series or forced-collection browser heap run was performed, so this slice makes no memory-improvement claim and classifies memory impact as **inconclusive**. No new watcher, index, language server, polling task, or background preference service was added. The ignored display query runs only with the bounded project catalog; search and replacement retain the smaller authorization-only catalog.

## Limits and next action

The settings route currently supports one dark English interface. It is not yet a localization catalog, theme engine, formatter registry, or complete keymap editor. Tab width is a visual CodeMirror indentation unit and does not rewrite existing content. Semantic file colors describe the current Git snapshot and can be stale until refresh. Ignored directories are intentionally opaque collapsed entries, and both authorized and ignored catalogs retain independent bounds. A deleted commit path that no longer exists in the current project catalog cannot be located in the tree. Project-tree disclosure and selection are session-only, while application preferences are local to the webview profile and are not synchronized.

Interaction and consistency are **improved**, frontend footprint is **regressed**, native size has **no material change**, and memory remains **inconclusive**. E3.2 adds the typed editor-group model, horizontal and vertical splits, group focus, and tab movement while preserving one owner for dirty buffers. A matched normalized native resource series, language-catalog packaging work, and installed Windows/macOS interaction remain larger Stage 3 checkpoint gates.

## Project-tree refresh and resize correction

Manual acceptance on Linux and macOS exposed three coupled problems after E3.1: the left splitter processed every pointer event with repeated range and editor-layout work, the project catalog stopped at 5,000 files, and the toolbar refresh reused repository switching and consequently cleared project-tree disclosure and selection.

The correction keeps the Git-derived model and security boundary but changes their presentation lifecycle:

- Pointer bursts retain only their latest value in one animation frame. Interactive resizing writes only the affected CSS property, while left-width and bottom-height changes share one pending editor-measure callback. The frame queue flushes the final pointer value before layout persistence, and keyboard resizing keeps the same range and commit semantics.
- Navigation and exact file authorization now admit up to 100,000 tracked or non-ignored untracked files. Search and replacement remain separately limited to 5,000 scan candidates, 64 MiB, and 500 matches. A generated repository with 5,001 files distributed across 51 directories returned every file without truncation through the production Git catalog; this specifically guards against restoring the old shared 5,000 limit.
- The complete tree remains an in-memory projection, but closed directories no longer mount their descendants. Repeated renders reuse one cached projection for the exact file/change/ignored arrays. A same-root refresh leaves the previous tree visible during the asynchronous catalog request and reconciles expanded directories and selection by exact path and kind. It preserves the scroll container offset; only missing paths are removed. A different repository still initializes a new disclosure set.

The frontend suite passes 117 tests. Its focused splitter test reduces three queued pointer values to one frame callback carrying only the last value, then proves commit-time flush. Project-tree tests retain valid expansion and selection while pruning removed identities. The desktop suite adds a real 5,001-file Git-catalog test and now passes 14 tests across the library and executable targets; all 28 Git-core and 23 workspace tests also pass. Rust formatting, strict all-target Clippy, TypeScript checking, production build, Debian packaging, and a six-second release-executable liveness smoke check pass.

In the deterministic browser workbench, closing `crates` reduced mounted project rows from 17 to 15, reopening it restored the descendants, and refreshing while it was selected and closed retained both `aria-selected="true"` and the closed state. Keyboard resizing changed the visible left pane from 220 to 236 pixels, and the page reported no warning or error. A single standalone 100,000-path tree construction took 276.36 milliseconds and ended at 82.69 MiB JavaScript heap on this machine; that is an upper-bound capacity observation including the generated input array, not a representative interaction latency or process-memory benchmark. The cache prevents that projection from being rebuilt repeatedly for unchanged arrays, but repositories near the ceiling still require later worker/progressive-loading evaluation.

| Output | Previous task-end package | Correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 65.68 kB | 65.68 kB | 0.00 kB / 0.00% |
| CSS gzip | 12.54 kB | 12.54 kB | 0.00 kB / 0.00% |
| Main JavaScript | 612.43 kB | 616.47 kB | +4.04 kB / +0.66% |
| Main JavaScript gzip | 177.18 kB | 178.16 kB | +0.98 kB / +0.55% |
| Main JavaScript source map | 2,289.68 kB | 2,301.70 kB | +12.02 kB / +0.52% |
| Linux release executable | 18,253,992 bytes | 18,255,888 bytes | +1,896 bytes / +0.01% |
| Debian package | 6,214,414 bytes | 6,216,932 bytes | +2,518 bytes / +0.04% |

All size movements are **no material change**. No watcher, persistent index, polling service, or background worker was added. No matched native process-tree PSS/RSS series or forced browser-heap series was run, so memory impact remains **inconclusive** and this correction makes no memory-reduction claim. Ignored directories remain intentionally opaque collapsed entries, and the 100,000-file navigation ceiling is still a disclosed bound rather than a claim of an unlimited filesystem browser.

The refreshed local Debian acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,216,932 bytes, with SHA-256 `c3defe2cec6b1f4838d9631b888100cc0d3a7081519aa18930861ebaf3490a4b`. Package inspection confirms version 0.1.0, `amd64`, the desktop entry, native executable, and the maintained icon-size set. This is a local unsigned acceptance artifact, not a release candidate, and no remote push is made.
