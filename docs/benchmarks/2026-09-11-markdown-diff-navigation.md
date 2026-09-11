# Markdown and Diff navigation evidence — 2026-09-11

## Scope and comparison

This focused E3.1 correction compares the previously accepted local build with the implementation in this change. It addresses three manually observed gaps: laggy proportional scrolling in Markdown Split, plain fenced code in Markdown preview, and missing review navigation in text Diff. It does not advance the Stage 3 sequence or claim installed Windows/macOS acceptance.

## Functional evidence

- A deterministic linked-scroll fixture submits a burst of source events without flushing the scheduler. The peer remains unchanged until the single queued frame runs, then receives only the latest proportional position in one write. Existing two-way, unequal-height, feedback-suppression, horizontal-independence, and disposal cases remain covered.
- Markdown preview renders a TypeScript fence with parser-produced semantic token spans. An unknown fence containing markup remains escaped and cannot create an executable element. Preview still rejects input above 512 KiB.
- Pure Diff-navigation fixtures group adjacent unified and split change rows into one change point and stop previous/next file navigation at list boundaries.
- The Git fixture changes the middle of a 30-line file. Default local and commit patches omit a distant unchanged first line; explicitly expanded local and commit patches include it. A second fixture produces more than four MiB of local and commit Diff output; the pipe reader retains only the bounded prefix, signals the host to terminate that exact Git read, drains both closing pipes, and returns truncation with the visible marker. Existing exact-status, object, path, and first-parent checks remain in force.

## Browser interaction

A local production-like browser journey opened a long in-memory Markdown document with approximately 180 sections and a TypeScript fence. Split mode reported a 17,579-pixel preview scroll height inside a 386-pixel viewport, retained proportional synchronization metadata, and rendered a CodeMirror-derived keyword token.

The same journey opened a commit Diff and verified all six review actions in the toolbar. Next change centered a changed source line; Next file replaced the active Diff with the adjacent commit file; Expand changed its accessible action to Collapse; and Open file switched to the editable source, activated Files, selected `src/diff-editor.ts`, expanded its ancestors, and revealed the row. Previous file was disabled at the first file boundary. Buttons expose names, disabled state, and the unchanged-context toggle exposes pressed state.

The browser automation bridge cannot subscribe directly to native DOM scroll events, so frame-count evidence comes from the deterministic scheduler fixture rather than synthetic wheel timing. Installed macOS trackpad confirmation remains manual acceptance.

## Performance and resource interpretation

- The scroll hot path changes from synchronous layout reads and peer writes on every event to one latest source/target mapping per animation frame. The burst fixture reduces many source events to one peer write. This is **improved** for work scheduling; it is not a device-level frame-time benchmark.
- Markdown highlighting adds no parser family or package. It reuses the existing lazy language modules, limits one render to eight unique languages and 256 Ki UTF-16 code units, and keeps at most 24 language-support promises in its bounded session cache. The cache never evicts pending work: if all 24 entries are still loading, another language falls back to plain code without starting a 25th loader. A delayed-promise fixture verifies that global bound. Unsupported and excess fences render as plain escaped code.
- Expanded unchanged context is user-triggered and per active Diff document. Crossing the retained-output cap terminates the exact child read, so memory and post-cap I/O do not scale with the undisplayed remainder. It creates no watcher, index, recurring query, or persistent repository state. Composite document keys isolate worktree/index sides and commit repository/object/path identities.
- No matched native process-tree resource series was run for this interaction correction, so memory impact is **inconclusive**.

## Validation

The final validation run passed all 167 script tests, 41 `asterlyn-git` tests, 25
`asterlyn-workspace` tests, 17 Tauri library tests, and the Tauri binary smoke test.
TypeScript checking, Rust formatting, strict Clippy, and whitespace checks also passed.

The production frontend emits 91.66 kB of CSS (21.57 kB gzip), a 686.95 kB main
JavaScript chunk (197.01 kB gzip), and a separately loaded 97.28 kB Markdown-it
chunk (40.86 kB gzip). Vite retains its existing warning that the main chunk is
larger than 500 kB; this change does not claim to close that separate optimization.

The final Linux binary is 19,331,136 bytes and the Debian package is 6,747,442
bytes. Compared with the immediately preceding accepted local build, these are
increases of 81,728 bytes (0.4246%) and 27,420 bytes (0.4080%) respectively. Both
are **no material change** under the project's one-percent artifact-size threshold.
The packaged native process remained alive through the six-second smoke window.
The acceptance package SHA-256 is
`7bd2b0e7214961bcaca66c4a5a7becd4c1916f9fc65484c667ca86394b5c9838`.

## Limitations and next action

Scroll synchronization maps normalized progress rather than headings or exact source lines. Markdown highlighting is static preview output and cannot provide selection, editing, diagnostics, or semantic services. A language outside the existing catalog, a failed parser, the per-render language limit, or the code-unit budget falls back to escaped plain code. Diff navigation does not wrap. Deleted or catalog-absent files cannot open as current editable sources. Image Diff supports changed-file and source navigation only. Expanded context can still end with the visible four-MiB truncation marker for very large files.

The next action is installed Linux manual acceptance of Markdown trackpad/wheel feel and the six Diff controls. Installed macOS confirmation remains open because WebKit compositor behavior is the original high-risk environment.
