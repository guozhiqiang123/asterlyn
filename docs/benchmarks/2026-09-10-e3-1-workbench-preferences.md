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
