# Editor core interaction plan

## Outcome

Stage 3 makes Asterlyn dependable as a text/code editor with language intelligence disabled. It proceeds through independently reversible slices so file safety and buffer lifetime are proven before search, services, or extensibility depend on them.

## E1 — Safe multi-tab text editing

E1 replaces the project-file placeholder with a complete explicit-save loop:

- Open tracked or non-ignored untracked files from the bounded project tree using an exact Git-root-qualified identity.
- Keep up to 20 heterogeneous tabs: persistent editable text tabs plus one replaceable read-only Diff preview.
- Deduplicate repeated file opens, switch tabs without losing exact content, close clean tabs, and retain dirty tabs until Save succeeds or the user cancels.
- Edit UTF-8 text up to two MiB in the CodeMirror adapter, preserving BOM, LF/CRLF/mixed separators, bare CR, and final-newline state.
- Save through a freshly authorized, optimistic, same-directory atomic replacement. A conflict preserves the local buffer and never exposes force overwrite.
- Preserve text tabs across repository refresh. Save All or Cancel protects repository and window transitions.

E1 intentionally adds no syntax mode, watcher, autosave, draft persistence, force/discard, file creation, workspace search, split editor, terminal, or language service. Basic parser-backed syntax highlighting is pulled forward into E2.2 after E1 acceptance; language intelligence remains outside this stage.

### E1 acceptance

- Rust tests cover authorized tracked/untracked identity, path escape and link rejection, text/size/encoding policy, exact byte round trips, permission preservation, conflict safety, idempotent retry, and concurrent-save serialization.
- TypeScript tests cover tab deduplication, Diff preview replacement, stale load/save rejection, edits during save, exact mixed-line-ending composition, dirty transition guards, and the 20-tab bound.
- Browser interaction covers opening and switching at least two files, editing, dirty markers, `Ctrl/Cmd+S`, clean close, Diff preview coexistence, and refresh retention using the deterministic bridge.
- Native Linux interaction covers one real read, save, external conflict, and retry-safe result against a disposable repository. Existing working and commit Diff journeys remain usable.
- Acceptance records absolute build/resource results, limitations, and next action. Packaging and remote publication wait for the agreed larger Stage 3 checkpoint.

### E1 local acceptance — 2026-09-09

E1 is locally accepted as the first Stage 3 slice. Compared with the previous read-only project-file placeholder and single volatile Diff document, the center workbench now keeps up to 20 persistent text tabs alongside one replaceable Diff preview, preserves exact text while switching and refreshing, and protects dirty buffers with explicit Save-or-Cancel transitions.

The absolute local evidence is six `asterlyn-workspace` tests, 28 `asterlyn-git` tests, four desktop-library tests, and 68 frontend script tests. TypeScript checking and the production frontend build pass. The deterministic browser journey opened and switched between two files, edited and saved with `Ctrl/Cmd+S`, closed a clean tab, kept text tabs beside a Diff preview, retained an unsaved buffer across repository refresh, and kept a dirty tab open when close was cancelled. A native Linux debug executable remained alive for the six-second smoke interval against a disposable repository. The desktop-library boundary additionally performed a real tracked-file read/save, preserved an external edit on revision conflict, rejected an ignored file, and freshly revoked save authorization after a formerly tracked file became ignored.

The production build emitted 50.40 kB CSS (10.00 kB gzip) and 509.34 kB JavaScript (150.19 kB gzip), with a 2,048.12 kB JavaScript source map. No comparable pre-E1 asset measurement is retained, and the agreed phase checkpoint defers packaging and the normalized 60-second resource series. The interaction and correctness conclusion is **improved**; bundle-size movement, startup, and memory impact are **inconclusive**. Vite's greater-than-500-kB main-chunk warning remains visible rather than being treated as an accepted performance result.

Known limits are UTF-8 text up to two MiB, 20 text tabs, explicit save only, and no syntax modes, file watching, recovery, autosave, safe discard, file creation/rename/delete, or durable undo history for an unmounted editor adapter. Atomic replacement preserves ordinary file permissions but not ACLs or extended attributes. The final validation-to-replacement interval retains a documented local path-substitution race, and non-Unix hard-link parity is not yet accepted. Windows/macOS installed interaction also remains deferred. The next product action is E2's bounded, keyboard-first navigation and search surface.

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

- **E3.1 — Workbench navigation and preference foundation:** add explicit project-tree file/folder selection, locate-current-file, recursive expand/collapse, Git-derived semantic path colors, display-only ignored entries, shared text/Diff syntax presentation, and a full settings route. Persist only the implemented bounded choices: application font, editor font and line height, tab display width, Diff layout, and whitespace visibility. Mark localization, light/system themes, and per-language formatting as planned.
- **E3.2 — Editor groups and tab movement:** add a typed editor-group model, horizontal and vertical splits, keyboard group focus, tab movement, split restoration, and explicit close/dirty-buffer rules without duplicating document ownership.
- **E3.3 — Text and keymap controls:** add keymap conflict handling, per-language indentation and formatting adapters, encoding/EOL inspection and conversion, and format-on-save only after the formatter boundary and recovery behavior are testable.
- **E3.4 — External change and scale policy:** add file watching as coalesced hints, external-change comparison, measured large-file modes, parser/service cutoffs, and resource gates before E3 closes.

### E3.1 local acceptance — 2026-09-10

E3.1 is locally accepted. The Files tool now has compact locate, recursive-expand, and recursive-collapse actions. File and directory rows share one explicit selected state, and locating works for editable files, working-tree Diff, and commit Diff whenever the path still exists in the bounded tree. Current change kinds and Git-ignored entries receive semantic colors while retaining textual or glyph status. Ignored paths are obtained through a separate bounded display query and remain excluded from every read, save, search, and replacement authorization catalog.

The Diff adapter now uses the same on-demand filename-to-parser loader and token palette as the text editor in unified and split layouts. The new Settings route keeps the workbench mounted and groups General, Appearance, Editor, Version Control, and Languages. It persists only six implemented preference fields and updates mounted editors immediately; unavailable localization, theme, and language-formatting services are explicitly labelled planned.

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

### E4 — Recovery and task surfaces

Add atomic draft recovery, restart/session restoration, safe discard, autosave policy, terminal/task surfaces, cancellation, trust prompts, and data-loss fault testing required by the Stage 3 exit gate.
