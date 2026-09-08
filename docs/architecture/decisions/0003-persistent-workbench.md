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

Persist only a versioned layout preference document containing dock visibility and validated dimensions. Repository identity, selections, pending operations, async generations, and editor widgets are transient session state. Unknown or malformed persisted versions reset to safe defaults, and all dimensions are clamped against both component minima and the current viewport.

U6 keeps the activity rail fixed-width. Every content boundary is resizable by pointer and keyboard: left dock/editor, editor/bottom dock, the two internal Branches dividers, and the side-by-side Diff divider. Resizing changes layout state only and schedules editor measurement; it never refreshes repository data.

The initial Files tree is a read-only list of tracked and non-ignored untracked repository paths. It does not introduce editing, file mutation, watching, save, encoding, or recovery semantics before Stage 3. The initial side-by-side Diff remains a projection of Asterlyn's bounded canonical patch. It shows hunk-derived source line numbers, aligned spacer rows, explicit omitted ranges, and conservative intraline highlights, but never claims to contain the complete source file.

## State and ownership invariants

1. DOM and CodeMirror objects never enter serializable state.
2. Opening, closing, or resizing a tool never changes the active editor document.
3. An editor widget has one lifecycle owner and is not recreated by unrelated tool rendering or splitter movement.
4. Async results are accepted only when repository identity, repository generation, request generation, and selection identity still match.
5. A branch-to-commit-to-file selection change clears invalid descendants atomically.
6. Git mutations continue to refresh canonical repository state before selections are reconciled.
7. Views communicate through typed actions and current state, not direct cross-zone DOM calls or callbacks that capture stale selections.
8. Each mounted view owns disposal of its listeners, observers, subscriptions, and cancellation handles.

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
