# Stash tool window plan

- **Status:** Implemented; awaiting manual acceptance
- **Date:** 2026-09-28

## Objective

Add a Git-only **Stash** activity-rail entry that opens a persistent bottom tool window. The tool
uses two columns rather than Android Studio's narrow vertical arrangement: the left column lists
bounded Git stash entries, while the right column shows the selected stash's changed-file tree.
Selecting a file opens its bounded, read-only Diff in the permanent editor region.

## Reference and scope

The supplied still image establishes the Stash list, changed-file inspection, and direct Apply/Pop
actions. JetBrains' current Stash documentation supplies the behavioral reference for Apply, Pop,
advanced Unstash, Drop, and Clear. The corrected recording
`/Users/gzq/Movies/20260928_160306.mp4` establishes the exact Android Studio context-menu order:
**Pop**, **Apply**, **Unstash…**, **Drop**, **Clear**, then **Show Diff** and
**Show Diff in a New Tab** after a separator. The earlier recording is superseded and was not used
as implementation evidence.

This slice includes:

- a reorderable Stash rail entry that is available only for an active Git workspace;
- a resizable two-column bottom window with a persisted Stash-list width;
- bounded, multi-root stash discovery ordered by newest entry;
- stable selection by repository and exact stash object rather than volatile reflog position;
- changed-file tree inspection, including files captured by `--include-untracked` stashes;
- a read-only text Diff in the central editor, using the existing Diff preferences and navigation;
- direct **Apply** and **Pop** buttons;
- a context menu with **Pop**, **Apply**, **Unstash…**, **Drop**, per-root **Clear**,
  **Show Diff**, and **Show Diff in a New Tab**, in the recorded order;
- replaceable Diff previews for **Show Diff**, plus persistent, switchable, closable editor tabs for
  **Show Diff in a New Tab**;
- an Unstash dialog supporting Apply/Pop, **Reinstate Index**, and **As new branch**;
- localized English and Simplified Chinese copy, keyboard navigation, loading/error/empty states,
  stale-result rejection, and automatic lifecycle/mutation refresh.

Creating a new stash, IDE Shelf support, partial-file unstash, automatic stashing during another Git
operation, and remote synchronization are outside this slice.

## Behavioral contract

- **Apply** restores the selected stash while retaining it.
- **Pop** restores the selected stash and removes it only when Git completes successfully.
- **Unstash…** can restore staged state with `--index`, or create and check out a new branch from the
  stash base through `git stash branch`.
- **Drop** removes only the reviewed stash. **Clear** affects only the selected Git root and is
  unavailable when the bounded catalog cannot prove it displayed every entry for that root.
- Apply, Pop, and branch creation require a clean working tree. The frontend first resolves dirty
  editor buffers through the existing Save-or-Cancel flow; the Git core then independently repeats
  the full tracked, staged, conflicted, and untracked preflight.
- Every mutation re-resolves the captured reflog selector and requires its current object ID to
  match the reviewed entry. Clear revalidates the complete ordered object set for its root.
- Failed apply/pop may leave Git conflict state. The application performs authoritative repository
  reconciliation after either success or failure and never reports a failed operation as unchanged.

## Architecture

1. Extend the Git domain with serializable Stash catalog/mutation models and bounded read APIs for
   the catalog, selected file list, and selected file Diff.
2. Expose narrow Tauri commands after active-workspace Git authorization. Local mutations run
   through the existing per-repository write coordinator and return typed invalidation slices.
3. Add a feature-owned Stash controller for catalog/details/selection/request generations, a pure
   view for the two-column surface, and feature-owned context actions/dialog state.
4. Reuse the window-scoped context-menu host, shared movable/resizable dialog runtime, workbench
   splitter behavior, compact Git file-tree language, central Diff renderer, localization, and
   authoritative repository integration coordinator.
5. Keep Branches/History state independent. Switching between Branches, Stash, and Terminal must
   preserve the editor document and each feature's selection and scroll state.

## Delivery sequence

1. Add Rust models, exact-identity reads/mutations, multi-root behavior, bounds, and fixture tests.
2. Add protocol schema, generated command map, runtime validation, native/demo adapters, and tests.
3. Add Stash controller/view/context menu/Unstash dialog with focused unit tests.
4. Integrate activity ordering, bottom-tool layout, persisted splitter width, editor Diff routing,
   localization, styles, refresh/reconciliation, and lifecycle cleanup.
5. Run focused and complete frontend/Rust checks, production/native builds, replace the local app,
   and record artifact plus manual-acceptance evidence.

## Implementation and validation record

- The Git domain, Tauri protocol, native and demo adapters, feature controller/runtime/views,
  localization, activity rail, persisted split layout, context menu, and Unstash dialog are
  implemented.
- The selected stash's files now reuse the Git details pane's compact tree/flat-list presentation,
  including view switching and expand/collapse-all controls. The redundant header refresh button
  was removed because opening the tool, workspace reconciliation, and stash mutations already
  refresh the catalog automatically.
- Stash rows use a DOM-safe encoded identity while the controller retains exact object identity;
  this prevents browsers from rewriting the internal NUL separator and restores mouse/keyboard
  context-menu lookup.
- Exact-object fixture coverage includes tracked and `--include-untracked` Diff reads, Apply, Pop,
  branch creation, stale reflog positions, and reviewed Clear sets.
- `npm run check`, the production frontend build, the architecture/style gates, and all 674
  frontend script tests pass.
- All 111 `asterlyn-git` tests pass. The broader Rust workspace also passes its application,
  desktop, and Git suites; its unrelated existing terminal-lifecycle test
  `close_releases_exact_session_and_rejects_stale_input` remains red because the spawned login shell
  exits before the test's liveness assertion on this host.
- The macOS application bundle was built, archived, installed, relaunched, and matched byte-for-byte
  at the executable hash boundary. Acceptance archive:
  `.artifacts/packages/Asterlyn-stash-header-20260928-165720.zip` (8,666,963 bytes,
  SHA-256 `7bed8ee17aba86a4aeaa431df8b90343b4afd64bdb785038887fa6ad657a9a54`).
- Manual product acceptance is pending.

## Acceptance matrix

- Existing stored activity orders gain Stash exactly once without losing the user's relative order.
- Opening Stash never rerenders or resets Branches/History selection; closing it does not close the
  active editor document.
- Catalog/detail/Diff responses are ignored after workspace, root, entry, or file identity changes.
- Renamed, deleted, binary, and stash-included untracked files have honest file-list/Diff states.
- Apply retains the entry; Pop removes it after success; conflict/failure keeps the entry when Git
  does and refreshes working-tree truth.
- Reinstate Index and new-branch flows map to explicit Git arguments without shell interpolation.
- Drop and Clear require destructive confirmation and cannot act on stale or hidden entries.
- Two-column and outer bottom splitters clamp to usable minimums and persist independently.
- English/Chinese strings, context-menu keyboard access, row navigation, focus restoration, and
  disabled/busy reasons have automated coverage.
- Git fixture tests, protocol validation, frontend controller/view/layout tests, TypeScript check,
  complete frontend suite, production build, native package, and installed-app smoke all pass.
