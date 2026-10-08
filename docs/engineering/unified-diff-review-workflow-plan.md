# Unified Diff review workflow plan

- **Status:** Planned
- **Date:** 2026-10-08
- **Scope:** Two-pane text Diff and three-pane conflict resolution

## Objective

Turn Asterlyn's text comparison surfaces into one coherent review workflow rather than a collection
of editors that happen to show changes. Two-pane Diff and three-pane conflict resolution should use
the same interaction vocabulary, navigation, block geometry, collapse behavior, visual hierarchy,
keyboard model, and accessibility contract while preserving their different write permissions.

The target experience is:

1. identify what is being compared and how much work remains;
2. move through meaningful change or conflict blocks;
3. understand the correspondence between source and result without manually matching line numbers;
4. take the permitted action at the block that owns it;
5. see whether that block is pending, accepted, ignored, reverted, or manually edited; and
6. finish, cancel, save, or stage through the existing safety boundaries.

This plan intentionally covers both two-pane and three-pane views. Updating only the conflict view
would duplicate toolbar, navigation, folding, action-control, and layout logic and would leave the
product with two different review languages.

## Existing implementation inventory

### Renderers

- `DiffEditor` renders bounded read-only patches for history, commit comparison, stash, and push
  review. Split mode uses two CodeMirror documents built from aligned synthetic patch rows; unified
  mode uses one synthetic document.
- `EditableDiffEditor` renders full-document working Diffs and workspace-replacement previews with
  CodeMirror `MergeView`. The current/worktree side is the only editable document. Its action gutter
  can revert a block or expose a consumer-owned action.
- `ConflictEditor` composes two CodeMirror `MergeView` instances: Ours-to-Result and
  Result-to-Theirs. Result has a primary editable instance and a synchronized hidden mirror.
- `ConflictResolutionModel` already owns Base-anchored conflict blocks, independent Ours/Theirs
  decisions, Result-range remapping, deterministic two-sided acceptance, and manual-edit reset.

### Reusable foundations already present

- `lineAwareDiff` and `wordDiffRanges` provide bounded line and word comparison.
- `mergeDiffSemanticHighlighting` provides consistent live MergeView line and word semantics.
- `diffLineNumberGutter` and `createEditorChangeIndicators` provide side-aware line numbers, change
  markers, and overview indicators.
- `linkHorizontalScrollGroup`, `linkVerticalScrollByDocument`, and the splitter utility provide
  bounded scroll and layout coordination.
- `ConflictCollapseCoordinator` demonstrates Base-owned folds projected into several documents.
- `DiffPresentation`, `DiffSideLabels`, exact-text content handling, theme compartments, language
  loading, search, and focus ownership already form shared editor infrastructure.
- `renderDiffControls` already exposes previous/next change, previous/next file, open source,
  unchanged-line expansion, split/unified layout, and visible-whitespace controls for ordinary Diff.

### Current experience gaps

- Conflict resolution has no shared review toolbar, next/previous conflict command, meaningful
  progress summary, file navigation, comparison controls, or cancel action.
- Conflict pane headers use generic roles and raw pairwise Diff counts instead of branch/revision
  identities and user-facing conflict/non-conflict counts.
- Two-pane and three-pane action gutters share some CSS but not a common model, DOM contract, or
  state presentation.
- The two conflict MergeViews compute pairwise geometry. Shared folds and Result-anchored scrolling
  repair synchronization, but there is no shared visual block geometry or connector layer.
- Editable Diff, read-only Diff, replacement Diff, and conflict Diff each own parts of scrollbar,
  pane-label, splitter, folding, and navigation behavior.
- The conflict Result receives no layout priority even though it is the only writable pane.
- Change colors currently communicate low-level added/removed/modified state better than they
  communicate review state such as pending, accepted, ignored, reverted, or manually edited.

## Product principles

1. **One review language, capability-driven actions.** Every surface shares the same chrome and
   block vocabulary; controls appear only when the active surface supports the action.
2. **Result ownership remains explicit.** A two-pane working Diff edits only the worktree buffer; a
   conflict edits only Result; read-only comparisons never acquire mutation actions.
3. **Visual state is not repository truth.** Review decisions, active blocks, connectors, folds, and
   progress are transient presentation state. Existing revision tokens, atomic saves, and Git stage
   verification remain authoritative.
4. **Shared contract does not mean one renderer.** Read-only patch projections and full-document
   MergeViews may keep different internals if they implement the same review interfaces.
5. **Meaningful blocks, not raw Diff fragments.** Counts, navigation, actions, and status operate on
   stable review blocks. Raw CodeMirror chunks remain an implementation detail.
6. **Manual edits are first-class.** A manually edited Result is not silently relabeled as accepted
   from either source, and a bulk action never overwrites a touched block.
7. **Color is supplementary.** Text, icons, pressed state, accessible labels, and tooltips must
   communicate every status without relying on color alone.
8. **Bounded work per frame.** Connector and scroll geometry update at most once per animation frame;
   comparison retains the existing scan limits and timeouts.

## Target interaction contract

### Shared review toolbar

All text review surfaces use a shared `DiffReviewToolbar` view model and renderer. The toolbar is
grouped from left to right:

1. previous/next block;
2. previous/next file when the surface belongs to a file collection;
3. a summary such as `3 changes`, `2 conflicts · 1 unreviewed`, or `4 of 11`;
4. layout controls supported by the surface;
5. unchanged-line expansion and visible-whitespace controls; and
6. surface-specific actions.

Two-pane surfaces retain split/unified switching. Conflict resolution remains three-pane and does
not present a misleading unified mode. The toolbar uses command IDs rather than one-off click
handlers so buttons, shortcuts, menus, and the command palette share availability and execution.

The first delivery keeps whitespace as a display preference. Ignore-whitespace comparison is a
separate algorithmic policy and must not be disguised as the existing `showWhitespace` setting. A
future policy may affect presentation grouping only; it must never change bytes applied to Result.

### Pane hierarchy and sizing

- Read-only two-pane comparisons default to 50/50.
- Editable two-pane comparisons default to 42/58 so the writable current side has priority.
- Conflict resolution defaults to equal thirds for Ours/Result/Theirs; the two fixed action gutters are excluded before the available editor width is divided.
- Every split is draggable, keyboard-adjustable, bounded by readable minimum widths, double-click
  resettable, and persisted in workbench layout state rather than repository state.
- Result remains visually central and is labelled as the writable outcome. Source panes are labelled
  with actual branch, revision, or operation identities whenever the backend can supply them.

The existing `diffBeforePercent` persists the two-pane split. Conflict adds two layout percentages
whose normalization guarantees the three panes plus both action gutters always fit the viewport.

### Pane headers

Replace surface-specific label markup with `DiffReviewPaneHeader`. A header may expose:

- role: Before, Current, Ours, Result, or Theirs;
- identity: branch, remote-tracking branch, commit abbreviation, stash, or working tree;
- local block count relevant to the pane;
- writable/read-only status; and
- an optional Details action.

Conflict data must stop displaying raw `diff(...).length` values as if they were conflict counts.
The summary comes from classified review blocks: conflicting, non-conflicting, identical, reviewed,
and pending.

### Review blocks

Introduce a renderer-independent `DiffReviewBlock` projection:

```ts
interface DiffReviewBlock {
  id: string;
  kind: "added" | "removed" | "modified" | "conflict" | "identical";
  ranges: Readonly<Record<DiffReviewPaneId, { from: number; to: number } | null>>;
  status: "pending" | "accepted" | "ignored" | "reverted" | "manual" | "readonly";
  actions: readonly DiffReviewAction[];
}
```

The projection is not a new Diff algorithm. Adapters translate existing patch rows, MergeView
chunks, and `ConflictResolutionModel` snapshots into the shared block contract.

- Read-only Diff blocks are always `readonly` and support selection/navigation only.
- Editable working Diff blocks support Revert and undo through the existing text-tab owner.
- Workspace replacement blocks keep their consumer-provided action semantics.
- Conflict blocks support Apply and Ignore independently for Ours and Theirs. A manual Result edit
  changes the relevant block to `manual` and clears stale side decisions.

Block IDs must be stable across ordinary Result edits and in-place reconfiguration. Two-pane full
document blocks are anchored to the immutable before document; conflict blocks remain Base-anchored.

### Action gutter

Replace per-editor action DOM with a shared `DiffReviewActionGutter` contract:

- one decorated hit target size and icon geometry across two-pane and three-pane views;
- controls attached to a complete block boundary, not visually floating beside an isolated line;
- pressed state for accepted/ignored decisions;
- disabled and busy states with accessible explanations;
- hover/focus labels that name both the action and affected side; and
- no mutation handler inside CodeMirror's built-in revert event path.

Two-pane Revert, replacement Accept/Reject, conflict Apply, and conflict Ignore use the same control
component but retain distinct labels and commands. The component must not infer write behavior from
arrow direction.

### Block geometry and connectors

Add a shared `DiffReviewGeometryCoordinator` that receives review blocks and registered editor views.
It produces visible block rectangles through public CodeMirror measurements and exposes one
frame-coalesced geometry snapshot.

- Two-pane split views may render a subtle connector only where row insertion/deletion makes the
  correspondence ambiguous.
- Conflict view renders a connector layer on both boundaries: Ours-to-Result and
  Result-to-Theirs.
- Pending conflicts use a bounded neutral-danger treatment; accepted blocks soften into reviewed
  state; ignored source blocks are dimmed; manually edited Result blocks receive a distinct marker.
- Connectors use an SVG overlay with `pointer-events: none`; action controls remain ordinary buttons.
- Connectors are clipped to the content viewport and recomputed after edits, folds, resize, font
  changes, splitter movement, and scroll.
- Reduced-motion mode disables geometry transitions.

The first connector implementation keeps the current pairwise MergeViews, because they provide
supported editing and alignment behavior. A gate after visual acceptance determines whether the
remaining pairwise spacer differences justify a custom three-way spacer extension. No code may
depend on private CodeMirror DOM or package internals to imitate Android Studio.

### Folding

Generalize `ConflictCollapseCoordinator` into `DiffReviewCollapseCoordinator`:

- two-pane full-document Diff projects one before-owned unchanged interval into both panes;
- conflict uses the union of Base-to-Ours, Base-to-Result, and Base-to-Theirs changes and projects a
  single fold ID into every editor instance;
- expanding or collapsing one fold updates every visible pane;
- source panes use a low-emphasis fold marker while the writable/result pane owns the descriptive
  text, avoiding three equally loud banners; and
- read-only bounded patches retain their omitted-row model but expose the same expand command and
  visual treatment.

The migration must remove feature-local folding once a surface adopts the coordinator. Built-in
`collapseUnchanged` and custom fold widgets must not run simultaneously on the same surface.

### Navigation and progress

Navigation moves between shared block IDs rather than raw line starts or pairwise chunks. Selecting
a block:

- marks the same block in every pane;
- scrolls through the shared document anchor;
- focuses the writable pane when one exists, otherwise the active source pane; and
- announces the position and state, for example `Conflict 2 of 4, pending`.

Conflict-specific progress distinguishes:

- non-conflicting blocks that can be applied automatically;
- true conflicts where both sides differ;
- reviewed decisions;
- manually edited blocks; and
- pending/unreviewed blocks.

`Save and Stage` becomes available only after every changed side has an explicit Apply or Ignore
decision. Editing Result resets the affected decisions to pending, so a manually authored result
must still be acknowledged from both side action gutters before completion.

### Bulk conflict actions

Add `Apply non-conflicting changes: Ours / All / Theirs` after block classification is stable.

- A non-conflicting block changes on only one side or has identical content on both sides.
- Bulk apply executes one deterministic Result transaction so it is one undo step.
- It operates only on untouched pending blocks and reports manually edited blocks that were skipped.
- `All` does not auto-resolve genuinely divergent two-sided conflicts.
- The operation updates the same transient decision model used by individual controls.

### Cancel, finish, and destructive actions

- Two-pane editable Diff retains normal editor close/save semantics.
- Conflict adds a visible Cancel action that closes the preview without mutating Git. A dirty Result
  uses the existing discard-confirmation path.
- `Save and Stage` remains the primary completion action and retains revision-token verification.
- `Resolve as Deleted` moves out of the primary action pair into an explicit destructive menu or
  separately styled secondary action with its existing confirmation.
- Closing the file, changing project, quitting, or starting another Git operation continues to
  capture or confirm the conflict draft through `ConflictEditorRuntime` and the controller.

## Target architecture

### Shared presentation layer

Add presentation-neutral modules under `src/shared/diff-review/` so Git operations, Push, and the
files editor can depend on them without creating cross-feature imports:

- `diff-review-model.ts`: capability, pane, block, summary, and status types;
- `diff-review-projection.ts`: two-way and conflict adapters over existing models;
- `diff-review-toolbar.ts`: toolbar view model, markup, availability, and action identifiers;
- `diff-review-pane-header.ts`: shared pane identities and details affordance;
- `diff-review-action-gutter.ts`: shared action-button rendering and state synchronization;
- `diff-review-block-decoration.ts`: block background and active/reviewed state extensions;
- `diff-review-collapse.ts`: common full-document fold coordinator;
- `diff-review-geometry.ts`: measured block rectangles and connector paths;
- `diff-review-overlay.ts`: SVG overlay lifecycle; and
- `editable-diff-review-splitter.ts`: editable two-pane splitter registration and reset;
- `editable-diff-scrollbars.ts`: docked horizontal scrollbar ownership; and
- `editable-diff-review-surface.ts`: editable folding and connector lifecycle.

Shared CSS belongs in `src/shared/diff-review.css`. Surface CSS may define only
composition-specific grid placement and exceptional capabilities. `shared/controls.css` keeps truly
generic button primitives, not conflict-specific layout rules.

### Surface adapters

`DiffEditor`, `EditableDiffEditor`, and `ConflictEditor` implement a narrow surface port:

```ts
interface DiffReviewSurface {
  reviewSnapshot(): DiffReviewSnapshot;
  navigate(blockId: string): boolean;
  activate(action: DiffReviewActionInvocation): void;
  setExpandedUnchanged(expanded: boolean): void;
  requestMeasure(): void;
}
```

The port does not expose CodeMirror views to application orchestration. Editor-specific code keeps
document updates, language compartments, exact-text serialization, and undo ownership.

### Application orchestration

- Replace `renderDiffControls` with capability-driven `renderDiffReviewToolbar` for ordinary Diff,
  push Diff, replacement Diff, and conflict resolution.
- Move toolbar actions to a new `DIFF_REVIEW_COMMANDS` command group. `App` binds active-surface
  capabilities once instead of inspecting many `data-*` values.
- `EditorSurface` forwards review operations to the currently mounted surface, including conflict.
- `ConflictEditorRuntime` supplies conflict-specific completion/cancel handlers and branch identity
  context but stops constructing its own review toolbar.
- Extend `DiffPresentation` or add `DiffReviewPresentation` for shared layout and comparison display
  preferences without mixing persisted settings with per-document progress.

### Backend and protocol impact

No Git write protocol changes are required for block-level actions or visual unification.

Conflict pane identity may require a read-model extension so `GitConflictContent` or the operation
snapshot provides display labels for Ours and Theirs. This extension is read-only, optional, and
backward-compatible in demo fixtures and protocol validation. The UI falls back to localized role
labels when an identity is unavailable.

## Implementation phases and commit boundaries

Every phase is committed separately and must leave the branch buildable.

### Phase 0 — characterization and visual fixtures

1. Add deterministic two-pane and three-pane fixtures covering replacement, insertion, deletion,
   one-sided change, identical two-sided change, true conflict, long lines, and large unchanged gaps.
2. Lock current write ownership, exact text, undo, navigation, split ratio, folding, and scroll
   behavior with tests before refactoring.
3. Add a manual acceptance checklist with dark/light and Chinese/English screenshots.

**Commit:** `test characterize diff review surfaces`

### Phase 1 — shared model and projections

1. Introduce pane, block, capability, summary, and action types.
2. Adapt static patch blocks, live two-way chunks, and conflict snapshots without changing DOM.
3. Classify conflict blocks as non-conflicting, identical, divergent, pending, reviewed, or manual.
4. Replace raw conflict Diff counts with projection summaries behind tests.

**Commit:** `refactor unify diff review model`

### Phase 2 — shared toolbar and commands

1. Add `DIFF_REVIEW_COMMANDS`, availability, keyboard shortcuts, and localization.
2. Migrate ordinary editor Diff and push Diff controls to the shared toolbar.
3. Add the same navigation, summary, fold, and display controls to conflict resolution.
4. Add conflict Cancel; move deletion resolution to destructive secondary presentation.

**Commit:** `feat unify diff review toolbar`

### Phase 3 — shared pane headers and resizable layout

1. Replace two-pane and conflict label markup with shared pane headers.
2. Reuse the splitter utility in editable MergeView surfaces.
3. Persist 50/50 read-only, 42/58 editable, and equal-third conflict defaults and user adjustments; migrate only the legacy 27/46/27 conflict default so custom proportions remain intact.
4. Add branch/revision identities and writable/read-only indicators.

**Commit:** `feat unify diff review layout`

### Phase 4 — shared block decoration and actions

1. Introduce common pending/accepted/ignored/reverted/manual/readonly decoration tokens.
2. Migrate working-Diff revert controls and replacement controls to the common action gutter.
3. Migrate conflict Apply/Ignore without changing `ConflictResolutionModel` write behavior.
4. Add active-block selection across all panes and accessible state announcements.

**Commit:** `feat unify diff review blocks`

### Phase 5 — folding, scroll, and connector geometry

1. Generalize the full-document fold coordinator and remove duplicate folding implementations.
2. Route all horizontal owners through the existing group coordinator and all vertical alignment
   through document/block anchors.
3. Add measured block geometry and two-pane/three-pane connector overlays.
4. Verify resize, font, theme, fold, edit, and splitter changes invalidate geometry exactly once.

**Commit:** `feat add shared diff block geometry`

### Phase 6 — conflict workflow completion

1. Add previous/next conflict progress and reviewed/manual/pending states.
2. Add bounded bulk application of non-conflicting Ours/All/Theirs blocks.
3. Disable Save and Stage until every changed side has an explicit Apply or Ignore decision.
4. Preserve draft capture, discard confirmation, stale revision handling, and verified staging.

**Commit:** `feat complete conflict review workflow`

### Phase 7 — surface migration and cleanup

1. Migrate history, commit comparison, stash, push, working, replacement, and conflict text surfaces.
2. Remove old surface-specific toolbar, label, fold, scrollbar, gutter, and CSS paths only after the
   final consumer is migrated.
3. Keep image Diff on its current renderer while reusing only toolbar operations that are meaningful.
4. Amend ADR-0015 and documentation maps with the accepted contract.

**Commit:** `refactor retire legacy diff review chrome`

### Phase 8 — package and acceptance evidence

1. Run frontend scripts, TypeScript checking, production build, native workspace tests, native smoke,
   and `git diff --check`.
2. Package and replace the local application only after automated gates pass.
3. Verify packaged/installed executable hashes and retain a recoverable previous app bundle.
4. Record manual acceptance against the deterministic fixtures.

**Commit:** `docs record unified diff review acceptance`

## Test and acceptance matrix

### Model tests

- Stable block IDs across insertions before and inside a block.
- Correct two-way added/removed/modified and conflict identical/non-conflicting/divergent classes.
- Manual edits reset only touched decisions.
- Applying both conflict sides remains deterministic and does not duplicate identical content.
- Bulk apply skips manual blocks and creates one exact transaction.
- Summary counts use review blocks rather than raw Diff fragments.

### Presentation tests

- One toolbar renderer covers capability combinations without empty groups or inaccessible controls.
- Two-pane and three-pane headers expose roles, identities, counts, and writable state.
- Action controls own the correct block after remount, fold, edit, and localization changes.
- Source and Result decorations expose pending, accepted, ignored, reverted, manual, and readonly
  states without color-only meaning.
- Splitters enforce minimums, reset defaults, persist committed values, and request editor measure.

### Geometry and scrolling tests

- Long and unequal lines keep each bottom scrollbar attached to its visible content owner.
- Same-document anchors align duplicated Result views despite unequal pairwise spacer heights.
- Fold IDs, expansion state, and displayed unchanged counts stay consistent across every pane.
- Connector paths update after vertical/horizontal scroll, resize, fold, edit, font change, and theme
  change without feedback loops or more than one scheduled measurement per frame.
- Empty, first-line, last-line, insertion-only, deletion-only, and zero-height mapped ranges have
  stable connector geometry.

### Workflow tests

- Previous/next block, previous/next file, open source, fold, layout, and visible-whitespace commands
  behave consistently across eligible two-pane and three-pane surfaces.
- Conflict Cancel preserves Git and confirms dirty Result discard.
- Save and Stage remains disabled while any pending or manually edited block awaits explicit side
  decisions.
- Resolve as Deleted remains explicit and separately confirmed.
- Loading, stale revision, read-only resolving state, binary conflict, and unsupported file states
  never expose invalid mutation actions.

### Regression surfaces

- Working tree editable Diff.
- Read-only commit and commit-comparison Diff.
- Stash Diff.
- Push Diff.
- Workspace replacement Diff.
- Conflict resolution.
- Unified and split text modes where supported.
- Dark/light themes, Chinese/English, editor font-size changes, CRLF/BOM, Unicode, no-final-newline,
  long lines, bounded large files, and reduced motion.

## Performance and safety gates

- Do not introduce a second writable buffer for worktree or conflict Result text.
- Do not serialize padded rows, fold placeholders, connector geometry, or review decisions.
- Do not use private CodeMirror APIs or reorder sticky editor/gutter DOM with CSS.
- Geometry reads occur in a measurement phase and DOM writes in the scheduled presentation phase.
- Connector work scales with visible review blocks; off-screen blocks do not require path updates.
- All Diff computation remains bounded by existing scan limits, timeouts, and large-file fallbacks.
- No bulk action may overwrite a block marked manual or bypass exact revision verification.

## Explicit non-goals for the first delivery

- Syntax/AST-aware merge.
- Directory-level Diff redesign.
- Image Diff rendering changes.
- A new Git merge algorithm or replacement of Git index stages.
- Ignore-whitespace comparison semantics.
- Copying JetBrains implementation code or depending on private CodeMirror DOM contracts.

## Completion criteria

The redesign is complete only when:

1. every text Diff surface uses the shared review toolbar and pane-header contract;
2. two-pane and three-pane views navigate the same stable block abstraction;
3. writable panes receive layout priority and all supported splits are adjustable and persisted;
4. action controls are block-owned, accessible, and visually/statefully consistent;
5. conflict correspondence is understandable through block boundaries and connectors without manual
   line-number matching;
6. folds, scrolling, editing, undo, and remounting remain synchronized;
7. conflict progress, cancel, bulk non-conflicting apply, manual edits, Save and Stage, and destructive
   deletion resolution follow the documented safety behavior;
8. legacy duplicate review chrome is removed rather than left as dormant parallel code; and
9. automated gates and fixture-based manual acceptance pass before local installation replacement.
