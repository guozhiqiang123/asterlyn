# R2g lazy editor runtime evidence — 2026-09-12

## Scope

This independently revertible R2 slice removes CodeMirror text editing, Diff rendering, Markdown
code highlighting, and Markdown parsing from the startup module graph. Small lazy facades preserve
the synchronous application-facing lifecycle while loading each implementation at first use.

## Runtime ownership and safety

`LazyTextEditor` and `LazyDiffEditor` retain the latest mount identity while a chunk is loading and
discard superseded mounts by generation. Once loaded, normal tab and Diff switches call the real
runtime synchronously. Preferences, read-only state, selection requests, linked scrolling,
detachment, retained-tab cleanup, and window disposal remain available through the same boundary.

Markdown path recognition and its byte limit now live in a lightweight static module. The parser,
language catalog, and fenced-code highlighter load only when preview rendering is requested. Source
tests prevent accidental static editor/Diff/Markdown-preview imports from returning to the startup
graph.

## Validation and interpretation

All 220 frontend script tests and TypeScript checking pass. The production build passes and emits
separate `text-editor`, `diff-editor`, `editor-theme`, `editor-language`, and `markdown-it` chunks.

The main JavaScript chunk falls from 768.53 kB raw and 215.92 kB gzip in R2f to **410.51 kB raw and
99.72 kB gzip**. That is a 358.02 kB raw reduction (46.59%) and 116.20 kB gzip reduction (53.82%),
a material **improvement**. The R2 startup-chunk gate is now below 500 kB with 89.49 kB of raw
headroom.

Installed-app first-editor latency remains to be measured in closing acceptance. No native or
package claim is made by this interim slice.

## Next action

Move capability styles out of the global stylesheet, continue removing feature presentation from
`AsterlynApp`, and then run R2 source, DOM, bundle, accessibility, native, and installed-package
acceptance once at the phase boundary.

## 2026-09-21 Follow-up: idle warm-up after a workspace opens

The interim slice recorded that installed-app first-editor latency remained unmeasured; an installed
package report then showed the symptom the lazy boundary introduces: on the first project and the
first switch to a working Diff, the merge gutter and its revert control appeared only after the lazily
imported editor modules had been fetched and parsed, so the center bar arrived noticeably later than
the click.

`EditorSurface.scheduleRuntimePreload()` now warms the text editor, read-only Diff, and editable Diff
modules once per window. It runs from `renderWorkspace()` only after a workspace root exists, and the
scheduler in `src/features/files-editor/editor-runtime-preload.ts` defers the work to
`requestIdleCallback` with a three-second timeout and a 250-millisecond `setTimeout` fallback. Window
disposal cancels a preload that has not started. This loads application code only: the scheduler
imports nothing, reads no repository data, and holds no live timer.

Measured on the production bundle in a fresh browser profile before the change: clicking the first
changed file requested `diff-editor`, `linked-scroll`, `editable-diff-editor`, and
`editor-change-indicators` **after** the click, starting 94 ms in, with the Diff surface appearing at
122 ms. After the change the same probe reports every one of those modules already fetched before the
click and **zero** runtime module requests after it. The revert control is created by CodeMirror's
first measure one frame after the mount, so with the modules warm the gutter (`mount` ≈ 48 ms for a
420-line file) and its control are the only remaining cost. `npm run check` and the complete script
suite passed (588 tests, including three new preload tests).
