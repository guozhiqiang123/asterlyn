# Localization and color-theme implementation evidence

Date: 2026-09-13

Status: feature implementation complete; browser and frontend gates pass; current-revision native
package acceptance awaits the repository CI matrix.

## Delivered behavior

- Preferences schema v6 owns `System`, English, and Simplified Chinese language choices plus
  `System`, Dark, and Light appearance choices. Existing v1-v5 profiles retain their English/Dark
  behavior during migration.
- `PresentationEnvironment` resolves system choices, updates document language, color scheme, and
  theme color, synchronizes preferences across windows without echo, and forwards the requested
  theme to Tauri.
- Dark and Light share one semantic color registry. TextEditor and DiffEditor update theme and
  CodeMirror phrases through compartments, preserving their editor state.
- Typed English and Chinese catalogs cover shell, Settings, navigation/search/replacement, Files,
  Editor/Markdown/Diff, Changes/Commit, branches/history/details, Remote/Push, Git operations,
  conflicts, recovery, watcher status, and expected error summaries.
- Controller boundaries receive replaceable copy contracts. Unknown Git, network, repository, and
  system diagnostics remain escaped technical detail below a localized primary error message.
- `scripts/localization-coverage.test.mjs` audits direct HTML text, accessibility labels,
  placeholders, titles, and direct status/confirmation assignments. Its reviewed allowlist contains
  only keyboard notation, Git/HEAD terminology, glob examples, and example paths.
- Forced-colors rules preserve native controls, visible focus, selected rows, status markers, and
  primary actions.

## Automated checks

The complete script suite passed: 293 tests, zero failures. This includes catalog-shape parity,
preference migration, cross-window no-echo behavior, system-versus-explicit theme resolution,
CodeMirror syntax contrast in both palettes, semantic token completeness, raw component-color
rejection, forced-colors coverage, visible-copy coverage, controller stale-result safety, editor
buffer preservation, and watcher reconciliation stability.

Frontend checks also passed:

```text
tsc --noEmit
vite build
309 modules transformed
```

The Rust checks and current native bundle could not run on this host because neither `cargo` nor
`rustc` is installed. `tauri build --bundles app` stopped before compilation with `cargo metadata:
No such file or directory`. The pinned `package-preview.yml` matrix remains the required gate for
Linux x86_64, Windows x86_64, macOS Apple Silicon, and macOS Intel packages and native smoke tests.
No older local bundle is counted as evidence for this revision.

## Browser interaction and layout

Chrome 152 on macOS 14.1.2 was exercised against the Vite development build. Saved Chinese/Light
preferences were applied before the application module loaded; the first rendered shell reported
`lang=zh-CN`, `data-theme=light`, Chinese Search text, and a Chinese Settings accessible label.
English and Chinese workbench screenshots were inspected in both palettes. Repository paths,
branch names, commit messages, author names, hashes, and file contents remained unchanged.

Language changes retained focus on the language control and updated `document.lang` and the
Settings heading in place. Theme changes used the compartment/token path without rebuilding the
shell. The Chinese Settings page at the maximum 14 px application font and 2× device scale had no
document-level horizontal overflow and no clipped visible primary action at either tested viewport:

| CSS viewport | Horizontal overflow | Clipped primary actions |
| --- | ---: | ---: |
| 920 × 640 | 0 | 0 |
| 1,280 × 720 | 0 | 0 |

## Switch timing and idle stability

`scripts/measure-presentation.mjs` ran 30 warmed alternating changes for each explicit choice.
Theme timing ends when the document theme changes; locale timing includes two animation frames
after the lazy catalog and feature reconciliation complete.

| Operation | Median | p95 | Maximum | Gate |
| --- | ---: | ---: | ---: | ---: |
| Dark/Light | 0.6 ms | 0.9 ms | 0.9 ms | 16 ms |
| English/Chinese | 33.4 ms | 34.8 ms | 34.8 ms | 100 ms |

A separate 60-second System-theme idle observation watched the complete document subtree after
returning to the workbench. It recorded zero DOM mutation batches. This is consistent with the
implementation, which uses media-query and language-change listeners and creates no polling timer.

## Production size

The final production build keeps locale catalogs in separate lazy chunks and the main JavaScript
below the 500 kB uncompressed architecture gate.

| Asset | Raw | Gzip | Change from `e6ba1ee` |
| --- | ---: | ---: | ---: |
| Main JavaScript | 457.88 kB | 106.04 kB | +2.01 / +0.41 kB |
| Main CSS | 114.56 kB | 25.29 kB | +0.72 / +0.15 kB |
| Git-operation CSS | 2.91 kB | 0.90 kB | +0.13 / +0.04 kB |
| English catalog | 43.19 kB | 14.10 kB | +1.41 / +0.38 kB |
| Chinese catalog | 43.01 kB | 15.59 kB | +2.21 / +0.70 kB |

The comparison used a detached temporary worktree at `e6ba1ee` with the same dependency tree; it
was removed after measurement.

## Commit sequence

The implementation is reviewable and revertible by boundary:

1. `e888ba1` preference and presentation environment choices.
2. `dd2cdc3`, `c7b8ea1` semantic colors and System/Dark/Light behavior.
3. `f7dd9f0`, `c3a5d25`, `de3d4e1`, `3baec16`, `e6ba1ee` localization from shell through feature workflows.
4. `0f83872` localized operational errors and technical-detail boundaries.
5. `7e17035` visible-copy, forced-colors, presentation-state, and measurement gates.
