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

## Editor response and file-icon correction

Manual interaction on 2026-09-11 exposed a coupled editor hot path rather than an isolated paint defect. Every Files-tree activation rebuilt the complete visible tree, destroyed the current CodeMirror view, reconstructed a new editor state, and restarted lazy language installation. Repeated selections could therefore queue obsolete work quickly enough that the visible editor appeared to stop following the final selected file. Every document change also reconstructed exact mixed-line-ending content through a complete encode/offset/mutate/decode pass.

The correction gives each of the at most 20 open text tabs one bounded CodeMirror state owner while retaining exactly one mounted `EditorView`. Switching tabs detaches the active view and mounts the selected cached state, preserving its parsed syntax tree, selection, fold state, undo history, and scroll position. Tab close, repository exit, and a changed load epoch dispose the corresponding state. Asynchronous language installation is guarded by tab identity and load epoch, so an older request cannot replace the final selection. Files-tree activation patches selection in place and no longer reconstructs the tree DOM. Change notifications are coalesced to one animation frame, with a synchronous flush at capture/save/lifecycle boundaries, and exact line-ending metadata is now spliced only across changed ranges.

The editor content line begins immediately after the line-number/fold gutters with zero left padding. Project rows, editor tabs, the open-document chooser, and commit-file rows now share one original 16-by-16 SVG file-icon system. It classifies common source, build, configuration, data, document, image, archive, and script names or extensions, then falls back to a neutral document mark. Icons are decorative and `aria-hidden`; the filename remains the authoritative accessible label. Git status color remains on the filename, so file type and repository state are independent signals.

Focused exact-content tests retain mixed CRLF/LF separators across multiple changes, and file-icon tests cover representative static names, compound extensions, common languages, fallback behavior, fixed geometry, and non-reflection of an unsafe path. The complete frontend suite passes 132 tests, TypeScript checking passes, and the production frontend build succeeds.

In a production-like Chromium workbench, 40 rapid Files-tree selections across four source files ended on `styles.css`, displayed its expected content, reported CSS language support ready, retained 17 tree rows, and mounted exactly one CodeMirror editor. A generated 300-line buffer produced an 8,804-pixel editor scroll extent inside a 386-pixel viewport; ten page movements advanced to 4,209 pixels without losing the editor. A fresh session edited `app.ts`, switched away and back, then used Undo to recover the exact clean baseline while retaining ready language state. The project tree exposed nine 16-by-16 file icons across five computed colors, the editor line reported zero left padding, and neither journey emitted a browser warning or error.

A 514,579-code-unit, approximately 512-KiB CRLF fixture measured one middle insertion across 30 Node.js runs. The previous complete-content path had a 7.446-millisecond median (6.076 minimum, 12.160 maximum); the changed-range path had a 0.698-millisecond median (0.669 minimum, 1.645 maximum), a 90.63% median reduction. This result classifies the measured edit-synchronization path as **improved**. It is not a macOS WebKit frame-time series and does not by itself establish general scrolling latency.

| Output | Language-fold correction | Editor-response correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 72.54 kB | 73.84 kB | +1.30 kB / +1.79% |
| CSS gzip | 13.74 kB | 14.21 kB | +0.47 kB / +3.42% |
| Main JavaScript | 636.34 kB | 642.25 kB | +5.91 kB / +0.93% |
| Main JavaScript gzip | 183.79 kB | 185.53 kB | +1.74 kB / +0.95% |
| Main JavaScript source map | 2,347.54 kB | 2,364.90 kB | +17.36 kB / +0.74% |
| Linux release executable | 18,399,664 bytes | 18,405,360 bytes | +5,696 bytes / +0.03% |
| Debian package | 6,360,536 bytes | 6,366,172 bytes | +5,636 bytes / +0.09% |

Frontend size is **regressed**, chiefly from the explicit file-icon catalog and editor-state lifecycle. Native executable and Debian movement are **no material change**. Retaining up to 20 inactive editor states can retain more JavaScript heap than the previous single-state implementation, although only one DOM editor exists and closed tabs are released. No matched process-tree PSS/RSS or forced browser-heap series was run, so memory impact is **inconclusive** and no memory-reduction claim is made.

The browser evidence uses the production frontend in Chromium rather than an installed macOS WebKit bundle, and the automated interaction does not replace manual compositor and high-resolution trackpad acceptance. The existing greater-than-500-kB main-chunk warning also remains open. Functionality, final-selection correctness, measured edit synchronization, state continuity, and icon consistency are **improved**; frontend size is **regressed**; native package size has **no material change**; memory and cross-platform scroll-frame impact remain **inconclusive**.

The refreshed unsigned local acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,366,172 bytes, with SHA-256 `295ada2eae73078f9a6fd24634e2476400ad8487a8b0fb0ba4b0d2100cefbc8e`. Package inspection confirms version 0.1.0, `amd64`, the native executable, desktop entry, and maintained Linux icon-size set. The release executable remained alive for the six-second native smoke interval. No remote push is made.

## Startup recovery, Markdown scroll linking, and editor spacing

The first-launch Git error reported on 2026-09-11 was an application/tooling defect. The native liveness harness launched the ordinary application profile against a disposable repository; successful startup stored that path as the recent repository, and fixture cleanup left the next installed launch pointing at a deleted `/tmp/asterlyn-native-smoke-*` directory. The launcher now overrides XDG cache, configuration, data, and state roots below a separate disposable profile while preserving the real user home, and removes both profile and repository after observation. Independently, startup treats a recent-repository open failure as recoverable: it clears the stale hint and opens the standard folder chooser without surfacing the Git failure toast. Focused tests cover a valid recent path, a rejected or throwing stale path, unavailable storage, profile isolation, preservation of `HOME`, and fixture cleanup behavior.

Markdown Split now links source and rendered preview vertically in both directions by normalized scroll progress. Proportional mapping is required because an editable source document and its rendered block tree have different heights; horizontal scrolling remains independent and no exact source-line mapping is claimed. The active Markdown surface owns and disposes the listener pair, and each live preview replacement rebinds after its final height is known. In the production-like browser fixture, source and preview heights were 13,870 and 17,387 pixels. Scrolling from source produced progress ratios 0.63710 and 0.63708; scrolling back from preview produced 0.49000 and 0.49003. The differences are sub-pixel rounding.

Editor preferences now persist line spacing, letter spacing, inserted-space indent size, and visual tab width as separate bounded values. The untouched baseline is 13-pixel editor text, 1.20 line height, normal zero letter spacing, four-space indentation, and four-column tabs. The locally installed Android Studio 2026.1.4 profile has no editor-font override. JetBrains documents 1.20 as the editor's default line-height factor, while Android Studio documents spaces as its default indentation style. JetBrains exposes no letter-spacing control for the code editor, so zero is the faithful default and the additional Asterlyn control is explicitly an extension rather than a claimed Android Studio setting. Existing persisted values survive the version-three migration, while new fields receive these defaults.

The browser journey changed line height to 1.35, letter spacing to 0.5 pixels, indentation to eight spaces, and tab width to four columns. Computed CodeMirror values matched each choice, an automatic newline inside a TypeScript block inserted exactly eight leading spaces, and a new page session restored all five editor controls including the previously selected font size. Settings exposes one `Settings` heading, one text label per navigation item, and the groups General, Appearance, Editor, Version Control, and Code. The redundant `Application` and `Preferences` eyebrow headings and navigation subtitles are removed. Native selects retain accessible names, the navigation keeps `aria-current`, and indentation is applied by CodeMirror's newline and explicit indent commands. Three browser pages reported no warning or error.

The complete frontend suite passes 138 tests, TypeScript checking succeeds, the production build succeeds, Debian packaging completes, and the release executable remains alive for the six-second isolated native smoke interval. A pure 30-run fixture processed 10,000 proportional source-scroll events per run in a 0.692-millisecond median, with 0.547 minimum and 6.333 maximum. This establishes negligible mapping cost in the JavaScript helper but is not a compositor, WebKit, or physical trackpad frame-time benchmark; interaction performance is classified **improved** for the accepted Chromium journey and **inconclusive** across installed platforms.

| Output | Editor-response correction | Startup/scroll/settings correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 73.84 kB | 73.56 kB | -0.28 kB / -0.38% |
| CSS gzip | 14.21 kB | 14.18 kB | -0.03 kB / -0.21% |
| Main JavaScript | 642.25 kB | 644.14 kB | +1.89 kB / +0.30% |
| Main JavaScript gzip | 185.53 kB | 186.10 kB | +0.57 kB / +0.31% |
| Main JavaScript source map | 2,364.90 kB | 2,372.31 kB | +7.41 kB / +0.31% |
| Linux release executable | 18,405,360 bytes | 18,407,024 bytes | +1,664 bytes / +0.01% |
| Debian package | 6,366,172 bytes | 6,366,752 bytes | +580 bytes / +0.009% |

All output movements are **no material change**. The change adds one listener pair only while an active Markdown Split surface exists and two primitive preference fields; it adds no watcher, index, worker, parser, service process, polling task, or repository query. No matched process-tree PSS/RSS or forced browser-heap series was run, so memory impact remains **inconclusive** and no memory-reduction claim is made. Exact heading/source anchors, installed macOS WebKit scrolling, and `.editorconfig` or language-specific indentation remain explicit later acceptance work.

The refreshed unsigned local acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,366,752 bytes, with SHA-256 `cb705a666ccbb52fad22f646bb072abde59c72a3375fec24bba0c471e500e831`. Package inspection confirms version 0.1.0, `amd64`, the native executable, desktop entry, and maintained Linux icon-size set. No remote push is made.

## Project chrome and hide-action correction

Manual review on 2026-09-11 found four shell consistency gaps. The title bar permanently consumed space for the active path and offered no recent-project menu; the Files/Changes header duplicated an eyebrow and title while separating its count; only the bottom Git dock had an in-context Hide action; and an ignored-directory status was present in the tree model but lost to the directory row's more-specific base color. The recursive-collapse icon also drew two converging chevrons through the same compact center and appeared as an unrelated cross.

The corrected project control renders only the active basename and disclosure arrow. Its native tooltip contains the absolute path, while its menu contains `Open…` and at most eight deduplicated, most-recently-used successful project paths. The active project is represented by the control and is excluded from the menu; no `Open Projects` section is introduced. Successful opens update both the compatible startup hint and the bounded recent list, and startup recovery removes a stale path from both. Files and Changes now expose one heading with the count as its immediate sibling. Both left-tool modes and the Git tool expose named top-right Hide actions through their existing persisted layout transitions.

The production-like browser journey observed `sample-app` as the project control's entire visible text, `/workspace/sample-app` as its tooltip, and zero legacy path nodes. After opening that project through the normal target dialog, the menu exposed `asterlyn` with `/workspace/asterlyn` under `Recent Projects` and contained no current-project section. The Files header measured 44 pixels high, contained one heading and no eyebrow, and placed count `11` immediately after `sample-app`; Changes produced the equivalent single line `Changes 5`. Activating `Hide Files tool window` removed the dock and changed the activity button to `aria-pressed="false"`; reopening Files restored the same tool. The ignored `.cache` directory computed to `rgb(183, 138, 112)`, matching `--file-ignored: #b78a70`, while its title still identified the semantic `Ignored` state so color remains supplementary. Project-menu items use menu/menuitem roles, the disclosure publishes `aria-expanded`, and both Hide controls have purpose-specific accessible names. The browser reported no warning or error.

The complete frontend suite passes 141 tests, TypeScript checking succeeds, the production build succeeds, Debian packaging completes, and the release executable remains alive for the six-second isolated native smoke interval. Recent-project work is bounded to eight strings and runs only when a menu opens or a project succeeds; it adds no watcher, filesystem probe, Git query, worker, polling task, or editor render dependency. No frame-time series was captured, so interaction performance remains **inconclusive** rather than a speed claim. No matched process-tree PSS/RSS or forced browser-heap series was run, so memory impact also remains **inconclusive**.

| Output | Startup/scroll/settings correction | Project-chrome correction | Movement |
| --- | ---: | ---: | ---: |
| CSS | 73.56 kB | 75.44 kB | +1.88 kB / +2.56% |
| CSS gzip | 14.18 kB | 14.49 kB | +0.31 kB / +2.19% |
| Main JavaScript | 644.14 kB | 647.57 kB | +3.43 kB / +0.53% |
| Main JavaScript gzip | 186.10 kB | 186.82 kB | +0.72 kB / +0.39% |
| Main JavaScript source map | 2,372.31 kB | 2,381.53 kB | +9.22 kB / +0.39% |
| Linux release executable | 18,407,024 bytes | 18,409,648 bytes | +2,624 bytes / +0.014% |
| Debian package | 6,366,752 bytes | 6,369,564 bytes | +2,812 bytes / +0.044% |

The menu styling makes CSS size **regressed**; JavaScript, native executable, and Debian movements are **no material change**. Header hierarchy, project switching discoverability, tool-window closure consistency, ignored-directory truthfulness, and compact icon legibility are **improved**. Installed Linux/macOS placement and native tooltip timing remain manual acceptance items. The next shell change must reuse the documented one-title and top-right Hide invariants instead of adding a second label or an activity-rail-only close path.

The refreshed unsigned local acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,369,564 bytes, with SHA-256 `d8d686da184b7844294bcc7ad40101680e86f84eaaba0578d66b39efec6bd6db`. Package inspection confirms version 0.1.0 and `amd64`; the release executable passed the isolated native smoke. No remote push is made.

## Cross-platform editor typography calibration

Manual comparison on 2026-09-11 invalidated the earlier assumption that copying Android Studio's published `13` and `1.20` numeric settings would reproduce its appearance. The local Android Studio profile has no editor-font override, but its bundled font is private to the JBR runtime. Asterlyn's former CSS list did not bundle a font; on the same Linux machine `JetBrains Mono` was unavailable to fontconfig while `Consolas` resolved, so the WebView rendered different glyph metrics. CSS pixels, fractional line boxes, WebView rasterization, and JBR font metrics also make identical numeric settings visually non-equivalent.

Asterlyn now self-hosts Source Code Pro Variable 5.3.0 through Fontsource. The font is independent from JetBrains assets and distributed under the SIL Open Font License 1.1; the production frontend emits `licenses/source-code-pro-OFL.txt`, and native bundles also carry it as an explicit application resource. CodeMirror content and gutters plus rendered Markdown code share the application-owned font family. The editor fixes weight at 400, disables synthetic faces, kerning, discretionary ligatures, and contextual alternates, and retains normal zero letter spacing. CJK and other uncovered glyphs use an explicit system-monospace fallback.

The calibrated untouched default is 14 CSS pixels with a 1.35 line-height factor. In the production-like browser, the resulting first line box measured 18.890625 pixels and computed to 18.9 pixels; the selected font family began with `Source Code Pro Variable`, the font-loading API reported it loaded, letter spacing computed to `normal`, both content and gutters resolved the same family, and no warning or error was reported. This confirms deterministic font selection and geometry in Chromium, not installed macOS WebKit pixel parity. Version-four preference loading migrates version-one `12/1.62` and version-two or version-three `13/1.20` untouched defaults to the new baseline while preserving tested non-default values.

The complete frontend suite passes 142 tests, TypeScript checking and production build pass, 28 Git crate tests pass, Debian packaging succeeds, and the release executable remains alive for the six-second isolated native smoke interval. Package inspection confirms the 4,314-byte OFL text at `usr/lib/Asterlyn/licenses/source-code-pro-OFL.txt`.

| Output | Project-chrome correction | Typography calibration | Movement |
| --- | ---: | ---: | ---: |
| CSS | 75.44 kB | 94.18 kB | +18.74 kB / +24.84% |
| CSS gzip | 14.49 kB | 26.27 kB | +11.78 kB / +81.30% |
| Main JavaScript | 647.57 kB | 647.90 kB | +0.33 kB / +0.05% |
| Main JavaScript gzip | 186.82 kB | 186.90 kB | +0.08 kB / +0.04% |
| Main JavaScript source map | 2,381.53 kB | 2,382.73 kB | +1.20 kB / +0.05% |
| Linux release executable | 18,409,648 bytes | 18,587,056 bytes | +177,408 bytes / +0.96% |
| Debian package | 6,369,564 bytes | 6,548,920 bytes | +179,356 bytes / +2.82% |

CSS and Debian size are **regressed** because the application now owns normal and italic Unicode-subset WOFF2 assets; JavaScript movement is **no material change**. Default readability and cross-platform font determinism are **improved**. No repeated font-load timing, installed WebKit frame-time, process-tree PSS/RSS, or forced browser-heap series was captured, so startup cost, scrolling performance, and memory remain **inconclusive**. The next action is installed Linux and macOS visual acceptance rather than further numerical tuning from Chromium alone.

The refreshed unsigned local acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,548,920 bytes, with SHA-256 `ea8575569d0ce6a4e4d7e259778bee6cc1d002303849becffd552bd9d8711e95`. No remote push is made.

## Bundled font family and optional downloads follow-up

The 2026-09-11 follow-up replaces the temporary Source Code Pro default from the preceding calibration with the user's chosen JetBrains Mono. The baseline for size comparison is commit `65caee5` and its recorded Source Code Pro build. Asterlyn consumes JetBrains Mono 5.3.0 from the public Fontsource package under OFL-1.1; this is a pinned upstream dependency, not the font extracted from Android Studio or JBR. Its license is emitted as `licenses/jetbrains-mono-OFL.txt` in both the frontend output and native bundle.

The Editor settings now expose five bounded font identifiers. JetBrains Mono is the only family shipped in the application. Cascadia Code, Fira Code, Source Code Pro, and IBM Plex Mono point to exact Fontsource 5.3.0 Latin WOFF2 assets on one CSP-allowed jsDelivr origin. Each asset has a fixed SHA-256 digest and 256-KiB ceiling; redirects, empty/oversized responses, failed integrity, and failed font decoding are rejected before preference activation. Verified bytes are cached in profile storage and reverified before later use. The previous working family remains active on failure, and a failed selection has an explicit retry action.

Production-like browser acceptance selected Fira Code from the settings page. The UI reported `Downloaded, verified, and cached`, the root family changed to `Asterlyn Fira Code`, and a reload reported `Loaded from verified local cache`; no warning or error was recorded. Returning to the bundled default produced a live CodeMirror content family beginning with `JetBrains Mono Variable`; the browser font set reported it loaded, with the preserved 14-pixel size and 18.9-pixel computed line box. This verifies the frontend loading, integrity, cache, preference, and CodeMirror application paths in Chromium. It does not establish installed macOS WebKit rendering parity or CDN availability in every region.

The complete frontend suite passes 146 tests, TypeScript checking and production build pass, and the Rust workspace passes 65 tests. The release executable remains alive for the six-second isolated native smoke interval. Debian inspection confirms package `asterlyn` version `0.1.0`, architecture `amd64`, and the 4,524-byte JetBrains Mono OFL file; no optional font package is a production dependency or bundle resource.

| Output | Source Code Pro baseline | JetBrains Mono + selector | Movement |
| --- | ---: | ---: | ---: |
| CSS | 94.18 kB | 85.44 kB | -8.74 kB / -9.28% |
| CSS gzip | 26.27 kB | 20.36 kB | -5.91 kB / -22.50% |
| Main JavaScript | 647.90 kB | 656.18 kB | +8.28 kB / +1.28% |
| Main JavaScript gzip | 186.90 kB | 189.63 kB | +2.73 kB / +1.46% |
| Main JavaScript source map | 2,382.73 kB | 2,405.76 kB | +23.03 kB / +0.97% |
| Linux release executable | 18,587,056 bytes | 18,600,144 bytes | +13,088 bytes / +0.07% |
| Debian package | 6,548,920 bytes | 6,563,164 bytes | +14,244 bytes / +0.22% |

The result is **mixed**: deterministic user-selected typography and bundled CSS size are improved, main JavaScript is regressed by the bounded loader and verification path, and native/package size movement is no material change. Memory is **inconclusive** because no process-tree comparison was run; only one optional Latin face is needed for the active choice, but selecting several families in one window intentionally retains their already decoded faces for fast switching. Optional italic faces, offline redistribution, cache management UI, installed macOS visual acceptance, and non-Latin coverage beyond the explicit system fallback remain limitations. The next action is manual Debian acceptance of JetBrains Mono's density and the settings interaction before any further typography calibration.

The refreshed unsigned local acceptance package is `Asterlyn_0.1.0_amd64.deb`, 6,563,164 bytes, with SHA-256 `eff165685acb7104eac0a7ef6aea5a4a70e1fc15b6b61fc85e5c6b5880248601`. No remote push is made.
