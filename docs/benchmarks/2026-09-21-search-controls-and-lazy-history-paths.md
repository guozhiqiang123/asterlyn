# Search controls and lazy History paths — 2026-09-21

## Scope

This acceptance slice closes five interaction gaps without introducing a second repository index:

- Branch filtering keeps one focus ring instead of drawing a second border around the native input.
- Branch, author, date, and path History filters expose an adjacent clear action only while active.
- `Paths → Select in Tree` projects and mounts one collapsed directory level at a time from the existing bounded project catalog.
- Quick Open owns one `Filter Git-ignored files` checkbox, visible in Files, Recent, Text, and Commands and enabled by default.
- Workspace Text and every CodeMirror editor surface share `New line`, `Match case`, `Whole words`, and `Regex` controls. Editable buffers retain replace actions; historical Diff panes do not.

Ignored files can be revealed for navigation and search, but are read-only. The native replacement boundary rejects ignored-file and multiline replacement independently of the presentation state.

## Functional and interaction evidence

Browser acceptance used the deterministic local demo at `127.0.0.1:1420`:

- Focusing Branch search produced no input border, outline, or shadow; the owning `.branch-filter` retained the single themed focus border.
- Selecting `main` added an accessible `Clear: refs/heads/main` action and clearing it restored `All refs`.
- Opening `Select in Tree` took 303 ms including dialog presentation, mounted eight root rows for the demo catalog, and expanded none of them.
- Quick Open showed the checked ignored-file filter in Files and retained it after switching to Text.
- Text mode rendered the four embedded search buttons in the requested order. The ordinary editor's `Ctrl+F` panel rendered the same four controls, and each moved independently from `aria-pressed=false` to `true`.
- The browser console contained no warnings or errors after the interaction sequence.

Contract tests also require the shared search extension in the ordinary editor, editable working Diff, read-only historical Diff, and three-pane conflict editor.

## Performance and memory evidence

A local Node process projected a synthetic 100,000-file catalog with 1,000 immediate children under `src` over ten iterations:

| Projection | Mounted/result rows | Median | Maximum |
| --- | ---: | ---: | ---: |
| Repository roots | 1 | 33.96 ms | 53.32 ms |
| Expanded `src` directory | 1,000 | 71.37 ms | 81.81 ms |

The expanded-level result retained an additional 106,528 bytes after garbage collection relative to the retained root result. The root heap delta was inside garbage-collection noise and is intentionally not reported as a positive saving. The important bound is architectural: dialog open performs one catalog pass, retains only immediate-child candidates, and mounts no descendant DOM until the user expands a directory. No watcher, background scan, or persistent file index was added.

These figures are single-process local evidence, not cross-machine latency guarantees.

## Validation

- `npm run check` — passed.
- `npm run test:scripts` — 561 passed, 0 failed.
- `npm run build` — passed; main application chunk 334.42 kB (71.75 kB gzip), editor-theme chunk 34.37 kB (10.18 kB gzip).
- `cargo test --workspace` — passed: application 56 passed/2 OS-watcher tests ignored, desktop main 1, desktop library 3, Git 105, terminal 4, workspace 53, and all doctests.
- `cargo fmt --all -- --check` and `git diff --check` — passed before the feature commit.

## Accessibility

- Search options are real buttons with localized accessible names and `aria-pressed` state.
- The ignored-file checkbox has a persistent label and remains reachable in all navigation modes.
- Active History filters expose separate named clear buttons rather than relying on an unlabeled glyph.
- Enter, Shift+Enter, and Escape retain their search navigation behavior; read-only editors omit replacement controls.

## Known limitations

- Ignored-file results are deliberately read-only and cannot enter workspace replacement.
- New-line queries are search-only; cross-line replacement remains unsupported.
- Path expansion still scans the bounded catalog for the requested level. A persistent index remains deferred until measurements justify its lifecycle and invalidation cost.
- This slice received browser interaction acceptance on Linux. It did not add a new installed-package pass for macOS or Windows.
