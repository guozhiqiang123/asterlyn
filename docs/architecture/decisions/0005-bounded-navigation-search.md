# ADR-0005: Bounded navigation and workspace search

- **Status:** Accepted through E2.2b; E2.3 recovery contract approved, interaction pending
- **Date:** 2026-09-09

## Context

E1 established authorized text reads, conflict-safe saves, and editor-owned buffers. E2 must make those files fast to reach without turning startup into an indexing job, letting stale asynchronous results navigate the wrong repository, or introducing a bulk-write path before recovery exists.

The existing project catalog is already the bounded Git-authorized source for tracked and non-ignored untracked files. CodeMirror already provides reversible find and replace inside the active buffer. What is missing is one coherent keyboard-first command surface, repository-scoped recent files, and bounded text search across the current catalog.

## Decision

E2.1 adds one transient navigation surface with four modes: files, recent files, workspace text, and commands. `Ctrl/Cmd+P` opens files, `Ctrl/Cmd+E` opens recents, `Ctrl/Cmd+Shift+F` opens workspace text search, and `Ctrl/Cmd+Shift+P` opens commands. Arrow keys move one selection model, Enter activates it, and Escape closes the surface without changing the active editor. `Ctrl/Cmd+F` remains CodeMirror's active-buffer find and replace path.

File and command ranking is a pure presentation operation over the already loaded bounded catalog and a fixed command registry. Recent files are repository-scoped presentation preferences, capped at 50 exact root-qualified identities, pruned against the current catalog, and updated only after a file opens successfully. They contain no file content or repository truth.

Workspace text search is a lazy application service. The desktop boundary first resolves the active canonical workspace and regenerates the Git-authorized project catalog. It passes only those exact identities and workspace paths to `asterlyn-workspace`; the workspace crate never imports Git or Tauri and never enumerates arbitrary files.

The E2.1 default search is case-sensitive literal text. E2.2b preserves that entry point and fast path while adding an explicit options contract for line-local Rust regular expressions, include/exclude path globs, and zero to three preview-context lines. Regex matching is Unicode, leftmost-first, and non-overlapping; inline flags such as `(?i)` are allowed, while matches never cross a normalized newline. Zero-width results remain valid positions.

Path globs match the complete case-sensitive `/`-separated workspace-relative path, including initialized-submodule prefixes. Includes are ORed and empty means all; excludes are ORed and take precedence. `*` does not cross a separator while `**` can. Invalid, absolute, backslash-containing, parent/current-component, brace-expanded, or excessive patterns fail closed. Filtering retains the original catalog index and reports both eligible and total catalog counts; intentional exclusion is not incomplete coverage, while catalog truncation remains incomplete.

A query is one non-empty line of at most 4,096 UTF-8 bytes. Each candidate retains E1's two-mebibyte file limit; a search examines at most 5,000 candidates, reads at most 64 MiB including failed decoding attempts, and returns at most 500 matches. Each include or exclude list has at most 32 patterns of at most 256 bytes. Regex compiled-program and DFA limits are two MiB each. Reaching any scan bound returns the matches already found with explicit partial coverage. Unsupported binary, encoding, link, type, changed, missing, unreadable, and oversized candidates are reported as bounded typed skips rather than converting the whole result into success-looking completeness. Invalid requests, active-root denial, and catalog failure remain fatal. Cancellation returns no consumable partial result.

Search tasks have a request ID and cancellation token. Opening a newer workspace search or changing repository cancels the previous task. The frontend additionally accepts a response only when request ID, repository generation, canonical root, query, mode, ordered include/exclude arrays, and context count still match. No background index, watcher, cache, or startup scan is introduced.

Each match returns the exact authorized candidate identity, workspace path, E1-compatible source revision, one-based logical line/column, zero-based half-open UTF-16 offsets in the newline-normalized editor document, and a preview capped at 320 UTF-16 units with preview-relative match offsets and clipping flags. The preview may include up to three requested lines on each side. It never splits a Unicode scalar; when a match itself exceeds the cap, the preview retains a bounded visible prefix while the exact document range remains unclipped. Logical lines recognize LF, CRLF, and bare CR, matching E1's CodeMirror normalization. Activating a result reopens the file through E1 authorization and applies the location only when the matching load epoch succeeds with the same revision. A dirty existing tab, different active root, or revision mismatch marks the result stale and never navigates by the disk-derived offsets.

E2.1 intentionally limits replacement to CodeMirror's active-buffer find/replace controls. This is honest search-and-replace capability: changes remain in one visible undoable buffer and reach disk only through E1 Save. Workspace-wide replacement is deferred until recoverable drafts or an equivalent preview-and-rollback design exists; it must not be simulated by sequential hidden saves.

E2.3 introduces replacement as a separate review-and-recovery transaction, not as a mutation attached to individual search-result buttons. Preparing a plan reruns the current bounded search against a fresh Git-authorized catalog, rereads every matching text file, and retains exact original and proposed bytes in a bounded in-memory plan. Catalog, candidate, byte, or match truncation blocks planning because unseen matches could change the meaning of `Replace`; unsupported files remain explicitly reported and outside the reviewed scope. The plan previews every changed file and permits file-level selection only. Literal replacement is exact; regular-expression replacement uses the same line-local expression and Rust capture expansion. Newlines entered in replacement text use each target's dominant separator while untouched separators and UTF-8 BOM policy remain exact.

Applying a reviewed selection first reauthorizes the active workspace, serializes workspace writes, and verifies every selected original revision before writing anything. It then durably records each exact original and proposed file in the application's local-data recovery area and publishes the manifest before the first workspace mutation. Every target continues through E1's same-directory atomic, optimistic save path. Cancellation or a partial failure triggers conservative automatic rollback: a file is restored only while it still contains the reviewed replacement. An independently changed file is never overwritten and leaves a visible `needs recovery` record.

A completely applied transaction remains recoverable across restart until the user explicitly keeps the changes or rolls them back. Keeping changes deletes recovery data only after every target still equals the reviewed replacement. Successful rollback deletes it only after every target equals the exact original. Corrupt recovery metadata fails visibly instead of being ignored. Recovery blobs can contain source text, live only under application-local data, are never repository truth, and are removed after verified keep or rollback. There is no force-apply, force-rollback, unattended replacement, ignored-file replacement, or cross-line expression in E2.3.

## Consequences and rollback

Quick navigation stays instant after the existing catalog load, while workspace search consumes resources only when requested and remains bounded. Search results can be incomplete, but the UI reports eligible/scanned/skipped counts and truncation explicitly. A repository with many unsupported or very large files remains usable. The E2.2b default-path median remains within 1.75% of the E2.1 fixture baseline, so an index remains unjustified.

The navigation surface can be removed without changing repository or file formats. The workspace search API remains read-only and can later be replaced by a measured index behind the same result contract. Replacement recovery has an explicitly versioned private manifest and exact byte blobs outside the repository; removing the E2.3 UI must first resolve or preserve any listed recovery rather than silently deleting it.

## Deferred work

Dedicated case-insensitive controls, cross-line regular expressions, ignored-file search and replacement, persistent indexing, multi-root result grouping controls, match-level replacement selection, symbol search, replacement editing after preview, and search-result persistence remain later slices.
