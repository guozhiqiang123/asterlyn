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

## Editor-tab, exact-dirty-state, and macOS splitter correction

Manual editor acceptance exposed six presentation/state defects: a redundant text metadata header, encoding in the wrong region, an edit-counter dirty marker that survived an exact undo, neutral tab labels for Git-changed files, no bounded open-file chooser, and a macOS overlay scrollbar layer that could lag behind the moving left divider.

The correction removes the metadata header for welcome and editable text documents while retaining the Diff-only context toolbar. `Ctrl/Cmd+S` and the command surface remain the explicit save entry points. The bottom-right status area now shows `UTF-8` or `UTF-8 BOM` only for an active loaded text tab, immediately before branch state. Text tabs and working-Diff preview tabs resolve their current workspace path through the cached project tree and reuse its added, untracked, modified, deleted, renamed, copied, and conflicted color tokens.

The editor-session baseline is now exact content, not only monotonically increasing edit and persisted versions. A save request retains the exact content it captured; completion advances the baseline to that captured value while preserving any newer buffer. Focused tests prove edit-to-dirty, exact undo-to-clean, no-op save after undo, and edits-during-save remaining dirty. Search navigation fixtures use the same exact-content invariant.

The fixed trailing open-document control lists all six documents opened in the deterministic browser journey and identifies the active one. At a 601-pixel tab viewport with 720 pixels of tab content, choosing the final item moved horizontal position from 0 to 119 pixels so its right edge equalled the visible edge; choosing the first item returned position to 0. The same journey observed the text content grid as a 36-pixel tab row plus editor body, a hidden ordinary content header, `UTF-8` in the status bar, one dirty marker after editing, zero after `Ctrl+Z`, and no warning/error console entries.

The left splitter now listens through the window for move/release, finalizes lost pointer capture, exposes one drag-state callback, clips the Files pane, and hides its overflow layer only during active dragging. In the production-like browser journey, a 70-pixel pointer drag changed the Files pane to 306 pixels; after release the pane right edge and divider left edge were both 350 pixels, drag state was false, and overflow had returned to `auto`. This validates lifecycle and final geometry on Linux Chromium. The original defect is macOS WebKit compositor-specific, so installed macOS confirmation remains a manual limitation rather than an automated cross-platform claim.

Validation passes 120 frontend script tests, 14 desktop tests, 28 Git-core tests, and 23 workspace tests. TypeScript checking, the production frontend build, Rust formatting, all-workspace tests, strict all-target Clippy, Debian packaging and six-second release-executable liveness pass.

| Output | Project-tree correction | Editor-tab correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 65.68 kB | 68.60 kB | +2.92 kB / +4.45% |
| CSS gzip | 12.54 kB | 12.97 kB | +0.43 kB / +3.43% |
| Main JavaScript | 616.47 kB | 621.13 kB | +4.66 kB / +0.76% |
| Main JavaScript gzip | 178.16 kB | 179.10 kB | +0.94 kB / +0.53% |
| Main JavaScript source map | 2,301.70 kB | 2,313.46 kB | +11.76 kB / +0.51% |
| Linux release executable | 18,255,888 bytes | 18,258,960 bytes | +3,072 bytes / +0.02% |
| Debian package | 6,216,932 bytes | 6,219,400 bytes | +2,468 bytes / +0.04% |

CSS and frontend JavaScript size are **regressed**, primarily from the bounded dropdown presentation. Native executable and Debian package movement are **no material change**. No watcher, index, polling service, or background task was added. No matched process-tree PSS/RSS series or forced browser-heap series was run, so memory impact remains **inconclusive**.

The refreshed local Debian acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,219,400 bytes, with SHA-256 `db6468d67aa8ffa8cdabdb810e15d29c0bae7367de8daf6cfe4095bd298d86ee`. Package inspection confirms version 0.1.0, `amd64`, the native executable, desktop entry, and maintained icon set. It is a local unsigned acceptance artifact, not a release candidate, and no remote push is made.

## Code-folding and Markdown-presentation correction

The next manual editor request adds two presentation capabilities without advancing into the E3.2 multi-group model. The CodeMirror adapter now installs its syntax-tree fold gutter and default fold keymap. Folding and highlighting consume the same lazily selected language support and do not create a second parser, index, workspace scan, or service process.

Markdown tabs add Source, Split, and Preview choices in the single existing tab row. Each tab retains its own transient mode. Split keeps the authoritative CodeMirror buffer on the left, renders that exact in-memory content on the right after a 40-millisecond coalescing interval, and exposes a standard pointer/keyboard divider. Preview removes only the editor widget. Switching back to Source reconstructs the widget from the unchanged session buffer, so mode changes never save, normalize, or discard text. An implementation defect found during browser acceptance was corrected: the internal tab identity contains a non-HTML separator and therefore must never round-trip through a DOM attribute; preview acceptance now compares only in-memory request and active-tab identities.

`markdown-it` 15.0.1 is a separate lazy chunk and is requested only when Split or Preview is first used. The parser runs with raw HTML disabled. Its image rule produces a text placeholder instead of an `img` element, and its link rules produce styled non-navigating spans instead of anchors. This prevents a repository document from executing embedded HTML, fetching local/remote images, or navigating the application shell. Live preview accepts at most 512 KiB; a larger Markdown file retains normal source editing and saving with an explicit preview-limit message.

Focused tests cover per-tab mode ownership, recognized Markdown extensions, MDX exclusion, headings/lists, raw-HTML escaping, non-fetching images, non-navigating links, and the render bound. The complete frontend suite passes 125 tests. Browser interaction opened Markdown in Source, switched through Split and Preview, edited the split source and observed the heading and strong-text projection update, returned to Source with exact content retained, and changed the split width from 463 to 479 pixels through the accessible separator. A TypeScript editor exposed fold markers; `Ctrl+Shift+[` reduced the class body to one fold placeholder and `Ctrl+Shift+]` restored it. Mode controls expose a named group with pressed state, preview is a named region, and the splitter publishes separator orientation and current value. No warning or error console entries were observed.

A generated Markdown fixture records absolute parser cost on this machine. A 10,240-byte warm render had a 3.824-millisecond median across 30 iterations (2.791–8.472 milliseconds). A 102,400-byte warm render had a 39.623-millisecond median across 20 iterations (31.114–62.443 milliseconds), while its cold module-import-plus-render observation was 139.557 milliseconds. There was no previous renderer for a normalized latency comparison, and Node execution is not a native-webview resource benchmark; preview latency impact is therefore **inconclusive** beyond these absolute fixtures. The 40-millisecond coalescing and 512-KiB cap are retained until representative long-document interaction motivates a worker boundary.

| Output | Editor-tab correction | Markdown correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 68.60 kB | 72.44 kB | +3.84 kB / +5.60% |
| CSS gzip | 12.97 kB | 13.72 kB | +0.75 kB / +5.78% |
| Main JavaScript | 621.13 kB | 634.03 kB | +12.90 kB / +2.08% |
| Main JavaScript gzip | 179.10 kB | 182.84 kB | +3.74 kB / +2.09% |
| Main JavaScript source map | 2,313.46 kB | 2,338.88 kB | +25.42 kB / +1.10% |
| Lazy `markdown-it` JavaScript | absent | 97.28 kB | +97.28 kB |
| Lazy `markdown-it` gzip | absent | 40.86 kB | +40.86 kB |
| Linux release executable | 18,258,960 bytes | 18,396,848 bytes | +137,888 bytes / +0.76% |
| Debian package | 6,219,400 bytes | 6,357,474 bytes | +138,074 bytes / +2.22% |

Frontend, executable, and package size are **regressed** by the new capability. The renderer's independent lazy chunk keeps its 97.28 kB out of initial JavaScript loading, but the existing greater-than-500-kB main-chunk warning remains open and the presentation/controller additions still enlarge the main bundle. No matched process-tree PSS/RSS or forced browser-heap series was run, so memory impact is **inconclusive** and no memory-reduction claim is made.

Formatting, strict all-target Clippy, TypeScript checking, production frontend build, 14 desktop tests, 28 Git tests, 23 workspace tests, Debian package inspection, and six-second release-executable liveness pass. The first packaging attempt encountered a transient local open-file limit while the development preview infrastructure was still active; retrying after closing that infrastructure completed without a code or configuration change. The refreshed unsigned local package is `Asterlyn_0.1.0_amd64.deb`, 6,357,474 bytes, with SHA-256 `8dcf6d2f76b5d6a4081399e732b0c9274ff2934ce28f084ad77784f659ac1fc6`. Functionality and interaction are **improved**; size is **regressed**; parser latency and memory are **inconclusive**. No remote push is made.

## Markdown-scroll and fold-control correction

Manual acceptance on 2026-09-11 exposed two presentation defects in the previous slice. Full Preview placed an auto-height article inside the editor body's clipped block layout, so a long document grew beyond the visible editor without creating a scrollable viewport. Code folding was functional through the keymap and CodeMirror's default character markers, but the 13-pixel low-contrast gutter did not provide a discoverable Android Studio-like pointer control.

The Preview body now contributes one bounded `minmax(0, 1fr)` grid track and the preview region remains its only overflow owner. In the production-like browser journey, a generated 80-section Markdown document produced a 7,895-pixel scroll extent inside a 386-pixel viewport. A wheel movement changed its own `scrollTop` from 0 to 650 while the workbench stayed fixed. A short document used the same full 386-pixel viewport rather than collapsing to its 169-pixel rendered height.

The fold gutter now supplies original SVG down/right chevrons in a 19-pixel gutter. The visible marker measured 17 by 18 pixels and exposes a hover state and a Fold/Unfold title. An actual pointer click created one CodeMirror fold placeholder and replaced the down chevron with a right chevron; clicking the right chevron restored the region and removed the placeholder. The standard fold/unfold keymap remains the keyboard path, and decorative SVG content is hidden from accessibility APIs. Preview's mode button now declares `Rendered preview (read-only)` in its tooltip. `markdown-it` supplies HTML rendering only; rendered-document editing remains intentionally absent until a source-mapped editing, selection, history, and save contract is designed.

The complete frontend suite passes 125 tests, TypeScript checking and the production build pass, the Debian bundle completes, and the release executable remains alive for the six-second smoke interval. Browser interaction produced no warning or error console entries. No new parser, renderer, background task, watcher, index, or repository query was added, so no new latency fixture is meaningful for this CSS and marker correction. No matched process-tree PSS/RSS or browser-heap series was run, therefore memory impact remains **inconclusive**.

| Output | Markdown correction | Scroll/fold correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 72.44 kB | 72.54 kB | +0.10 kB / +0.14% |
| CSS gzip | 13.72 kB | 13.74 kB | +0.02 kB / +0.15% |
| Main JavaScript | 634.03 kB | 634.92 kB | +0.89 kB / +0.14% |
| Main JavaScript gzip | 182.84 kB | 183.23 kB | +0.39 kB / +0.21% |
| Main JavaScript source map | 2,338.88 kB | 2,340.68 kB | +1.80 kB / +0.08% |
| Linux release executable | 18,396,848 bytes | 18,397,552 bytes | +704 bytes / +0.004% |
| Debian package | 6,357,474 bytes | 6,358,216 bytes | +742 bytes / +0.012% |

Every output movement is **no material change**. Functionality and fold discoverability are **improved**; performance has **no material change** at this correction's scope; memory remains **inconclusive**. The refreshed unsigned local package is `Asterlyn_0.1.0_amd64.deb`, 6,358,216 bytes, with SHA-256 `05618a26a897bb448d4218a9d5846a1c989fc1746502752166e1dd5f8d33aa14`. Package inspection confirms version 0.1.0 and `amd64`. No remote push is made.

## Legacy-language folding and language-adapter boundary

Manual review found that the catalog's Kotlin and Groovy stream modes produced syntax colors but no structural fold ranges, while XML placed the marker on the final line of a multiline opening tag. The Stage 3 correction follows [`ADR-0006`](../architecture/decisions/0006-language-adapter-evolution.md): Kotlin, Kotlin Gradle scripts, Groovy, Gradle Groovy scripts, and Jenkinsfiles retain their existing lazily loaded tokenizers and receive only a bounded token-aware brace-fold service. XML keeps its Lezer parser and publishes paired-element folding on the opening tag's first line. Completion, navigation, diagnostics, symbols, formatting, Tree-sitter, LSP, workers, and repository indexing remain outside this slice.

Focused fixtures use the real installed CodeMirror language packages. They prove nested Kotlin class/function/condition folds, Groovy/Gradle block folds, first-line Android XML element folds, ignored braces inside tokenized strings and comments, and a fail-closed result above the one-MiB synchronous limit. Filename coverage also identifies `.gradle.kts` as Kotlin and `Jenkinsfile` as Groovy. The complete frontend suite passes 129 tests, and TypeScript checking succeeds. The existing fold gutter, pointer titles, chevrons, and keyboard commands are unchanged; a language adapter now determines whether those same accessible controls appear. Installed-platform pointer interaction remains a manual acceptance item.

A generated 102,400-code-unit Kotlin document measured the first fold query of 20 fresh editor states after bounded parser preparation: 0.182 milliseconds median, 0.092 minimum, and 1.918 maximum on this machine. This is an absolute Node fixture rather than a native-webview latency series, and it excludes asynchronous language-module loading. It confirms that the cached scan is inside the interaction budget for this fixture but provides no normalized before/after comparison; performance impact is therefore **inconclusive** rather than a general speed claim.

| Output | Scroll/fold correction | Language-fold correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 72.54 kB | 72.54 kB | 0.00 kB / 0.00% |
| CSS gzip | 13.74 kB | 13.74 kB | 0.00 kB / 0.00% |
| Main JavaScript | 634.92 kB | 636.34 kB | +1.42 kB / +0.22% |
| Main JavaScript gzip | 183.23 kB | 183.79 kB | +0.56 kB / +0.31% |
| Main JavaScript source map | 2,340.68 kB | 2,347.54 kB | +6.86 kB / +0.29% |
| Linux release executable | 18,397,552 bytes | 18,399,664 bytes | +2,112 bytes / +0.01% |
| Debian package | 6,358,216 bytes | 6,360,536 bytes | +2,320 bytes / +0.04% |

Every output movement is **no material change**. Folding availability and XML control placement are **improved**. No matched process-tree PSS/RSS or forced browser-heap series was run, so memory remains **inconclusive** and no memory-reduction claim is made. The fallback is intentionally brace-structural rather than grammar-complete and disables itself above one MiB; richer syntax structure remains a separately gated Stage 4 language-pack decision.

The refreshed unsigned local package is `Asterlyn_0.1.0_amd64.deb`, 6,360,536 bytes, with SHA-256 `7da24c5ef29421352b1b6b6bea5cc1550dd9590ede78d81eaf38ad94a3d1fefb`. Package inspection confirms version 0.1.0, `amd64`, the native executable, desktop entry, and maintained icon-size set. The release executable remained alive for the six-second native smoke interval. No remote push is made.
