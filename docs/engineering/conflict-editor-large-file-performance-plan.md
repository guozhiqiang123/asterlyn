# Large conflict editor performance plan

- **Status:** Implemented; awaiting human interaction acceptance
- **Scope:** Text conflict loading, three-pane conflict projection, and Changes context-menu responsiveness
- **Reference fixture:** `dev/integration_tests/android_semantics_testing/android/project-integration_test.lockfile`

## Problem

Opening a large text conflict keeps the editor on “Reading base, ours, theirs, and worktree
content…” for several seconds. During the final part of that wait the Changes file list is painted,
but its context menu does not appear until the conflict editor finishes mounting.

The native conflict-content command already runs outside the browser main thread. Direct Git reads
of the four source documents are bounded and fast for the reference fixture. The long UI stall starts
after those documents arrive: conflict decisions, marker projection, unchanged-range folding, and the
two MergeViews repeatedly calculate character-level differences on the browser main thread. The
loading presentation remains visible until that synchronous work returns, so an otherwise
synchronous context-menu event is queued behind it.

## Design

1. Keep Git and the repository snapshot as the only data sources. No conflict cache or parallel
   repository state is introduced.
2. Split comparison precision by responsibility:
   - conflict ownership, Base mappings, marker projection, and unchanged folding use stable
     whole-line change blocks;
   - MergeView keeps the existing refined character/word ranges for visible inline highlighting.
3. Calculate Base-to-Ours, Base-to-Result, and Base-to-Theirs structural changes once per mount and
   share those immutable results between the resolution model, marker projection, and collapse
   coordinator.
4. Calculate the two refined source-to-Result visual Diffs in a dedicated module Worker. MergeView
   consumes those prepared ranges for its initial documents, and semantic highlighting reuses
   MergeView's chunks instead of calculating a second refined Diff. Later Result edits continue to
   use the exact foreground fallback required by the live editor.
   Worker messages carry only structured-clone-safe range data. The main-thread boundary must
   restore every range as CodeMirror's `Change` value before MergeView receives it; otherwise
   insertion/deletion alignment can call a prototype method that was stripped by structured clone.
5. The Changes context menu continues to open synchronously from the current repository snapshot.
   It must not await conflict content, Git, the filesystem, or editor construction. Removing the
   main-thread duplicate work makes it independently responsive while a conflict request is active.
6. Preserve exact marker-backed conflict authority, per-side Apply/Ignore decisions, Result edits,
   Undo/Redo state, and the existing refined visual Diff.

## Delivery steps

1. Add a whole-line structural Diff primitive alongside the refined line-aware Diff.
2. Add one reusable conflict-analysis value and allow marker/collapse projection to consume it.
3. Remove duplicate comparison passes from shared collapse calculation.
4. Move refined initial visual comparison to a Worker and reuse its prepared ranges.
5. Add regression coverage for structural mapping, shared analysis, context-menu non-blocking
   ownership, and the reference large-file budget.
6. Record measured latency, focused/full validation, packaging, and installed-app verification in the
   unified Diff acceptance document.

## Acceptance gates

- The reference file produces the same actionable conflict semantics as before.
- Conflict analysis and fold-range preparation finish within 250 ms on the local reference machine,
  excluding MergeView painting.
- Opening a Changes row context menu has no asynchronous dependency on conflict loading or editor
  mounting.
- Existing conflict resolution, marker authority, collapse, navigation, localization, and Git Blame
  tests pass.
- A worker-returned insertion/deletion fixture remains mountable after structured cloning, and any
  unexpected preparation or editor-construction failure replaces the loading surface with a visible
  recoverable error instead of leaving an empty conflict pane.
- `npm run check`, `npm run build`, script tests, `cargo test -p asterlyn-git`, package creation, and
  installed native smoke verification pass.

## Acceptance evidence

- The reference conflict contains 56,579-byte Base, 72,803-byte Ours, 97,660-byte Theirs, and
  146,202-byte worktree documents. Direct Git object reads completed below the shell timer's 10 ms
  resolution; repository I/O was not the stall.
- Before the change, conflict-model construction took about 1,531 ms and collapse preparation about
  1,424 ms on the reference workflow. After single-pass structural analysis, initial Result,
  analysis, 33-block model construction, and folds together took 15.7 ms cold and 2.9–3.5 ms warm.
- The two refined visual comparisons formerly occupied the UI thread for about 381–415 ms and were
  repeated by semantic highlighting. They now run once in the 34.46 kB production Worker asset;
  the UI thread receives their immutable ranges before constructing MergeView.
- The Worker response is rehydrated into CodeMirror `Change` instances on the main thread. This
  covers files whose presentable insertion/deletion alignment invokes `Change.offset()`, including
  `dev/integration_tests/flutter_gallery/android/project-video_player_android.lockfile`.
- A generated 900-line regression fixture prepares structural and refined ranges in 8–22 ms under
  the 250 ms test budget. A structured-clone regression also proves that a worker-returned line
  insertion is restored to a real CodeMirror `Change` and remains presentable. The complete
  frontend suite passes 928 tests, native Git passes 133 tests, TypeScript checking, production
  build, packaging, signature validation, and native rendered smoke all pass.

## Known boundary

CodeMirror still constructs live editor DOM and decorations on the browser main thread after the
Worker finishes. This ownership is intentional: it is short, uses already prepared change ranges,
and keeps later interactive Result edits inside CodeMirror's supported update lifecycle.
