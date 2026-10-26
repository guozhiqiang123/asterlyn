# Language definition navigation plan — 2026-10-26

Status: planned; this document is recorded before implementation.

The user requests progress toward usable Ctrl + primary mouse button definition navigation, with a
written plan before implementation. Baseline `4a24095` has an operational TS/JS provider and F12,
but no modifier-click entry, no multiple-result chooser, and incomplete navigation identity checks.
This iteration closes a real local-source navigation workflow; subsequent capabilities are listed
separately and are not advertised as implemented.

## User-visible contract

1. In an eligible TS/JS-family ordinary source editor, hold Ctrl and point at a symbol: underline
   the candidate and show a link cursor. Ctrl + left mouse button queries the symbol under the
   pointer, even when the caret is elsewhere. macOS also accepts Command + left mouse button.
   Normal clicks, selections, dragging, right-click menus, gutters and scrollbars keep their behavior.
2. macOS Control-click can produce a context-menu event without a normal click. Handle the primary
   mouse gesture directly and suppress only the corresponding navigation context-menu event.
3. F12 uses the same definition resolver and freshness checks. One target opens directly; multiple
   distinct targets show a bounded, keyboard-operable host menu instead of silently choosing the
   first. Escape dismisses it and focus returns to the source editor.
4. Open the destination tab, select the definition's symbol range, center it and focus the editor.
   Same-file and cross-file definitions work. An existing dirty destination keeps its buffer and
   undo history. UTF-16 positions, non-BMP characters, CRLF/BOM, encoded paths and LocationLink
   `targetSelectionRange` are handled explicitly.
5. Flush the real current buffer before querying. A newer gesture, normal interaction, source edit,
   source/tab replacement, project change or disposed editor makes old results unusable. A delayed
   file open cannot select an unrelated tab or overwrite a newer navigation.
6. An empty result or unsupported/unavailable target gets concise localized status feedback. Keep
   logs to semantic outcomes/counts; do not log symbols, source text, raw LSP payloads or full paths.

## Boundaries

- The plugin remains the independently packaged TS/JS provider. No new SDK, native executable,
  arbitrary file read or workspace-edit authority is introduced for a mouse gesture.
- This iteration opens only targets represented in the current workspace's authoritative file
  catalog through its existing file-open path. Legal read-only catalog targets may be viewed;
  their buffers remain read-only. Unknown/external library targets fail with an explicit status.
- Historical/Diff/conflict surfaces and Rust are not silently treated as current editable TS/JS.
- Underline is a candidate affordance, not a claim that the server has already resolved a target.
  Pointer movement and modifier changes never start language requests.
- At most one active gesture per mounted editor, at most 16 distinct normalized definition targets,
  no auto-repeat request storm, and no automatic retries. Existing native request/document bounds
  continue to apply. No mutation or formatting is performed by navigation.

## Stages

| Stage | Implementation | Acceptance |
| --- | --- | --- |
| D0 | Record interaction, scope, ownership and gates before code | Commit this plan |
| D1 | Pure bounded Location/LocationLink normalization; shared F12 and modifier-pointer controller; hover affordance and macOS context-menu treatment | Malformed targets, modifier/button filtering, caret-vs-hit-position, stale-response and destroy/blur tests |
| D2 | Host menu for multiple definitions; current-target navigation guard; exact selection/focus; localized outcomes and metadata logs | Same/cross file, dirty target, UTF-16/CRLF/BOM, encoded paths, failed open, workspace/tab/action races and keyboard menu tests |
| D3 | Real Chromium/WebKit pointer tests plus actual Asterlyn source import/definition evidence; quality gates and native delivery | Real Ctrl-click (not direct method calls), actual target tab/selection/focus, old-response rejection, no request-per-move; check/build/script suite, relevant Rust checks, signed package and canonical install/icon reopening |

Ownership follows existing boundaries: the application layer validates plain definition data; editor
presentation owns hit-testing, highlighting and the chooser; composition owns workspace/file/tab
identity and existing file opening. Keep `app.ts` as thin wiring and preserve architecture budgets.
No subagents are required for this bounded iteration. Local commits are staged; no remote push or
Release publication is part of this request.

## Follow-up navigation capabilities

After this workflow is accepted: a common back/forward location history; authorized read-only
library/source browsing outside the catalog; references/implementation navigation and symbol search;
more language-server profiles including Rust. Editable working-Diff integration requires its own
current-buffer identity/transaction tests. Rename, code actions and WorkspaceEdit retain their
separate versioned-transaction gate.

## Execution record

- D0: plan recorded before source changes.
- D1–D3: pending. Native launch/profile authority and the TS/JS package remain unchanged unless
  implementation evidence requires an explicitly documented adjustment.
