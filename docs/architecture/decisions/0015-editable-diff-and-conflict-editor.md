# ADR-0015: Editable working Diff and in-editor conflict resolution

- **Status:** Implemented
- **Date:** 2026-09-20

## Context

Asterlyn currently renders local text changes as a read-only patch projection. The split view pads
one-sided rows so both sides align, which is appropriate for inspection but cannot be treated as the
exact worktree document. Conflict content is already read through Git's stage 1/2/3 objects and
resolved through an exact revision token, but its presentation is a modal containing three static
previews and a textarea. Adding editing directly to either projection would create a second
unsaved-buffer model and would let repository refresh, editor tabs, and conflict resolution disagree
about the bytes that will be written.

The required interaction has two related but distinct forms:

1. a local working Diff with the repository version read-only, the current file freely editable,
   line-number gutters adjacent to the center, and a per-change revert affordance; and
2. a three-pane conflict editor with Ours on the left, the editable Result in the center, and Theirs
   on the right, opened from a dedicated Conflicts group in Changes.

## Decision

### One writable worktree buffer

An editable working Diff is a presentation of the existing `TextTabState` for the exact project
file. The editor-session controller remains the only owner of worktree text, BOM policy, line-ending
map, base revision, dirty state, edit version, save request, and external-change conflict. Opening a
working Diff may ensure that text tab is loaded without activating its ordinary source view, then
activate the replaceable Diff preview. Editing the current side updates that same tab; `Ctrl/Cmd+S`,
close protection, workspace replacement, file moves, watcher reconciliation, and optimistic save
therefore keep their established semantics.

The Git read supplies the exact current `FileChange` identity and a bounded full repository-side
text source from `HEAD` (using the original path for a rename). Untracked files use an empty source.
Deleted, conflicted, binary, invalid-UTF-8, symbolic-link, read-only, and over-limit files remain
explicitly non-editable. A stale status identity or a changed repository object rejects the read.
The editable pane never saves a padded or truncated patch document.

The lazy editor adapter uses CodeMirror's merge capability for full-document comparison. In split
mode the before side is read-only, the current side is editable, and both line-number gutters sit
next to the central action gutter. In unified mode the current document remains editable and the
original appears as merge decorations. A per-chunk revert control edits only the current buffer; it
does not invoke `git checkout`, mutate the index, or save automatically. Standard editor undo can
undo that buffer edit before save.

### Shared gutter and scrolling contract

Split working Diffs, read-only historical Diffs, and both halves of the three-pane conflict editor
share one supported gutter rule: a left document uses a custom CodeMirror gutter with
`side: "after"`, while a right document uses the ordinary `before` side. Change markers use the same
side-aware extension and semantic colors. CodeMirror's native merge change gutter is disabled when
the shared marker is present, so one logical change never produces two competing color strips.
Historical Diffs keep their bounded patch projection and source-line mapping, but reuse this line
number and marker presentation instead of the legacy pane-header layout.

CodeMirror Merge deliberately makes the outer `.cm-mergeView` the vertical scroll owner and lets
the inner editor scrollers grow with content. Asterlyn preserves that contract: the outer merge
container has the bounded surface height and `overflow: auto`; editor and gutter DOM are never
reordered with CSS. The two merge projections used by the conflict editor link their outer scroll
containers so Ours, Result, and Theirs remain vertically coordinated.

**Amendment, 2026-09-21.** Because the inner scrollers still own the horizontal axis, the editable
working Diff links its two panes' horizontal offsets explicitly (`linkHorizontalScroll`) and
disposes that link with the surface; vertical positions stay with the outer scroll owner. The
per-chunk revert control is a 26-pixel control centered in its gutter and centered on the changed
line: CodeMirror positions it with a document-relative `top` while the gutter is a sibling of the
editor rows, so the editor content's own top padding is added back in the surface stylesheet.
Collapsed-unchanged rows are CodeMirror's own widget, so the app editor theme restates
`.cm-collapsedLines` with semantic tokens instead of inheriting the package's neutral defaults.

**Amendment, 2026-09-22.** To prevent horizontal scrollbars from being buried at the bottom of tall
documents where they require scrolling to the end of the file to reach, the split editable Diff mounts
a fixed bottom scrollbar track below `.cm-mergeView`. The bottom scrollbar track aligns separate
horizontal scrollers under both panes (with a spacer for the revert gutter and an auto-sized spacer for
the vertical scrollbar) and links them directly to each pane's `scrollDOM` using `linkHorizontalScroll`.
The document-bottom scrollbars on `.cm-scroller` inside `.cm-mergeView` are suppressed with CSS,
ensuring horizontal scrolling is immediately accessible at the bottom of the viewport at all times
without breaking linked scroll coordination.

### Conflict editor in the persistent editor region

Conflict discovery remains Git-owned. Changes projects three stable groups in order: Conflicts,
Changes, and Unversioned Files. A conflicted path appears only in Conflicts and is never treated as a
committable normal change. Selecting or activating Resolve opens a `conflict-resolution` editor
preview instead of a modal.

The conflict editor renders Ours, Result, and Theirs as full CodeMirror documents. Ours and Theirs
are read-only; Result is freely editable and starts from the current worktree conflict result, then
Ours, then Theirs when no worktree file exists. Base is not a fourth visible pane: it drives
base-to-ours and base-to-theirs change classification. Center gutters provide directional controls
that apply one reviewed change region into Result. Added/deleted, binary, or otherwise ambiguous
files keep explicit fail-closed handling instead of guessing a merge result. All panes share syntax,
theme, font, whitespace, linked scroll, keyboard, and bounded-document policies with the ordinary
editor.

`Save and Stage` sends the complete Result through the existing `resolve_conflict` revision-token
boundary. The application service publishes recovery data, performs revision-checked atomic
replacement, rechecks index stages, stages the literal path, and verifies the stage-zero object.
`Resolve as Deleted` keeps its explicit destructive action. A repository or conflict-stage change
never overwrites a draft; it marks the editor stale and requires reload or an explicit discard.
Continue remains unavailable until Git reports no unresolved stages.

### Dependency boundary

Adopt exact package `@codemirror/merge` **6.12.2** from the public npm distribution under the MIT
license. The accepted tarball is
`https://registry.npmjs.org/@codemirror/merge/-/merge-6.12.2.tgz` with npm integrity
`sha512-V8JvyAPjHbPupqP7BeMcsdsYCbyPij74jxIbaIJDORI+VZzW44zFmon8bF+oxGWvOKhcRmkiUMXd8MxHr3YA2w==`.
Its declared dependencies (`@codemirror/language`, `@codemirror/state`, `@codemirror/view`,
`@lezer/highlight`, and `style-mod`) already resolve in Asterlyn's editor graph, so the lockfile adds
the merge package without a second CodeMirror family. The license text is bundled with application
licenses. The package is imported only by the lazy Diff/conflict editor chunk; it must not enter the
startup shell, application services, domain models, or persisted state.

## Invariants

1. Repository and workspace bytes have one writable frontend owner: `TextTabState` for ordinary
   files and the operation controller's bounded conflict Result for unresolved index stages.
2. A visual Diff projection is never serialized as the worktree file.
3. Per-change revert modifies only the current in-memory worktree buffer and remains undoable.
4. Saving an editable Diff uses the existing workspace revision and atomic replacement boundary.
5. Conflict resolution uses the existing Git conflict revision token and verified stage-zero result.
6. Refresh may reconcile decorations and status but cannot replace a dirty working or conflict
   buffer.
7. Binary, unsupported, and oversized inputs fail closed without pretending to be editable text.
8. Diff and conflict runtimes are lazy, disposable, and own no repository truth.
9. Center gutters use CodeMirror's public gutter-side API; CSS must not reorder sticky gutter DOM.
10. Merge surfaces retain one bounded outer vertical scroll owner, including after unchanged lines
    are expanded.

## Delivery sequence

1. Add the bounded full repository-side working-Diff read model and protocol validation.
2. Allow editor-session text tabs to load without stealing activation from a Diff preview.
3. Replace supported local read-only split/unified Diff presentation with the shared editable merge
   adapter and per-chunk revert.
4. Add the Conflicts group and move conflict editing from the modal into a three-pane editor preview.
5. Close with controller, parser, protocol, real-repository, browser, accessibility, bundle,
   performance, and known-limit evidence.

## Consequences

The UI gains richer editing without weakening the established filesystem or Git write boundaries.
The cost is a new lazy editor dependency, a full-text repository-side read for supported changed
files, additional editor presentation state, and explicit stale/draft handling across repository
refresh. Very large, binary, symlink, submodule, and unsupported-encoding conflicts remain external
tool workflows rather than silently degraded editors.

Implementation and acceptance evidence is recorded in
[`2026-09-20 editable Diff and conflict editor`](../../benchmarks/2026-09-20-editable-diff-conflict-editor.md).
