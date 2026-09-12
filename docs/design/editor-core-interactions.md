# Editor core interaction plan

## Outcome

Stage 3 makes Asterlyn dependable as a text/code editor with language intelligence disabled. It proceeds through independently reversible slices so file safety and buffer lifetime are proven before search, services, or extensibility depend on them.

## E1 — Safe multi-tab text editing

E1 replaces the project-file placeholder with a complete explicit-save loop:

- Open tracked or non-ignored untracked files from the bounded project tree using an exact Git-root-qualified identity.
- Keep up to 20 retained editable text tabs plus one replaceable read-only Diff preview. Opening beyond the retained-state bound automatically retires the oldest inactive clean tab; dirty or saving buffers remain protected.
- Deduplicate repeated file opens, switch tabs without losing exact content, close clean tabs, and retain dirty tabs until Save succeeds or the user cancels.
- Edit UTF-8 text up to two MiB in the CodeMirror adapter, preserving BOM, LF/CRLF/mixed separators, bare CR, and final-newline state.
- Save through a freshly authorized, optimistic, same-directory atomic replacement. A conflict preserves the local buffer and never exposes force overwrite.
- Preserve text tabs across repository refresh. Save All or Cancel protects repository and window transitions.

E1 intentionally adds no syntax mode, watcher, autosave, draft persistence, force/discard, file creation, workspace search, split editor, terminal, or language service. Basic parser-backed syntax highlighting is pulled forward into E2.2 after E1 acceptance; language intelligence remains outside this stage.

### E1 acceptance

- Rust tests cover authorized tracked/untracked identity, path escape and link rejection, text/size/encoding policy, exact byte round trips, permission preservation, conflict safety, idempotent retry, and concurrent-save serialization.
- TypeScript tests cover tab deduplication, Diff preview replacement, stale load/save rejection, edits during save, exact mixed-line-ending composition, dirty transition guards, clean-tab retirement at the 20-state bound, and refusal when all retained buffers are dirty.
- Browser interaction covers opening and switching at least two files, editing, dirty markers, `Ctrl/Cmd+S`, clean close, Diff preview coexistence, and refresh retention using the deterministic bridge.
- Native Linux interaction covers one real read, save, external conflict, and retry-safe result against a disposable repository. Existing working and commit Diff journeys remain usable.
- Acceptance records absolute build/resource results, limitations, and next action. Packaging and remote publication wait for the agreed larger Stage 3 checkpoint.

### E1 local acceptance — 2026-09-09

E1 is locally accepted as the first Stage 3 slice. Compared with the previous read-only project-file placeholder and single volatile Diff document, the center workbench now keeps up to 20 persistent text tabs alongside one replaceable Diff preview, preserves exact text while switching and refreshing, and protects dirty buffers with explicit Save-or-Cancel transitions.

The absolute local evidence is six `asterlyn-workspace` tests, 28 `asterlyn-git` tests, four desktop-library tests, and 68 frontend script tests. TypeScript checking and the production frontend build pass. The deterministic browser journey opened and switched between two files, edited and saved with `Ctrl/Cmd+S`, closed a clean tab, kept text tabs beside a Diff preview, retained an unsaved buffer across repository refresh, and kept a dirty tab open when close was cancelled. A native Linux debug executable remained alive for the six-second smoke interval against a disposable repository. The desktop-library boundary additionally performed a real tracked-file read/save, preserved an external edit on revision conflict, rejected an ignored file, and freshly revoked save authorization after a formerly tracked file became ignored.

The production build emitted 50.40 kB CSS (10.00 kB gzip) and 509.34 kB JavaScript (150.19 kB gzip), with a 2,048.12 kB JavaScript source map. No comparable pre-E1 asset measurement is retained, and the agreed phase checkpoint defers packaging and the normalized 60-second resource series. The interaction and correctness conclusion is **improved**; bundle-size movement, startup, and memory impact are **inconclusive**. Vite's greater-than-500-kB main-chunk warning remains visible rather than being treated as an accepted performance result.

Known limits are UTF-8 text up to two MiB, at most 20 retained text states with automatic clean-tab retirement, explicit save only, and no syntax modes, file watching, recovery, autosave, safe discard, file creation/rename/delete, or durable undo history for a released editor session. When all 20 buffers are dirty or saving, another file cannot open until the user saves or closes one. Atomic replacement preserves ordinary file permissions but not ACLs or extended attributes. The final validation-to-replacement interval retains a documented local path-substitution race, and non-Unix hard-link parity is not yet accepted. Windows/macOS installed interaction also remains deferred. The next product action is E2's bounded, keyboard-first navigation and search surface.

## Later Stage 3 slices

### E2 — Navigation and search

Add file/text search and replace, recent files, go-to-file, command palette, symbol-free navigation, and keyboard-first result traversal over bounded workspace services.

E2 is split so read-only discovery cannot quietly create a bulk-write surface:

- **E2.1 — Command surface and bounded search:** add `Ctrl/Cmd+P` files, `Ctrl/Cmd+E` repository-scoped recents, `Ctrl/Cmd+Shift+F` cancellable workspace text search, `Ctrl/Cmd+Shift+P` commands, result-to-editor navigation, and visible active-buffer find/replace through CodeMirror.
- **E2.2a — On-demand syntax highlighting:** make readable editing the first follow-up by matching CodeMirror language descriptions from the exact filename, loading only the selected parser chunk, applying an Asterlyn dark highlight style, and falling back to plain text without blocking file access. Parser loads must not enter the startup path or let a late result reconfigure a subsequently opened tab.
- **E2.2b — Search refinement:** add measured include/exclude controls, regular expressions, context expansion, and any index only after the scan implementation supplies a comparison baseline.
- **E2.3 — Recoverable workspace replacement:** add multi-file preview and rollback/recovery only after the product can prove that interruption, conflict, partial failure, and user cancellation cannot silently lose work.

E2.1 follows [`ADR-0005`](../architecture/decisions/0005-bounded-navigation-search.md). Its acceptance requires pure ranking/recent/navigation tests; bounded search tests covering Unicode, case, CRLF/bare-CR coordinates, unsupported-file accounting, every limit, and cancellation; desktop tests proving fresh Git authorization and stale repository denial; browser keyboard journeys for all four modes and result navigation; accessibility names, selection state, and focus restoration; and recorded latency, build-size, and resource evidence. Packaging and remote publication remain at the larger Stage 3 checkpoint.

### E2.1 local acceptance — 2026-09-09

E2.1 is locally accepted. One keyboard-first surface now provides Quick Open, repository-scoped Recent Files, read-only workspace text search, and a safe command registry. The desktop boundary regenerates the Git-authorized candidate catalog for every search; the pure workspace layer performs a cancellable bounded scan; and result activation repeats the E1 read before applying a root-qualified, revision-matched UTF-16 location. Dirty buffers, old roots, stale revisions, unsupported files, and late requests fail closed. CodeMirror exposes active-file Replace All as an undoable buffer operation, while workspace replacement remains absent.

The complete evidence is recorded in [`E2.1 bounded navigation and search evidence`](../benchmarks/2026-09-09-e2-1-navigation-search.md). Search over the current 161-candidate checkout had a 15.908-millisecond median combined core path across ten iterations. Validation passed 13 workspace, 28 Git, seven desktop, and 83 frontend tests plus strict checks, production build, deterministic browser interaction, and native liveness. The interaction/correctness and named-fixture latency conclusions are **improved**.

The frontend bundle grew 4.67% raw and 3.90% gzip in JavaScript, so bundle size is **regressed** and the existing chunk warning remains open. Three matched short-settle runs measured a 232.41 MiB median process-tree PSS, 8.02 MiB above U11.1 and above the provisional ceiling. Observed idle resources are therefore **regressed**, while attribution remains **inconclusive** because the comparison includes unmeasured E1 movement and is not the normalized 60-second protocol. Packaging and remote publication remain deferred by agreement. E2.2a on-demand syntax highlighting is next, followed by E2.2b read-only search refinement; the normalized resource follow-up remains mandatory before the larger Stage 3 checkpoint.

### E2.2a local acceptance — 2026-09-09

E2.2a is locally accepted as the first syntax-highlighting slice. The editor now matches the current CodeMirror catalog's 143 language descriptions by filename or extension, dynamically loads the catalog and selected parser after a text editor mounts, applies a contrast-checked Asterlyn token theme, rejects stale parser completions, and falls back to plain text without blocking editing. TypeScript and Markdown production-browser journeys confirmed visible token styles, edit/save continuity, language switching, and an empty warning/error console.

The complete evidence is recorded in [`E2.2a on-demand syntax highlighting evidence`](../benchmarks/2026-09-09-e2-2a-syntax-highlighting.md). Validation passed 88 frontend, 13 workspace, 28 Git, and seven desktop tests plus formatting, strict Clippy, TypeScript checking, and the production build. Main JavaScript increased from 533.11 to 557.48 kB raw and from 156.05 to 164.41 kB gzip, so main-bundle size is **regressed**. The broad lazy catalog raises total emitted JavaScript to 1,797,976 bytes across 121 files, also **regressed**, while a clean welcome page requests no catalog or parser asset. One focused production-browser observation measured a 1.80 MiB used-JavaScript-heap increase from welcome to an active TypeScript editor, but it includes editor creation and had no forced collection, so memory impact is **inconclusive**.

No native package or remote publication is produced for this sub-slice. E2.2b read-only search refinement is next. Before the larger Stage 3 package checkpoint, compare the current broad catalog with curated or separately installed language packs and run the pending normalized native resource series.

### E2.2b local acceptance — 2026-09-09

E2.2b is locally accepted. Find in Files now adds bounded line-local regular expressions, complete workspace-path include/exclude globs, and zero to three context lines without adding an index, cache, watcher, startup scan, or replacement surface. The default literal entry point remains compatible. Every option participates in stale-response identity, path filtering preserves the Git catalog index, intentional exclusions have a separate eligible count, and result activation still repeats E1 authorization and revision checks.

The complete evidence is recorded in [`E2.2b bounded search-refinement evidence`](../benchmarks/2026-09-09-e2-2b-search-refinement.md). Validation passed 17 workspace, 28 Git, seven desktop, and 90 frontend tests plus formatting, strict Clippy, TypeScript checking, production build, native smoke, and production-browser interaction. On the current 164-candidate checkout, the unchanged literal query produced a 15.629-millisecond median combined catalog-and-scan path, 1.75% below the 15.908-millisecond E2.1 baseline despite a larger fixture; the conclusion is **no material change**. Main JavaScript increased by 6.18 kB raw and 1.89 kB gzip, so frontend size is **regressed**. The native executable is cumulatively 16.69% larger than the last retained E2.1 reference, but the missing E2.2a native measurement prevents attribution to this sub-slice. A single uncollected production-browser observation measured a 1,316,112-byte used-heap increase while opening and populating the complete search surface, so memory impact remains **inconclusive**.

No native package or remote publication is produced for this sub-slice. The measured scan does not justify persistent indexing. E2.3 recoverable workspace replacement is next; language-catalog packaging and the normalized native resource series remain Stage 3 checkpoint gates.

### E2.3 local acceptance — 2026-09-10

E2.3 is locally accepted and completes E2. Find in Files now builds a fresh non-mutating before/after plan, defaults every changed file to selected, applies only the reviewed file selection, and retains exact application-local recovery until explicit keep or rollback. The workspace core blocks structurally incomplete previews, preflights all revisions, journals before the first write, uses E1 atomic saves, automatically restores after cancellation or partial failure, and preserves independently edited files instead of forcing rollback. Open dirty target tabs block mutation; successful apply and rollback reconcile clean tabs, search results, and the Changes snapshot without replacing the active editor or Git-history query.

The complete evidence is recorded in [`E2.3 recoverable workspace-replacement evidence`](../benchmarks/2026-09-10-e2-3-recoverable-replacement.md). Validation passed 23 workspace, 28 Git, nine desktop, and 93 frontend tests plus strict checks, production build, browser apply/rollback/keep journeys, and native liveness. Complete planning on the current 169-candidate checkout had a 22.446-millisecond median for 35 files/91 matches and 12.416 milliseconds for five files/17 matches under `src/**`. Interaction and recovery correctness are **improved**; frontend size is **regressed**; focused memory remains **inconclusive**.

No package or remote publication is produced for this sub-slice. E3 editor groups and preferences is next. Broad language-catalog packaging, normalized native resources, and installed Windows/macOS interaction remain open for the larger Stage 3 checkpoint.

### E3 — Editor groups and preferences

E3 is split into four independently reversible slices so a settings shell does not imply that every future preference already works:

- **E3.1 — Workbench navigation and preference foundation:** add explicit project-tree file/folder selection, locate-current-file, recursive expand/collapse, Git-derived semantic path colors, display-only ignored entries, shared text/Diff syntax presentation, and a full settings route. Persist only the implemented bounded choices: application font; editor font, line height, letter spacing, inserted-space indent size, and tab display width; Diff layout; and whitespace visibility. Mark localization, light/system themes, and per-language formatting as planned.
- **E3.2 — Editor groups and tab movement:** add a typed editor-group model, horizontal and vertical splits, keyboard group focus, tab movement, split restoration, and explicit close/dirty-buffer rules without duplicating document ownership.
- **E3.3 — Text and keymap controls:** add keymap conflict handling, per-language indentation and formatting adapters, encoding/EOL inspection and conversion, and format-on-save only after the formatter boundary and recovery behavior are testable.
- **E3.4 — External change and scale policy:** add file watching as coalesced hints, external-change comparison, measured large-file modes, parser/service cutoffs, and resource gates before E3 closes.

### E3.1 local acceptance — 2026-09-10

E3.1 is locally accepted. The Files tool now has compact locate, recursive-expand, and recursive-collapse actions. File and directory rows share one explicit selected state, and locating works for editable files, working-tree Diff, and commit Diff whenever the path still exists in the bounded tree. Current change kinds and Git-ignored entries receive semantic colors while retaining textual or glyph status. Ignored paths are obtained through a separate bounded display query and remain excluded from every read, save, search, and replacement authorization catalog.

The Diff adapter now uses the same on-demand filename-to-parser loader and token palette as the text editor in unified and split layouts. The new Settings route keeps the workbench mounted and groups General, Appearance, Editor, Version Control, and Code. It persists only eight implemented preference fields and updates mounted editors immediately; unavailable localization, theme, and language-formatting services are explicitly labelled planned.

The complete evidence is recorded in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md). Validation passed 97 frontend, 28 Git, 23 workspace, and ten desktop tests plus formatting, strict Clippy, TypeScript checking, production build, browser interaction, and six-second native liveness. Interaction and presentation consistency are **improved**. CSS and frontend JavaScript size are **regressed**, the native executable has **no material change**, and memory impact is **inconclusive** because no matched native resource series was run.

No installer or remote publication is produced for this sub-slice. E3.2 editor groups and tab movement is next; settings cannot grow new writable controls until their underlying service boundary is implemented.

### E3.1 desktop-shell correction — 2026-09-10

The E3.1 shell follow-up aligns the default visual scale with the locally installed Android Studio new UI and the published JetBrains guidance: application and editor defaults are 13 px, editor line height is 1.20, the custom title/menu bar is 48 px high, primary shell actions use 18–20 px artwork, and standard window-control glyphs remain 16 px. Version-two preference loading migrates untouched former defaults but preserves deliberate custom values. The project identity control is now the first title-bar item; the duplicate brand block is removed.

The first project selection still replaces the empty current window. Selecting a different project from an occupied window now requires an explicit current-window or new-window choice. New windows receive independent Rust-side workspace authorization, pending launch paths, and cancellable scan identities keyed by window label. Editor tabs also accept a vertical mouse wheel as bounded horizontal movement without exposing a second visible scrollbar.

Desktop icons are regenerated from one full-canvas source and the repository retains only the current desktop bundle set. The complete evidence is recorded in [`E3.1 desktop-shell correction evidence`](../benchmarks/2026-09-10-e3-1-desktop-shell.md). Validation passed 102 frontend tests, 28 Git tests, 23 workspace tests, 12 desktop tests, strict checks, a production frontend build, a release native build, deterministic browser interaction, six-second native liveness, and Debian package inspection. Interaction and platform-asset consistency are **improved**. Frontend size has **no material change**; the native executable is **regressed** by 12.36% after linking dynamic native-window construction; memory remains **inconclusive** because no matched resource series was run. One local Debian acceptance package is produced without a remote push, and E3.2 remains next.

Manual acceptance then exposed a shell permission regression that blocked both the custom close control and operating-system close requests. The correction grants the destroy operation to project windows and uses it only after the existing dirty-buffer save-or-cancel gate. Two focused tests, a real pointer-close run, a separate `Alt+F4` run, and the refreshed Debian package are recorded in the same evidence page. Close behavior is **improved** and the correction's executable-size movement is **no material change**.

The platform-chrome follow-up replaces the one-style-fits-all undecorated window with one shared native-window factory. macOS now retains its operating-system title-bar decorations, left-side traffic lights, and overlay integration while hiding Asterlyn's duplicate custom controls; Windows and Linux retain the existing compact right-side custom controls. Both the initial and additional project windows use this policy. Linux release-window maximize and close paths passed, while drag/minimize automation and installed macOS visual interaction remain explicit manual-acceptance items. This changes shell presentation only and leaves the dirty-buffer gate and per-window workspace ownership intact.

### E3.1 project-tree refresh and resize correction — 2026-09-10

The Files tool now separates its 100,000-file navigation and exact-authorization catalog from the existing 5,000-candidate workspace-search budget. Closed directories retain their model nodes but mount no descendant rows until opened, and the tree projection is cached for one exact snapshot. Splitter pointer bursts apply only the latest value in each animation frame, write only the affected layout property, and request editor measurement only when the editor viewport changes.

Refreshing the same repository no longer invokes the repository-switch reset path. The previous catalog remains visible while the replacement loads; exact path-and-kind reconciliation retains valid selected and expanded nodes plus the tree scroll offset, while removed identities are discarded. Repository switching still resets project-tree state. The same correction preserves valid history filters and editor tabs while maintaining generation checks, search/replacement invalidation, and fresh Git truth.

The updated acceptance evidence is recorded in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md). Interaction and catalog coverage are **improved**; frontend, native, and package-size movements are **no material change**; memory remains **inconclusive** because no matched process-tree resource series was run. The task ends with one fresh local Debian package and no remote push.

### E3.1 editor-tab and status correction — 2026-09-10

The ordinary text editor now starts immediately below its tab row instead of repeating path, title, save state, and a Save button in a second header. Explicit save remains available through `Ctrl/Cmd+S` and the command surface. The active loaded text file's UTF-8/BOM encoding moves to the bottom status bar immediately before branch state; Diff documents retain their compact contextual presentation toolbar.

Dirty state now compares the current exact buffer with the most recent successfully loaded or saved exact content. Undoing back to that baseline removes the dirty marker, and a completed save advances only to the request's captured content so later edits remain dirty. Text and working-Diff tabs project the same Git status classes as the Files tree. A fixed trailing tab-menu button lists every open text tab and the bounded Diff preview; selecting an item activates the existing document and scrolls its tab into view.

Successful editor saves also debounce a repository-status update. One active-root-authorized tracked query updates the shared snapshot used by Changes, Files, editor tabs, and working Diff without reopening the repository or replacing history, project-tree disclosure, or editor state. A matching-generation untracked supplement follows silently; a stale root or generation cannot repaint the current workspace. External filesystem changes still require another event or explicit refresh until filesystem watching is introduced.

The left splitter also owns an explicit pointer drag lifetime. It consumes movement and release at the window boundary, safely finalizes lost pointer capture, clips the Files pane, and suppresses its overlay scrollbar only while dragging. This targets the macOS WebKit compositor artifact in which the scrollbar remained at the old pane edge while the divider moved. Local browser interaction proves final divider/pane alignment and scrollbar restoration; installed macOS visual confirmation remains part of manual acceptance.

The updated evidence is recorded in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md). Correctness and interaction are **improved**; frontend size is **regressed** by the open-document menu, native and package movement are **no material change**, and memory impact remains **inconclusive** because no matched resource series was run. The task produces one local Debian package without a remote push; E3.2 remains next.

### E3.1 code-folding and Markdown-presentation correction — 2026-09-10

Parser-backed source files now expose CodeMirror's fold gutter and standard fold, unfold, fold-all, and unfold-all shortcuts. This reuses the parser already selected for syntax highlighting and adds no language service, index, watcher, or repository query.

Markdown text tabs now own a transient Source, Split, or Preview presentation mode. Split mode keeps the authoritative editable buffer beside a live `markdown-it` projection and provides a pointer- and keyboard-resizable divider; Preview mode unmounts only the CodeMirror widget while preserving tab identity, exact buffer content, dirty state, and explicit-save behavior. Switching files or modes rejects stale preview completions. The renderer loads on first preview use, escapes raw HTML, displays non-fetching image placeholders, and keeps links non-navigating. Preview is bounded to 512 KiB; larger Markdown remains fully editable through the existing two-MiB text path.

The updated evidence is recorded in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md). Browser interaction proves folding and unfolding, all three Markdown modes, live buffer-to-preview updates, exact content retention, and separator keyboard adjustment. Functionality and interaction are **improved**; frontend, executable, and package sizes are **regressed**, and memory remains **inconclusive** without a matched resource series. The task produces one refreshed local Debian package without a remote push; trusted media/link routing, exact source-to-rendered anchors, persisted preview choices, and E3.2 editor groups remain later work.

### E3.1 Markdown-scroll and fold-control correction — 2026-09-11

Full Markdown Preview now occupies the editor body's bounded grid track instead of sizing itself from rendered content inside a clipped parent. The preview region owns vertical overflow, so short documents fill the available editor while long documents scroll independently without moving the workbench. Preview remains deliberately read-only: `markdown-it` is a renderer rather than a structured Markdown editor, and making rendered HTML editable would require an explicit bidirectional source-mapping, selection, undo, and save design. Source and Split remain the supported editing modes, and the Preview control identifies its read-only behavior in its tooltip.

The parser-backed CodeMirror fold gutter now uses original high-contrast SVG chevrons in a 19-pixel gutter with a 17-by-18-pixel pointer target and hover state. A downward chevron folds a structural region and the resulting rightward chevron unfolds it; the existing standard keyboard fold/unfold commands remain available. This is a presentation correction over the existing fold service and adds no parser, index, watcher, or language-service work.

The updated evidence is recorded in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md). Long-preview wheel scrolling and pointer fold/unfold pass in a production-like browser journey, the frontend suite remains green, and native liveness passes. Functionality and discoverability are **improved**; output-size movement is **no material change** and memory remains **inconclusive** because no matched resource series was run. One refreshed local Debian package is produced without a remote push.

### E3.1 legacy-language folding correction — 2026-09-11

Language folding now follows [`ADR-0006`](../architecture/decisions/0006-language-adapter-evolution.md). Kotlin and Groovy/Gradle retain their on-demand CodeMirror stream highlighters and add only a token-aware brace-folding adapter over the active editor state. The adapter ignores braces classified as strings, regular expressions, or comments; chooses the outer structural block when multiple openings share a line; caches ranges against the immutable editor state and current syntax tree; and fails closed above one MiB. XML retains its Lezer parser but moves paired-element folding from the final line of a multiline opening tag to the tag's first line.

This correction does not introduce Tree-sitter, LSP, completion, navigation, diagnostics, formatting, symbol extraction, a worker, or an index. Those remain separately gated Stage 4 work. Focused fixtures cover Kotlin classes/functions/conditions, Groovy Gradle blocks, false braces in strings/comments, multiline Android XML, and the large-file cutoff. The updated evidence remains in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md).

### E3.1 editor response and file-icon correction — 2026-09-11

Text-tab activation now preserves the tab's CodeMirror state instead of recreating a plain document and reloading its language on every switch. Only one editor view remains mounted, so the bounded state cache retains parsing, selection, undo, and scroll continuity without keeping 20 hidden editor DOM trees. Consecutive tree selections avoid rebuilding the Files tool; asynchronous file and language completions remain identity-guarded so the final selection wins. Exact-content publication is coalesced to a frame and the mixed-line-ending adapter updates only the normalized text and separator slice addressed by a transaction.

The editor line begins directly after the structural gutters with no additional left padding. Project files, text tabs, the open-file menu, and commit files share an original 16-pixel document-icon family. Static filename classification covers the common languages and project/configuration formats already relevant to Asterlyn; a neutral document remains the explicit fallback. Icons are decorative, while filename text, Git-status color, selection, and accessible labels remain authoritative. The updated evidence remains in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md).

### E3.1 startup, Markdown-scroll, and editor-spacing correction — 2026-09-11

A missing recent repository is now a recoverable startup hint: Asterlyn removes it and opens the normal system folder chooser without displaying the Git failure as a fatal toast. The native smoke harness places XDG configuration, data, cache, and state below its disposable profile, preserves the real user home, and removes both profile and repository after observation so local validation cannot become the next installed launch target.

Markdown Split links source and preview scrolling in both directions by normalized vertical progress. This works across unequal source/rendered heights, owns disposable listeners within the active Markdown surface, leaves horizontal scrolling independent, and rebinds after a live render changes preview height. It does not claim exact heading or source-line anchoring.

Editor settings now separate line spacing, letter spacing, inserted-space indent size, and visual tab width. Defaults retain the locally observed Android Studio/JetBrains baseline of 1.20 line height, normal zero letter spacing, and four-space indentation/tab width. CodeMirror receives a real indentation unit for automatic newlines and explicit indent commands; text and Diff surfaces share font, line-height, and letter-spacing variables. Settings navigation uses one label per item, removes redundant eyebrow headings, and renames `Languages` to `Code`. The updated evidence remains in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md).

### E3.1 editor typography calibration — 2026-09-11

Manual comparison showed that matching Android Studio's published numeric size and spacing did not match its rendered density. Android Studio's JBR metrics are not available to a Tauri WebView, and the former CSS family list silently selected different installed fonts by platform. Asterlyn now bundles the standalone open-source JetBrains Mono variable font from a pinned Fontsource package under the OFL; it does not read or redistribute the copy inside Android Studio. The font applies to code, Diff content, line numbers, and rendered Markdown code. The CodeMirror-specific baseline remains 14 pixels at 1.35 line height, normal zero letter spacing, 400 weight, no synthetic faces, and no discretionary or contextual ligatures. Uncovered scripts use a system monospace fallback without changing the Latin glyph source.

Version-five preferences add a bounded family identifier and migrate every older profile to bundled JetBrains Mono while preserving its explicit size and spacing choices. The JetBrains Mono OFL text is emitted into every frontend and native distribution. Cascadia Code, Fira Code, Source Code Pro, and IBM Plex Mono appear in the same Editor setting but are downloaded only after selection. Their exact versioned WOFF2 URLs and SHA-256 values form a closed catalog; successful bytes are verified, cached in the user profile when available, and loaded through the browser font API. Download, integrity, or decode failure cannot replace the working font; cache failure is reported and limits the verified face to the current window. Validation and package evidence remain on the existing [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md) page.

### E3.1 rapid file-activation correction — 2026-09-11

Repeated Files-tree activation must always converge on the last selected file. Ordinary XML, Java, Kotlin, and other source switches reuse the mounted CodeMirror view and exchange only the retained tab state. Lazy language installation yields one paint of the plain document and is cancelled when its owning tab loses activation, preventing an obsolete XML parser installation from competing with the next file's visible mount.

The 20-state ceiling remains a memory bound rather than a hidden navigation failure. Opening another file automatically retires the oldest inactive clean tab. Dirty buffers and active saves are never evicted; only the exceptional all-protected case refuses the open, restores the tree selection to the visible document, and explains the required save-or-close action. Focused session fixtures, the production-like rapid-switch journey, real `superboost` parser fixtures, complete validation, and package evidence are recorded in [`E3.1 workbench navigation and preference evidence`](../benchmarks/2026-09-10-e3-1-workbench-preferences.md).

### E3.1 ordinary-folder and image-presentation correction — 2026-09-11

A project is now an explicit workspace with optional Git capability. Selecting an ordinary folder opens its bounded Files tree, text editor, Markdown presentation, search, replacement, and raster-image preview in the current or a new window. Branches, Changes, remote sync, the Git bottom dock, keyboard Git actions, and every native Git command remain disabled. Selecting a nested directory inside a larger repository is intentionally ordinary; only an exact selected worktree root enables Git. File reads and writes continue to require a fresh current-catalog identity plus the workspace traversal checks.

Raster images use a read-only preview document and the same bounded preview slot as Diff. PNG, JPEG, static GIF, static WebP, BMP, and ICO are identified by content signature and decoded by the platform WebView from a Rust-produced fixed-media-type data URL. Working Diff compares `HEAD` with the current worktree and commit Diff uses its verified first-parent file identity. Each side is limited to 16 MiB and 16 million pixels, a pair to 24 million pixels, and animation is rejected. SVG, animated media, editing, zoom/pan, metadata inspection, perceptual overlays, and pixel-level comparison remain later capability slices.

The compact checkbox is an application-owned 14-pixel control with checked, indeterminate, hover, disabled, and keyboard-focus states; color never replaces the associated label. Commit-file details now place tree/flat, recursive expand, and recursive collapse actions in one stable toolbar. The complete validation and package record is in [`ordinary workspace and image evidence`](../benchmarks/2026-09-11-ordinary-workspace-images.md).

### E3.1 Markdown and Diff navigation correction — 2026-09-11

Markdown Split synchronization now treats wheel and trackpad bursts as frame work rather than synchronous layout work. The latest source pane in a frame wins, one proportional target write is applied at most once per frame, matching target positions are skipped, and disposal cancels pending work. The preview region is layout/paint-contained. This remains normalized progress synchronization rather than an exact source-line or heading map.

Fenced Markdown code now receives static syntax highlighting through the same on-demand CodeMirror language catalog, Lezer parsers, and semantic palette used by editors and Diff. `markdown-it` still owns Markdown-to-HTML rendering; Asterlyn supplies its explicit highlight callback. A render loads at most eight unique fence languages and highlights at most 256 Ki UTF-16 code units. Unknown, failed, malformed, or over-budget languages remain escaped plain code, and preview keeps its existing raw-HTML, remote-image, and link-navigation restrictions.

Text Diff now exposes previous/next change within the current file, previous/next changed file, open-and-reveal current source, and per-document expand/collapse unchanged-line controls. Current-file navigation stops at the file boundary, while cross-file navigation follows the current working-change or selected-commit file order. Open-and-reveal uses the existing bounded project catalog and is unavailable for a deleted or otherwise absent source. Expanded context is loaded from Git on demand and remains subject to the four-MiB patch cap; image Diff supports cross-file and source navigation but not text-hunk or context controls. Exact acceptance results are recorded in [`Markdown and Diff navigation evidence`](../benchmarks/2026-09-11-markdown-diff-navigation.md).

### E3.1 Markdown-mode memory and conflict destination — 2026-09-12

Markdown presentation choice is now bounded profile state rather than incidental active-tab state. A versioned store remembers Source, Split, or Preview for up to 128 root-qualified documents and records the last-used mode as the default for newly opened Markdown files. Existing editor sessions still own the live mode and source buffer; storage failure, malformed data, or an unknown mode falls back safely without changing content, dirty state, or save behavior. Only document identity and presentation choice persist—drafts, rendered HTML, split ratios, and editor state do not.

Remote-operation reconciliation defines one future conflict destination across Git and editor surfaces. A canonical refresh exposing unresolved paths activates Changes, includes and selects the first conflict, and opens it in Diff. Diff remains read-only in this slice, so the Update confirmation permits only fast-forward and labels Merge/Rebase unavailable instead of starting an operation the editor cannot finish. The later editable implementation must preserve this destination while adding ours/base/theirs content, resolution validation, Continue/Abort, restart recovery, and fault testing. Validation and package evidence are recorded in [`remote toolbar and Markdown-mode evidence`](../benchmarks/2026-09-12-remote-toolbar-markdown-memory.md).

### E4 — Recovery and task surfaces

Add atomic draft recovery, restart/session restoration, safe discard, autosave policy, terminal/task surfaces, cancellation, trust prompts, and data-loss fault testing required by the Stage 3 exit gate.
