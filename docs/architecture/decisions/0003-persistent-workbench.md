# ADR-0003: Persistent editor with orthogonal tool windows

- **Status:** Accepted for U6; review at the end of Stage 3
- **Date:** 2026-09-08

## Context

The first Git GUI slices used one mutually exclusive `changes | history | branches` page mode. Each mode replaced the navigation, center content, and permanent right inspector together. That was sufficient to validate Git workflows, but it conflicts with the long-term editor architecture: a file tree and Git log cannot remain visible together, changing tools destroys the editor surface, and every new capability would need another whole-page branch in the application root.

The workbench now needs to establish the layout and communication contract that later editor, terminal, search, run, debug, and language tools will use. Android Studio and the documented Rebased study are behavioral references for compact tool windows and information density only. Asterlyn continues to use original code, assets, icons, wording, and composition.

## Decision

Use three independent workbench dimensions instead of a page-mode enum:

```text
fixed activity rail
        |
        +-- left tool: Files | Changes | closed
        +-- bottom tool: Branches | closed
        +-- editor document: welcome | working diff | commit diff | future file
```

Files and Changes share the left dock and therefore replace one another. Branches uses the bottom dock independently, so Files + Branches and Changes + Branches are valid simultaneous arrangements. The center editor host remains mounted while tools open, close, switch, or resize. The permanent right inspector is removed: commit and branch details belong to the third column of the bottom Git tool, while commit actions belong to Changes.

The bottom Branches tool has three independently resizable columns: branch/ref navigation, commit history, and commit/file details. Selecting a working-tree file or commit file dispatches a typed editor-document action; tool views do not call another tool's DOM or CodeMirror lifecycle directly.

The window header presents only the active project's display name plus a disclosure control. Its absolute path is tooltip metadata rather than permanent chrome. The project menu contains the system-folder Open action and at most eight successfully opened recent projects, each with its display name and absolute path; the active project is already represented by the header and is not repeated in an `Open Projects` section. Left-tool headers contain one primary title with the bounded item count immediately adjacent. Every independently hideable tool window exposes a named Hide button at its top-right edge and routes that action through the same persisted layout transition as its activity-rail control. Hiding a tool cannot close, replace, or reload the active editor document.

Persist only a versioned layout preference document containing dock visibility and validated dimensions. Repository identity, selections, pending operations, async generations, and editor widgets are transient session state. Unknown or malformed persisted versions reset to safe defaults, and all dimensions are clamped against both component minima and the current viewport.

U6 keeps the activity rail fixed-width. Every content boundary is resizable by pointer and keyboard: left dock/editor, editor/bottom dock, the two internal Branches dividers, and the side-by-side Diff divider. Pointer-move bursts retain only the latest value for each animation frame. That value updates the affected CSS layout property directly; only dimensions that change the editor viewport request one coalesced editor measurement. The splitter controller reports an explicit drag lifetime, observes movement and release at the window boundary, and finalizes lost pointer capture. The Files pane suppresses its composited overlay scrollbar only during a left-divider drag, then restores it at the final pane width; this prevents a stale macOS WebKit scrollbar layer from visually separating from the divider. Resizing changes layout state only and never refreshes repository data.

Ordinary text editing uses one compact, horizontally scrollable tab row without a duplicate path/title/save header. A fixed trailing menu lists every bounded open text tab plus the replaceable Diff preview and selecting an item reveals its tab in the strip. File-tab label colors project the same Git status tokens as the Files tree, while selection and dirty markers remain independent state. The active loaded text tab publishes its encoding to the bottom status bar. Diff documents retain their contextual presentation toolbar because unified/split and whitespace controls belong to the Diff projection.

Each of the at most 20 open text tabs retains one CodeMirror `EditorState`, including its document tree, selection, history, language compartment, and last scroll offsets. Only the active tab owns an `EditorView` and mounted editor DOM; switching tabs destroys that view and immediately reconstructs it from the retained state instead of rebuilding language support or reparsing from plain text. Closing a tab, replacing its load epoch, or leaving the repository releases its retained state. A tab activation updates the editor and tab strip without rebuilding the project-tree DOM. Exact-line-ending edits update the affected normalized text and separator slice directly, while application-state notification is coalesced to one animation frame and flushed synchronously before save, close, or activation.

File-type icons are deterministic presentation metadata derived only from a bounded filename and extension table. One original 16-pixel SVG document silhouette, restrained palette, and compact static mark cover common source, build, configuration, markup, data, image, archive, and text files. Unknown files receive the neutral document icon. The icon layer performs no content sniffing, filesystem access, package loading, or file-type authorization and remains decorative beside the authoritative accessible filename.

Code folding belongs inside the CodeMirror adapter and consumes the syntax support already loaded for highlighting. Lezer languages use their parser ranges. The catalog's legacy Kotlin and Groovy stream modes add a bounded token-aware brace service, while XML replaces its end-of-opening-tag anchor with the element's first line. The gutter and standard fold/unfold keymap remain unavailable where no adapter can identify a structural range; no parallel outline, completion model, diagnostic service, or index is introduced. Longer-term parser evolution follows [`ADR-0006`](0006-language-adapter-evolution.md).

Markdown files may choose Source, Split, or Preview from a compact control in the existing tab row. The choice is transient per text tab and does not create another document owner. Split mode mounts the same CodeMirror buffer beside a `markdown-it` projection and adds one independently resizable divider; Preview mode unmounts CodeMirror but keeps the exact in-memory buffer, dirty baseline, save contract, and tab identity. Split scroll synchronization is bidirectional and proportional because rendered block geometry cannot provide an exact source-line mapping; each surface keeps its horizontal position independent. The renderer is lazy, generation-guarded, and limited to 512 KiB. Raw HTML is escaped, image fetches are replaced by placeholders, and links do not navigate from the preview. Supporting trusted HTML, workspace-relative media, link routing, exact source-to-rendered anchors, and persisted presentation state requires a later explicit trust and lifecycle decision.

Repository-independent editor typography persists only bounded presentation and input values. Font size, line-height factor, letter spacing, visual tab width, and inserted-space indentation apply immediately without rewriting the current document. Asterlyn ships one application-owned, OFL-licensed Source Code Pro variable font for Latin code glyphs instead of naming a font that may silently fall back differently on each operating system. The cross-platform baseline is 14 pixels, 1.35 line height, normal zero letter spacing, 400 weight with discretionary/code ligatures disabled, four-space indentation, and four-column tabs. These numeric values are visually calibrated for the CodeMirror/WebView renderer rather than claimed to be numerically identical to Android Studio's JBR font metrics. CJK and other uncovered glyphs retain an explicit system-monospace fallback. Letter spacing is an Asterlyn extension because the JetBrains editor exposes line height but not editor character spacing. Language- and `.editorconfig`-specific policy remains an E3.3 adapter concern.

The initial Files tree is a read-only list of tracked and non-ignored untracked repository paths. Navigation and exact file authorization accept up to 100,000 files; workspace search and replacement retain a separate 5,000-candidate scan budget. The complete in-memory hierarchy is projected lazily so a closed directory does not mount its descendants. A same-root refresh keeps the prior tree visible, merges the next catalog by stable path identity, retains valid disclosure, selection, and scroll state, and removes state for paths that no longer exist. A repository switch still resets this repository-owned presentation state. The tree does not introduce file mutation, watching, save, encoding, or recovery semantics before Stage 3. The initial side-by-side Diff remains a projection of Asterlyn's bounded canonical patch. It shows hunk-derived source line numbers, aligned spacer rows, explicit omitted ranges, and conservative intraline highlights, but never claims to contain the complete source file.

## State and ownership invariants

1. DOM and CodeMirror objects never enter serializable state.
2. Opening, closing, or resizing a tool never changes the active editor document.
3. An editor widget has one lifecycle owner and is not recreated by unrelated tool rendering or splitter movement.
4. Async results are accepted only when repository identity, repository generation, request generation, and selection identity still match.
5. A branch-to-commit-to-file selection change clears invalid descendants atomically.
6. Git mutations continue to refresh canonical repository state before selections are reconciled.
7. Views communicate through typed actions and current state, not direct cross-zone DOM calls or callbacks that capture stale selections.
8. Each mounted view owns disposal of its listeners, observers, subscriptions, and cancellation handles.
9. A same-root refresh reconciles project-tree presentation by exact path and kind; it never interprets row position as identity.
10. A text tab is dirty exactly when current exact content differs from its last successful load/save baseline; edit count alone cannot keep an undone buffer dirty.
11. Selecting from the open-document menu changes only active editor identity and tab-strip presentation; it never reloads or duplicates the document.
12. Markdown mode switching never copies, normalizes, saves, or discards buffer content; source and rendered views project one text-tab state.
13. A late Markdown render cannot update another tab or a newer presentation mode, and rendered content cannot initiate HTML execution, image loading, or navigation.
14. Linked Markdown scrolling changes viewport state only; it cannot move a cursor, edit content, save a file, or alter the per-tab Markdown mode.
15. A hideable tool window always exposes a visible, keyboard-operable Hide action in its own top-right header; activity-rail toggles are not its only close path.

## Migration sequence

1. Introduce tested workbench layout state and a reusable splitter controller while the old view still renders.
2. Install the persistent shell and editor host.
3. Move Files and Changes into the left tool host.
4. Combine branches, history, and details in the bottom three-column tool.
5. Route working-tree and commit-file selections into editor documents.
6. Replace patch-shaped split rendering with the source-like bounded-patch projection.
7. Remove the old page mode and permanent inspector after behavioral parity checks.

Each sequence point is a local rollback boundary. Remote publication and packaging occur only after the complete U6 phase is accepted.

## Consequences

- The shell can host later tools without turning them into new application pages.
- Git feature state can migrate incrementally; the proven Rust mutation and remote contracts remain unchanged.
- Layout persistence gains a schema and migration responsibility.
- A complete project tree and complete-file Diff remain future workspace/editor capabilities. U6 must label patch omissions honestly.
- Narrow windows require documented minimum dimensions and deterministic clamping rather than allowing hidden or overlapping panes.

## Revisit triggers

- Stage 3 multi-editor splits need more than one document group.
- Tool-window relocation, floating windows, or multiple application windows become planned work.
- Patch-derived Diff cannot satisfy measured review workflows and full-file content reads are introduced.
- Pointer or keyboard resizing cannot meet accessibility requirements on a supported webview.
