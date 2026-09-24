# ADR-0005: Bounded navigation and workspace search

- **Status:** Accepted through E2.3; revised search controls accepted 2026-09-21; ignored-file mutability superseded by ADR-0017 on 2026-09-23
- **Date:** 2026-09-09

## Context

E1 established authorized text reads, conflict-safe saves, and editor-owned buffers. E2 must make those files fast to reach without turning startup into an indexing job, letting stale asynchronous results navigate the wrong repository, or introducing a bulk-write path before recovery exists.

The project catalog is the bounded source for tracked, untracked, and ignored identities. At the time
of this decision, mutation authorization used a narrower tracked/non-ignored boundary; ADR-0017 later
made catalogued ignored identities editable while retaining the separate bulk-replacement boundary.
CodeMirror provides reversible find and replace inside the active buffer. What is missing is one
coherent keyboard-first command surface, repository-scoped recent files, and bounded text search
across the current catalog.

## Decision

E2.1 adds one transient navigation surface with four modes: files, recent files, workspace text, and commands. `Ctrl/Cmd+P` opens files, `Ctrl/Cmd+E` opens recents, `Ctrl/Cmd+Shift+F` opens workspace text search, and `Ctrl/Cmd+Shift+P` opens commands. Arrow keys move one selection model, Enter activates it, and Escape closes the surface without changing the active editor. `Ctrl/Cmd+F` remains the active-buffer find and replace path. The ordinary editor, editable working Diff, read-only historical Diff, and three-pane conflict editor install the same CodeMirror search extension and use the same embedded `New line`, `Match case`, `Whole words`, and `Regex` controls; read-only panes omit replacement controls.

The navigation bar also owns one `Filter Git-ignored files` checkbox visible in all four modes and
enabled by default. Files and Recents rank only non-ignored catalog identities while it is enabled.
Commands have no file candidates. Workspace Text regenerates the corresponding bounded native
catalog. Disabling the filter can expose ignored files for navigation and search. ADR-0017 later made
those results editable and savable; they remain excluded from bulk replacement.

File and command ranking is a pure presentation operation over the already loaded bounded catalog and a fixed command registry. Recent files are repository-scoped presentation preferences, capped at 50 exact root-qualified identities, pruned against the current catalog, and updated only after a file opens successfully. They contain no file content or repository truth.

Quick Open retains one window-scoped search projection for the exact current catalog array. The
projection deduplicates exact repository/path identities and normalizes each workspace path once;
catalog replacement invalidates it by object identity, while Git-status-only updates do not. An
empty query emits recent files followed by the already sorted catalog and stops at 100 rows. A
non-empty query scans the projection once but retains only the best 100 candidates in a bounded
max-heap instead of allocating and sorting every match. The projection is in-memory presentation
state only: it has no file content, disk persistence, watcher, background task, or authority to
open a path.

Typing in Files, Recent Files, or Commands preserves the mounted input and dialog. Input events
update transient query state immediately, coalesce bursts to the latest animation frame, and
replace only the result-list children. IME composition updates the native input without ranking
intermediate composition states and submits the final query at composition end. Arrow movement
updates only the previous and next selected rows. A catalog identity change may rebuild the
complete surface; status-only reconciliation may not. Workspace text search retains its separately
cancellable request/render lifecycle because its loading controls and replacement state change
together.

Workspace text search is a lazy application service. The desktop boundary first resolves the active canonical workspace and regenerates the Git-authorized project catalog. It passes only those exact identities and workspace paths to `asterlyn-workspace`; the workspace crate never imports Git or Tauri and never enumerates arbitrary files.

The current default is case-insensitive literal text with New line, Whole words, and Regex disabled. Match case selects the case-sensitive literal fast path. Whole words uses Unicode letters and numbers plus underscore as word characters. New line decodes `\\n`, `\\r`, `\\t`, and `\\\\` in literal queries and searches the complete newline-normalized document; Regex plus New line enables dot-all expressions. With New line disabled, literal and regular-expression matching stays line-local. Regex matching is Unicode, leftmost-first, and non-overlapping; inline flags such as `(?i)` remain allowed. Zero-width results remain valid positions. Include/exclude path globs and zero to three preview-context lines remain independent options. E2.3 reuses line-local semantics for a separately reviewed replacement transaction; New line search is intentionally read-only.

Path globs match the complete case-sensitive `/`-separated workspace-relative path, including initialized-submodule prefixes. Includes are ORed and empty means all; excludes are ORed and take precedence. `*` does not cross a separator while `**` can. Invalid, absolute, backslash-containing, parent/current-component, brace-expanded, or excessive patterns fail closed. Filtering retains the original catalog index and reports both eligible and total catalog counts; intentional exclusion is not incomplete coverage, while catalog truncation remains incomplete.

A query is non-empty and at most 4,096 UTF-8 bytes. Literal escape sequences can represent line breaks only when New line is enabled; direct line breaks are rejected otherwise. Each candidate retains E1's two-mebibyte file limit; a search examines at most 5,000 candidates, reads at most 64 MiB including failed decoding attempts, and returns at most 500 matches. Each include or exclude list has at most 32 patterns of at most 256 bytes. Regex compiled-program and DFA limits are two MiB each. Reaching any scan bound returns the matches already found with explicit partial coverage. Unsupported binary, encoding, link, type, changed, missing, unreadable, and oversized candidates are reported as bounded typed skips rather than converting the whole result into success-looking completeness. Invalid requests, active-root denial, and catalog failure remain fatal. Cancellation returns no consumable partial result.

Search tasks have a request ID and cancellation token. Opening a newer workspace search, changing any search option, or changing repository cancels the previous task. The frontend additionally accepts a response only when request ID, repository generation, canonical root, query, mode, New line, Match case, Whole words, ignored-file filter, ordered include/exclude arrays, and context count still match. No background index, watcher, cache, or startup scan is introduced.

**Amendment, 2026-09-21.** The in-field `New line` control is an editing action, not a mode toggle: it inserts one line break into the query at the caret, and the query field is a textarea that grows with its own text. Multi-line search is therefore derived from the query — a workspace text request carries `new_line` exactly when the query contains a real line break — so a request can never carry line breaks with the mode off, and the escape-sequence, dot-all, and read-only replacement rules above keep applying unchanged. The same four in-field controls are presented by every command-surface query tab. `Match case`, `Whole words`, and `Regex` additionally select the Files and Recent quick-open path matcher: case-sensitive matching uses the exact workspace path, whole words require Unicode word boundaries around a contiguous occurrence, and Regex matches the query as a Unicode expression against the workspace path (an invalid expression matches nothing). With all three off, quick open keeps its case-insensitive fuzzy ranking.

**Amendment, 2026-09-23.** Result rows in all four modes show the characters that matched the current query. Files and Recent highlight the same path occurrence or ordered fuzzy subsequence used by their quick-open matcher, split across the displayed directory and basename when needed. Commands highlight their label or detail; when a match depends on a hidden alias or command ID, that matching field is also shown in the row. Workspace Text keeps its exact preview-relative match range and zero-width marker. Ordinary matches emphasize the glyphs without a filled background; the zero-width marker remains a narrow colored caret. Highlighting is escaped presentation over existing results: it does not change ranking, search requests, selection, or navigation, and an empty query adds no marks.

The query row follows the textarea's measured height when New line is clicked or multiline text is entered or pasted. The bordered field grows with the text up to its 124px cap; longer queries scroll inside the field without covering the results.

The active editor's Find field follows the same visible interaction: its New line button inserts an actual line break at the caret, the textarea grows to the same 124px cap, and CodeMirror updates matches as the query or case, word, and regex options change. Both search surfaces use square segmented option buttons flush with the field's right inner edge. The editor's sticky search panel stays below application dialogs, so an open global search remains visually and interactively above it.

Workspace Text starts a bounded search after 250ms without further query or option changes. Typing, inserting a line break, toggling an in-field option or ignored-file filter, changing include/exclude globs, or choosing context lines resets that delay and cancels an obsolete request. Clearing the query cancels pending work and clears results; Enter can start a pending search immediately, while Enter on current results opens the selected match. The search icon and option strip align with the textarea's first line as the field grows, and the strip reaches the field's right inner edge.

Workspace Text result rows present the complete filename and one-based line as `filename:line`, with the full workspace path available on hover. The filename takes its needed width up to a bounded share of the row and wraps only when necessary; the adjacent match preview stays on one line and shows an ellipsis when clipped. The Context selector keeps its selected value and chevron visible at the configured UI scale. Opening a result selects its exact document range and reveals it after the editor's first layout; that explicit navigation supersedes any scroll restoration queued by mounting the tab.

Each match returns the exact catalog identity, read-only flag, workspace path, E1-compatible source revision, one-based logical line/column, zero-based half-open UTF-16 offsets in the newline-normalized editor document, and a preview capped at 320 UTF-16 units with preview-relative match offsets and clipping flags. The preview may include up to three requested lines on each side. It never splits a Unicode scalar; when a match itself exceeds the cap, the preview retains a bounded visible prefix while the exact document range remains unclipped. Logical lines recognize LF, CRLF, and bare CR, matching E1's CodeMirror normalization. Activating a result reopens the file through the read authorization boundary and applies the location only when the matching load epoch succeeds with the same revision. A dirty existing tab, different active root, or revision mismatch marks the result stale and never navigates by the disk-derived offsets.

E2.1 intentionally limits replacement to CodeMirror's active-buffer find/replace controls. This is honest search-and-replace capability: changes remain in one visible undoable buffer and reach disk only through E1 Save. Workspace-wide replacement is deferred until recoverable drafts or an equivalent preview-and-rollback design exists; it must not be simulated by sequential hidden saves.

E2.3 introduces replacement as a separate review-and-recovery transaction, not as a mutation attached to individual search-result buttons. Preparing a plan reruns the current bounded search against a fresh Git-authorized catalog, rereads every matching text file, and retains exact original and proposed bytes in a bounded in-memory plan. Catalog, candidate, byte, or match truncation blocks planning because unseen matches could change the meaning of `Replace`; unsupported files remain explicitly reported and outside the reviewed scope. The plan previews every changed file and permits file-level selection only. Literal replacement is exact; regular-expression replacement uses the same line-local expression and Rust capture expansion. Newlines entered in replacement text use each target's dominant separator while untouched separators and UTF-8 BOM policy remain exact.

Applying a reviewed selection first reauthorizes the active workspace, serializes workspace writes, and verifies every selected original revision before writing anything. It then durably records each exact original and proposed file in the application's local-data recovery area and publishes the manifest before the first workspace mutation. Every target continues through E1's same-directory atomic, optimistic save path. Cancellation or a partial failure triggers conservative automatic rollback: a file is restored only while it still contains the reviewed replacement. An independently changed file is never overwritten and leaves a visible `needs recovery` record.

A completely applied transaction remains recoverable across restart until the user explicitly keeps the changes or rolls them back. Keeping changes deletes recovery data only after every target still equals the reviewed replacement. Successful rollback deletes it only after every target equals the exact original. Corrupt recovery metadata fails visibly instead of being ignored. Recovery blobs can contain source text, live only under application-local data, are never repository truth, and are removed after verified keep or rollback. There is no force-apply, force-rollback, unattended replacement, ignored-file replacement, or cross-line replacement. The frontend disables replacement while ignored files are included or New line is active, and the workspace replacement boundary independently rejects both modes.

## Consequences and rollback

Quick navigation stays instant after the existing catalog load, while workspace search consumes resources only when requested and remains bounded. Search results can be incomplete, but the UI reports eligible/scanned/skipped counts and truncation explicitly. A repository with many unsupported or very large files remains usable. The E2.2b default-path median remains within 1.75% of the E2.1 fixture baseline, so an index remains unjustified.

The navigation surface can be removed without changing repository or file formats. The workspace search API remains read-only and can later be replaced by a measured index behind the same result contract. Replacement recovery has an explicitly versioned private manifest and exact byte blobs outside the repository; removing the E2.3 UI must first resolve or preserve any listed recovery rather than silently deleting it. On the accepted 169-candidate fixture, complete replacement planning had a 22.446-millisecond median for 35 files/91 matches and 12.416 milliseconds when filtered to five `src/**` files, so no index is justified by this slice.

## Deferred work

Persistent indexing, ignored-file replacement, cross-line replacement, multi-root result grouping controls, match-level replacement selection, symbol search, replacement editing after preview, and search-result persistence remain later slices.
