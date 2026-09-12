# ADR-0004: Authorized and conflict-safe text editing

- **Status:** Accepted for the first Stage 3 slice; review after crash recovery
- **Date:** 2026-09-09

## Context

The workbench already routes project-tree, working Diff, and commit Diff selections into one editor region, but a project file still opens a placeholder. Adding writes directly to the Tauri command module would make the transport adapter responsible for path security, encoding, concurrency, and durability. Keeping one active document without independent buffer lifetime would also let Diff navigation, refresh, repository switching, or window close silently remove edits.

The first editing slice must establish a safe boundary before search, language intelligence, file watching, autosave, or recovery depend on it. It must remain useful on ordinary source files while failing closed for unsupported data.

## Decision

Create a pure `asterlyn-workspace` crate. It owns bounded text reads, secure path traversal, exact-byte revisions, optimistic conflict checks, same-directory temporary writes, atomic replacement, and the supported durability result. It imports neither Git nor Tauri.

The desktop boundary receives a main repository root plus a root-qualified project-file identity.
Project discovery installs a bounded identity catalog in the invoking window's active workspace
session. A read, image preview, or save must first match that exact window, canonical root,
repository identity, and catalogued path. Git-backed files then receive a targeted current
authorization check for their exact nested repository, tracked state, and ignore policy; ordinary
workspace files continue through the workspace layer's component-by-component existence, file-kind,
and non-link traversal. Only the revalidated workspace-relative path reaches
`asterlyn-workspace`. A stale or fabricated client root or path cannot create authority, while one
file activation no longer regenerates the complete project catalog.

Reads use a fixed two-mebibyte backend limit. Every path component must remain inside the canonical workspace and must not be a symbolic link or platform reparse point; the target must be a regular single-link file. NUL data, invalid UTF-8, and oversized files fail closed. A UTF-8 BOM is separated from editable text and reported explicitly. LF, CRLF, mixed line endings, bare CR, and final-newline state are preserved as exact content rather than normalized silently.

The returned opaque revision covers the exact bytes and replacement-relevant supported metadata. Saving requires that revision, the complete text, the original BOM policy, and a unique request ID. The backend serializes in-process saves per file identity, reauthorizes the identity, rejects unsupported output, writes an exclusively created temporary file in the same directory, preserves ordinary mode/read-only metadata, flushes it, rechecks the target revision immediately before replacement, atomically replaces the target, and syncs the parent directory where supported. A revision mismatch leaves the target untouched. If the target already contains the requested exact bytes, retrying a lost successful response returns idempotent success.

Portable compare-then-replace cannot be linearizable against a non-cooperating writer in the final instant before rename. This slice accepts that narrow race and records it rather than claiming a filesystem transaction. It also does not promise preservation of ownership, ACLs, extended attributes, security labels, or hard-link relationships; multiple-link targets are rejected.

The frontend owns a pure editor-session model with persistent text tabs and one replaceable read-only Diff preview. A text tab records exact file identity, load epoch, content, BOM state, base revision, edit version, persisted version, one optional save request, and conflict/error state. Dirty state is derived from edit and persisted versions. A successful save advances the base revision but marks only the captured edit version persisted, so typing during a save remains dirty. Stale load or save responses cannot mutate a newer tab.

A successful write also schedules one debounced repository-status refresh. The desktop boundary revalidates the invoking window's active root and asks Git only for tracked/index changes; it does not reload commit history, refs, remotes, the project catalog, or editor buffers. Presentation merges that result into the current matching-generation snapshot, redraws Changes, Files, tabs, and Diff selection from that single source, and silently refreshes untracked rows afterward. A stale root or generation is discarded, while several saves in one burst converge on another final refresh.

CodeMirror remains behind a text-editor adapter. The adapter edits LF-normalized text while a tested line-ending map preserves untouched LF/CRLF separators and uses the document's dominant separator for inserted lines. CodeMirror classes never enter application/session models.

## Interaction policy

- Reopening the same root-qualified file focuses its existing tab.
- Project refresh preserves every text tab and dirty buffer.
- Opening a Diff replaces only the Diff preview and never closes a text tab.
- `Ctrl/Cmd+S` saves only the active editable tab; concurrent saves of that tab are disabled.
- A successful save refreshes shared Git-status presentation without resetting tree disclosure, history filters, or open tabs.
- Closing a dirty tab, switching repository, or closing the window offers Save or Cancel. There is no Discard or force-save path before recoverable drafts exist.
- Conflicts retain the complete local buffer and provide no overwrite action in this slice.

## Consequences and rollback

The editor gains an independently testable content boundary and durable buffer ownership without
coupling Git to editor internals. The cost is a new crate, a bounded window-session catalog plus a
targeted current authorization check for each read/write, bounded file support, and explicit
unsupported states. Undo history may be lost when a tab is unmounted, but exact text remains in the
session.

The UI can roll back by routing project files to the existing placeholder while leaving the unused workspace crate and commands inert. No Git/Diff state or user file is migrated.

## Deferred work

Crash recovery, autosave, force-save, discard with recovery, file creation/deletion/rename, filesystem watching, external-change merge, large-file streaming, non-UTF-8 encodings, ACL/xattr preservation, multiple editor groups, and cross-window sessions remain later Stage 3 slices. Basic parser-backed syntax highlighting is an E2.2 presentation concern: the CodeMirror adapter selects by exact filename, loads parser chunks on demand, rejects stale asynchronous loads, and falls back to plain text. LSP services, semantic tokens, project models, completion, diagnostics, and other language intelligence remain Stage 4 work.
