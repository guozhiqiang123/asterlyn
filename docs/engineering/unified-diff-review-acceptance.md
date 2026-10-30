# Unified Diff review acceptance

- **Status:** Automated acceptance complete; installed build awaiting manual visual acceptance
- **Plan:** [`unified-diff-review-workflow-plan.md`](unified-diff-review-workflow-plan.md)
- **Started:** 2026-10-08

This page is the durable acceptance record for the unified two-pane Diff and split/unified
three-way conflict review workflow. Evidence is added after each independently buildable phase;
unchecked items are not claims of completion.

## Deterministic fixtures

Automated fixtures cover:

- replacement, insertion, and deletion;
- one-sided changes, identical two-sided changes, and divergent conflicts;
- large unchanged gaps and long lines;
- exact line endings and trailing-newline behavior;
- manual Result edits and independent Ours/Theirs decisions; and
- read-only two-pane, editable two-pane, and one-writable-Result ownership.

## Manual acceptance matrix

Run the matrix in both dark and light themes, and in English and Chinese.

| Surface | Required evidence | Status |
| --- | --- | --- |
| Read-only split Diff | headers, navigation, resizing, synchronized scroll, unchanged expansion | Ready for manual acceptance |
| Read-only unified Diff | navigation, unchanged expansion, visible whitespace | Ready for manual acceptance |
| Editable working Diff | Result priority, Revert, undo, save ownership, exact text | Ready for manual acceptance |
| Workspace replacement Diff | shared controls, consumer action, cancel/apply safety | Ready for manual acceptance |
| Split three-way conflict | aligned blocks, two-sided actions, manual edit, cancel, save and stage | Ready for manual acceptance |
| Unified three-way conflict | one Result stream, paired source cards, layout switching, Undo/Redo | Ready for manual acceptance |
| Long-line fixture | independent content ownership and synchronized horizontal navigation | Ready for manual acceptance |
| Large-gap fixture | identical folds and expansion across every visible pane | Ready for manual acceptance |
| Reduced motion | stable connectors without animated geometry | Ready for manual acceptance |

## Phase evidence

### Phase 0 — characterization

- Added deterministic projection and conflict-model fixtures.
- Locked immutable read-only Diff and single writable conflict Result ownership.
- No production behavior changed.

### Phase 1 — shared model and projections

- Added renderer-independent pane, block, action, capability, status, and summary contracts.
- Added adapters for static patches, live two-way chunks, and Base-anchored conflict blocks.
- Conflict summaries now distinguish one-sided, identical, divergent, reviewed, pending, and manual
  blocks without treating raw Diff fragments as user-facing conflicts.
- Manual Result edits are retained as explicit model state and are cleared only by a later deliberate
  block decision.

### Phase 2 — shared toolbar and commands

- Ordinary editor Diff and Push Diff now render through one capability-driven toolbar.
- Existing stable command IDs remain compatible through the `DIFF_REVIEW_COMMANDS` name.
- Conflict resolution now exposes previous/next block and conflicted-file navigation, reveal in
  Files, unchanged expansion, progress, whitespace display, Cancel, Save and Stage, and a visually
  separate delete-resolution action in the same header.
- Conflict resolution exposes the shared split/unified control. Unified presentation remains a
  semantic three-way review rather than collapsing either source into an ordinary two-way Diff;
  file navigation and reveal reuse the shared command IDs and availability contract.

### Phase 3 — shared pane headers and resizable layout

- Read-only, editable, and conflict surfaces now use one pane-header renderer with explicit writable
  metadata and preserved revision casing.
- Read-only split Diff keeps a 50/50 default, editable Diff uses 42/58, and conflict uses equal thirds
  after excluding the two fixed action gutters.
- Editable two-pane and conflict three-pane widths are pointer-draggable, keyboard-adjustable,
  double-click resettable, bounded, and persisted in workbench layout state.
- Conflict action gutters remain fixed-width while pane widths change, preserving control geometry.

### Phase 4 — shared block decoration and actions

- Editable Revert and conflict Apply/Ignore controls now use one action renderer, hit target,
  icon geometry, selected state, disabled state, focus treatment, and accessibility contract.
- Conflict block state is projected into Ours, Result, and Theirs as pending, accepted, ignored, or
  manually edited without depending on color alone.
- Previous/next conflict navigation marks the same active Base-owned block in every pane and moves
  focus to the writable Result.

### Phase 5 — folding, scroll, and connector geometry

- Two-pane editable Diff and three-pane conflict folds now use one anchor-owned coordinator; fold
  IDs and unchanged-line counts are projected consistently into every visible document.
- Conflict unchanged regions can be expanded or collapsed from the shared toolbar as one operation.
- Two-pane and three-pane editors render frame-coalesced SVG block connectors measured through
  public CodeMirror coordinates; overlays are clipped to visible content and never receive input.
- Existing document-anchored vertical synchronization and grouped horizontal scroll ownership are
  retained, while resize, fold, edit, splitter, and scroll events invalidate connector geometry.

### Phase 6 — conflict workflow completion

- Conflict review exposes Apply/Ignore only beside an individual block. The shared toolbar has no
  `Ours`, `All`, or `Theirs` bulk shortcut, so every reviewed location remains visible when acted on.
- Each per-block action enters Result and its transient decision state in the same CodeMirror history
  event, so Undo and Redo restore them together.
- `Save and Stage` remains disabled until both sides of every genuinely divergent conflict have an
  explicit Apply or Ignore decision; pending one-sided and identical blocks do not gate completion.
  Manual edits to divergent Result blocks reset their decisions to pending. The existing exact
  revision token, staged-blob verification, and mutation path remain unchanged.
- Conflict Cancel now uses the existing discard confirmation for a dirty Result, clears only the
  transient draft, and performs no Git mutation.

### Phase 7 — surface migration and cleanup

- History, commit comparison, stash, working-tree, and ordinary read-only text comparisons continue
  through the editor Diff adapter; Push, replacement, editable working Diff, and conflict now all
  render the shared capability-driven toolbar.
- Editor, Push, and replacement hosts retain isolated command attributes while sharing button
  markup, labels, state, and accessibility behavior.
- Shared review modules live under `src/shared/diff-review/`, preventing cross-feature imports; the
  architecture dependency and source-ownership budget suites remain green.

### Phase 8 — package and acceptance evidence

- The complete frontend suite passed: 893 tests, 0 failures. TypeScript checking, the production
  frontend build, and `git diff --check` also passed.
- The Rust workspace passed 271 tests with 0 failures and 2 existing ignored watcher tests. The
  installed executable launched the Flutter conflict workspace successfully after replacement.
- The accepted macOS arm64 archive is
  `target/release/bundle/macos/Asterlyn-conflict-toolbar-20261008-173930-macos-arm64.zip`,
  9,147,312 bytes, SHA-256
  `2d60fad6e019a5323cd068a01bf775c08bef6d11e42fd4b40391b0a970372370`.
- The packaged and installed executables are both 24,046,032 bytes with SHA-256
  `189f4f2feaf1b0be056663f08d7a63fcfb58bacc0eae6e4c05d2bac9fb5187c9`. The bundle is an arm64
  application with an ad-hoc hardened-runtime signature and passed strict deep signature
  verification before and after installation.
- `/Applications/Asterlyn.app` was replaced and relaunched against `/Users/gzq/flutter`. The previous
  installation remains recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-conflict-toolbar-20261008-173930.app`.
- The final visual refinement removes the redundant 3px per-line conflict-status rail while keeping
  the 5px Diff gutter, connector fill, action state, active-block emphasis, and ignored-text
  treatment. Connector edge strokes were also removed so Patch ranges do not paint 1px colored
  segments on action-gutter boundaries; focused regressions prevent both rails from returning.
- Splitter projection computes all three content widths from one gutter-exclusive layout and
  explicitly resizes the visible Theirs editor. The first splitter now transfers width only between
  Ours and Result, the second only between Result and Theirs, and the outer conflict root is observed
  so workbench resizing reprojects all three panes. Conflict toolbar summaries shrink before
  completion controls, whose labels retain fixed hit targets.
- New conflict views and splitter double-click reset divide the gutter-exclusive content width into
  equal thirds. Persisted 27/46/27 values migrate as the legacy default, while every other saved
  proportion remains untouched.
- Conflict completion now follows the Android Studio interaction contract: resolved side controls
  stay hidden after Result-driven chunk rebuilds, both sides of a divergent block must be decided,
  and Save and Stage fails closed while any divergent conflict remains pending or manually edited.
- Switching to another conflict is guarded before Changes selection mutates. Content edits and
  decision-only drafts both show a modal instructing the user to save or cancel the current
  resolution, while the current row and editor stay active.
- Conflict Apply and Ignore decisions participate in the same isolated Undo/Redo event as Result
  text. The regression sequence Apply Ours, Apply Theirs, Undo, Ignore Theirs ends with Ours accepted,
  Theirs ignored, and zero pending conflicts; decision-only actions also undo and redo explicitly.
- The three conflict-wide Ours/All/Theirs controls and their model, event, localization, and CSS paths
  are removed. Conflict decisions are available only beside their individual blocks. The toolbar now
  completes the applicable two-pane command set with previous/next conflicted file and reveal in
  Files, while retaining previous/next block, unchanged expansion, and visible whitespace.
- Host evidence: macOS 15.6.1 (24G90), Apple Silicon; Node.js 26.8.1, npm 11.19.0, Rust 1.97.1,
  and Git 2.48.1.
- The matrix above deliberately remains at `Ready for manual acceptance`: automated projection,
  interaction, geometry, exact-text, and installed-rendering checks are complete, but dark/light,
  English/Chinese, and reduced-motion visual inspection still requires a human acceptance pass.

### Phase 9 — true three-way unified conflict review

- Conflict capabilities now expose the shared split/unified control. The selected global Diff
  layout reaches the mounted conflict editor without remounting it.
- Unified mode keeps the existing editable Result `EditorView` and injects presentation-only Ours
  and Theirs source cards around each Base-owned block. Switching layouts therefore retains exact
  Result bytes, selection, search, folds, scroll, Undo/Redo history, and explicit side decisions.
- Source-card Apply/Ignore controls carry immutable source ranges and delegate to the same
  `conflictResolutionTransaction` path as split gutters. The save gate and per-block-only policy are
  unchanged; no conflict-wide Ours/All/Theirs action was reintroduced.
- Automated fixtures prove that both source fragments and ranges are retained, source widgets do
  not change Result bytes, accepted/pending state matches the split projection, and layout switching
  does not destroy or remount Result.
- The current frontend suite passes 897 tests. TypeScript checking, production build,
  `git diff --check`, 271 native tests with 2 existing ignored watcher tests, and rendered native
  smoke all pass.
- The accepted macOS arm64 archive is
  `target/release/bundle/macos/Asterlyn-unified-conflict-20261008-1808-macos-arm64.zip`, 9,149,851
  bytes, SHA-256 `d344cf88a4ef4809781145163b3dcdf78075549773394b56de05429ddd7b3416`.
  The packaged and installed executables are both 24,046,032 bytes with SHA-256
  `6462fa217c9846f356f5237dd368074a4aa44bd337ea9ad0cfe1b2df6545c4df`.
- The app bundle uses an ad-hoc hardened-runtime signature and passes strict deep verification. It is
  installed at `/Applications/Asterlyn.app` and open on `/Users/gzq/flutter`; the previous install is
  recoverable at `/Users/gzq/.Trash/Asterlyn-before-unified-conflict-20261008-1808.app`.

### Phase 10 — large-conflict responsiveness

- Conflict loading now separates whole-line decision geometry from refined visual comparison.
  Base-to-side structural changes are computed once and shared by conflict ownership, marker
  projection, and unchanged folding instead of repeating word-level comparison on the UI thread.
- Initial Ours-to-Result and Theirs-to-Result refined ranges run in a dedicated Worker. MergeView
  consumes the prepared ranges and semantic highlighting reuses its chunks, so Changes context-menu
  events remain independently dispatchable while the large file is being prepared.
- On `project-integration_test.lockfile`, Result creation, structural analysis, its 33-block model,
  and fold preparation dropped from roughly 3 seconds of synchronous work to 15.7 ms cold and
  2.9–3.5 ms warm. The former 381–415 ms visual comparison moved off the UI thread.
- The frontend suite passes 926 tests, the native Git crate passes 133 tests, and TypeScript,
  production build, patch hygiene, production packaging, strict bundle verification, and installed
  rendered smoke all pass.
- The accepted macOS arm64 archive is
  `target/release/bundle/macos/Asterlyn-conflict-load-performance-20261009-macos-arm64.zip`,
  9,256,728 bytes, SHA-256
  `5a57bd88828eb47f19a4f203e7bad82a6fcd464f06e928d25f7c5d56bd10263e`.
  The packaged and installed executables are both 24,162,560 bytes with SHA-256
  `a41a8ab47959ca6d23976e523c16e97b860b0ede0b3871289ada33a9487c3e99`.
- `/Applications/Asterlyn.app` is signed with an ad-hoc hardened-runtime signature, relaunched on
  `/Users/gzq/flutter`, and matches the accepted build. The prior install remains recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-conflict-load-performance-20261009.app`.

### Phase 11 — worker-safe conflict Diff values

- Root cause for the blank unified editor on
  `dev/integration_tests/flutter_gallery/android/project-video_player_android.lockfile` was the
  Worker structured-clone boundary: Diff range fields survived, but CodeMirror `Change` prototypes
  did not. This file's insertion/deletion alignment invokes `Change.offset()`, so MergeView threw
  after replacing the loading surface and left an empty editor.
- The main thread now rehydrates every worker-returned structural and visual range as a CodeMirror
  `Change` before editor construction. Mount failures are also caught and rendered as a visible
  conflict-unavailable state instead of an empty pane.
- The exact reference conflict prepares in about 3 ms locally with 381 Ours-to-Result and 278
  Theirs-to-Result visual changes. Focused conflict coverage passes 40 tests; the complete frontend
  suite passes 928 tests, native Git passes 133 tests, and TypeScript, production build, native
  package creation, strict signature validation, and rendered native smoke all pass.
- The accepted signed macOS arm64 archive is
  `target/release/bundle/macos/Asterlyn-conflict-worker-rehydration-20261009-macos-arm64-signed.zip`,
  9,257,894 bytes, SHA-256
  `6953c20bd2927f03240b967537107e4113ac1cd27cf7e44696c2dc0f9d2e18c2`.
  `/Applications/Asterlyn.app` was replaced and relaunched; its executable SHA-256 is
  `59c1eb4125d9b66003ce2f4ba13b21d55e64aaa2259f20b056f377f1e194a653`. The previous installation
  remains recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-conflict-worker-rehydration-20261009.app`.

### Phase 12 — two-pane Diff footer alignment and splitter parity

- Read-only Changes and commit-history Diff views now render one grid-aligned horizontal-scrollbar
  footer whose Before, divider, and After columns use the same split percentage and 5px divider as
  the editor above. The native CodeMirror bars are hidden, both proxy bars preserve the source
  editor's exact horizontal range, and the footer paints a continuous top boundary plus both divider
  edges. The 5px logical divider has a centered 13px invisible drag target; its interaction line
  spans the complete editor row and remains hidden until hover, focus, or drag.
- Editable Changes Diff uses the same geometry contract for its Before bar, 32px action gutter, and
  After bar. Its MergeView no longer extends underneath the footer, and native scrollbar-corner
  width is included without shifting the pane boundaries.
- The editable center action gutter is also the splitter hit target. Its full 32px width is draggable
  except where an Apply or Ignore button receives the pointer, and a narrow divider becomes visible
  on hover. Drag projection uses the complete MergeView width, so the visible pane ratio and footer
  ratio remain identical.
- A real Vite plus Playwright regression mounts the production `DiffEditor` and
  `EditableDiffEditor` in Chromium and WebKit. It checks pane/footer boundaries, footer docking,
  divider borders, hover affordances, exact splitter hit areas, and a real pointer drag that changes
  the split percentage. Both engines pass, as does the existing conflict-editor rendered matrix.
- TypeScript checking and the production frontend build pass. The complete frontend script suite
  passes 935 tests with no failures, and the native Git crate passes 134 tests with no failures.
  Rust formatting, patch hygiene, production packaging, strict deep signature verification, and
  rendered smoke against both the build and installed app also pass.
- The accepted signed macOS arm64 archive is
  `target/release/bundle/macos/Asterlyn-diff-splitter-full-height-20261010-macos-arm64-signed.zip`,
  9,263,712 bytes, SHA-256
  `5f443f09f7c69047306a9d6694cca97e27a0b1be174294763b74b430bb9bb962`. The packaged and installed
  executables are both 24,158,768 bytes with SHA-256
  `1e2a60d54796c1e17e32118726a62eb0cb14124ea38f9c22a2cd11a760aac7ca`.
- `/Applications/Asterlyn.app` was replaced and relaunched. The previous installation remains
  recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-diff-splitter-20261010-155354.app`.

### Phase 13 — editable splitter survives document scrolling

- The earlier full-height checks only mounted two-line documents. They did not exercise the
  editable MergeView's shared vertical scroller. Reproducing with the actual contents of
  `scripts/test-diff-editor-rendered.mjs` as an untracked added file proves that scrolling 300px
  also moved the splitter from viewport Y=42 to Y=-258. Its absolute `top: 0; bottom: 0` dimensions
  belonged to the scroll viewport, so its bottom stopped 300px before the visible editor bottom.
- The editable splitter now belongs to the positioned `.cm-mergeViewEditors` document container.
  Its height grows with both code panes and alignment spacers, including after edits or folding,
  and clipping to MergeView leaves a continuous line and drag target throughout the viewport.
  This requires no new scroll listener or repeated scroll-time measurements. Disposal removes the
  handle as well as its pointer and keyboard listeners.
- The action gutter is painted above the splitter while its empty surface passes pointers through.
  Rollback controls therefore remain clickable without losing the full-width gutter drag target.
- Chromium and WebKit regressions now load the test script itself, scroll 300px, scroll to the
  document middle and end, resize while scrolled, and drag from the bottom of the visible editor.
  Both the upper and lower positions are checked with actual browser hit testing. Wheel scrolling
  over the handle and a real rollback click also pass.
- TypeScript, all 939 frontend script tests, production frontend/native builds, strict bundle
  signature verification, and rendered smoke of the fixed snapshot and installed executable pass.
  Packaging uses an isolated verified snapshot before installation so concurrent updates to the
  shared bundle directory cannot substitute a different file during delivery.
- The accepted signed archive is
  `target/release/bundle/macos/Asterlyn-diff-scroll-anchor-20261010-macos-arm64-signed.zip`,
  9,264,507 bytes, SHA-256
  `e3c5e90ad373d352455c357d3ef529e1928f730565d5683ca7a12a0a46f8a555`.
  The installed `/Applications/Asterlyn.app` executable matches the verified snapshot byte for
  byte: 24,158,768 bytes, SHA-256
  `2fb6765e5c8f07b9c8224e9a648a8092047650a70f27358b999c51c6d0f6e58c`.
  The app was relaunched; the previous installation is recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-diff-scroll-anchor-20261010-1605.app`.

### Phase 14 — editable Diff headers follow the actual split (2026-10-30)

- The editable pane header still used two equal content columns while the editor and footer used
  the persisted split percentage. At the 42% default in a 1500px Chromium fixture, the Before header
  ended at X=734 but its editor ended at X=630, leaving a 104px discontinuity at the action gutter.
- The header now consumes the same `--diff-before-width` and fixed action-gutter width as the
  editor. Initial mounting, pointer resizing, double-click reset, host resizing, and document
  scrolling retain aligned Before, gutter, and After boundaries without new measurement work.
- The production Chromium/WebKit regression now compares all three header columns to their
  actual editor columns with a 1px tolerance. It fails before the CSS correction and both engines
  pass afterward, including light/dark themes, bordered hosts, 1500px and 1180px windows,
  dragged/reset splits, and scrolled long documents. Existing footer, connector, rollback, and
  splitter hit-testing checks remain enabled.
- TypeScript checking, production frontend/native builds, and the complete 1,356-test script
  suite pass. An unrelated XML folding assertion failed once during concurrent builds; its
  focused rerun and the subsequent complete suite both pass without code changes.
- The accepted arm64 `0.1.22` bundle passes ad-hoc hardened-runtime signing, strict deep signature
  verification, and native rendered smoke. Multiple instances of the same bundle ID initially
  confused the accessibility probe; the same artifact passes within 6 seconds with other instances
  closed. `/Applications/Asterlyn.app` matches executable SHA-256
  `5be25955174566805c65b3cb17f78b49ac966d92aa86ff56316d3490724a3416`.
- The canonical installer preserves the installed app root and records two successful icon-bookmark
  launches with `application.frontend_ready`. The original reported file
  `0018-command-and-keybinding-system.md` was reopened in the installed client and its title,
  action gutter, editor panes, and footer were visually verified as aligned in the light theme.
- Accepted archive:
  `.artifacts/diff-header-alignment-20261030.ojkDlc/Asterlyn-0.1.22-diff-header-alignment-macos-arm64.zip`,
  25,224,288 bytes, SHA-256
  `855a84977948e83c92831a5e16bd34bd043e1310d7d5e79c5604b87b20c74db1`.
  Installation evidence and the verified previous-installation ZIP path are recorded in
  `.artifacts/diff-header-alignment-20261030.ojkDlc/install-evidence.json`.
