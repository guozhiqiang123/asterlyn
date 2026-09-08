# Daily-driver interaction backlog

## Purpose

Asterlyn should become useful through complete developer workflows before spending its main capacity on release-platform polish. Cross-platform compilation and process-liveness checks remain regression gates, but interactive parity on every operating system does not block the next product slice.

The interaction study uses locally installed Android Studio and the documented Rebased study only as behavioral references. Asterlyn does not copy source, assets, icons, fonts, or branded composition from either product.

## 2026-09-08 usability audit

The current Git workbench already supports repository open, tracked-first status, patch inspection, stage/unstage, commit, recent history, and branch presentation. The highest-value gaps observed in the running application are:

1. **Duplicated window chrome:** the native title bar sits above Asterlyn's 44 px top bar, wasting roughly one toolbar row and visually separating window controls from application navigation.
2. **Incomplete commit exploration:** selecting history exposes metadata but not the commit's changed files or patches, forcing the user back to another Git tool for ordinary investigation.
3. **Low-density change interaction:** change groups lack filtering, multi-selection, and explicit diff presentation controls for larger working trees.
4. **Read-only branches:** branch data is visible, but checkout and safe branch creation are absent.
5. **No remote round trip:** fetch, pull, push, and actionable upstream state remain outside the product.
6. **Shallow keyboard flow:** primary controls are reachable, but there is no coherent action search, list navigation model, or shortcut discovery surface.

Android Studio demonstrates useful interaction patterns: one compact top-level bar, persistent tool-window navigation, action-dense but contextual commit controls, searchable history, a branch tree beside the commit graph, and details revealed without replacing the working context. These are workflow observations, not a visual template.

## Ordered delivery slices

### U1 — Compact desktop shell

- Remove redundant native title bars on desktop targets.
- Keep a single draggable 44 px application bar with minimize, maximize/restore, and close controls.
- Preserve keyboard focus, visible hover/pressed states, window resizing, and browser-demo behavior.

**Implemented and locally accepted on 2026-09-08.** The Linux release window removed the native title row while retaining the same 1,320 × 820 content window, recovering approximately 40 px of outer vertical space. Automated pointer checks exercised minimize/restore, maximize/restore, drag, and close against the real Tauri window. The controls expose focus-visible styling and accessible names; browser demo mode omits them. Frontend checks/build, delivery-script tests, the 10-test Rust workspace, Clippy, release compilation, and Debian bundling passed. Windows/macOS appearance and control interaction remain unverified until the next CI and platform review; this does not block U2.

### U2 — Complete commit inspection

- Load the selected commit's changed-file summary without blocking history navigation.
- Show a file list and read-only patch for the selected commit.
- Add history text/hash filtering and useful empty/error/loading states.
- Reject stale commit-detail responses when selection changes quickly.

**Implemented and locally accepted on 2026-09-08.** Commit selection now lazily loads a NUL-delimited changed-file list and then only the selected file patch. Root commits compare with the empty tree; ordinary and merge commits compare with their first parent. The history filter matches message, author, email, decoration, short hash, and full hash. `Ctrl/Cmd+F`, `Escape`, `Enter`, arrow keys, `Home`, and `End` cover filter and list navigation while CodeMirror retains its own patch search. Commit/file request generations, repository root, object ID, and selected path must all still match before a response is presented; loading, empty, truncation, command-failure, and retry states remain visible.

Local acceptance used the real Tauri window against the Asterlyn repository: commit changes loaded into the two-pane file/patch view, filtering reduced and emptied the history list correctly, and keyboard navigation changed both commits and files while preserving the current patch. The 13-test Git core suite covers root, ordinary, rename, deletion, addition, merge-first-parent, invalid object ID/path, and delimiter-safe paths. TypeScript checking, the production frontend build, the desktop Rust check through the local WebKit environment, and Git core tests passed. Current limits remain the 150-commit snapshot window, 4 MiB per-file patch cap, first-parent-only merge inspection, and lossy display of non-UTF-8 paths. These are explicit follow-up constraints rather than blockers for U3.

### U3 — Scalable working-tree review

- Add change filtering and keyboard list navigation.
- Support multi-selection for stage/unstage while preserving partial-stage truth.
- Add unified/split and whitespace presentation controls without changing Git content.

Selection is scope-specific: the staged and working-tree rows for a partially staged path are distinct selectable items. Plain click or keyboard traversal establishes the primary patch, `Ctrl/Cmd` toggles items, and `Shift` selects a visible range. Batch stage acts only on selected working-tree rows; batch unstage acts only on selected index rows. A filter narrows visible rows and group actions but does not silently discard hidden selections, so the toolbar always reports the full selected count. After a mutation, selections migrate to the corresponding side only when that side exists in the fresh Git snapshot.

**Implemented and locally accepted on 2026-09-08.** Changed files can be filtered by path, original path, status, scope, or conflict state; `Ctrl/Cmd+F`, `Escape`, `Enter`, arrow keys, `Home`, `End`, `Space`, `Ctrl/Cmd`, and `Shift` support search and scoped selection. A two-file selection was staged and then unstaged through the real Tauri window, and the fresh snapshots moved both selected rows between working-tree and index scope without touching unrelated paths. Hidden selections remained counted while filtering.

Working-tree and commit patches now share `Unified`, `Split`, and `Whitespace` controls. Split mode derives aligned before/after documents from the canonical patch, keeps replacement blocks and no-newline markers side-specific, disables wrapping to preserve row alignment, and synchronizes vertical scrolling while allowing independent horizontal inspection. Whitespace mode adds visible spaces, tabs, and trailing-space emphasis without re-running Git. Four focused projection tests cover replacements, addition/deletion-only blocks, no-newline markers, and hunk content that resembles file headers. The production frontend build, TypeScript check, seven delivery/presentation script tests, 13 Git core tests, desktop Rust check, and strict workspace Clippy passed.

Known limits are explicit: split view does not yet provide intraline word highlighting, moved-block detection, or source-file line-number gutters; its line numbers describe aligned patch rows. Split projection is limited to the standard single-file unified patches emitted by Asterlyn's current backend. Large patches remain bounded at 4 MiB. These limits do not affect Git state and do not block safe local branch work in U4.

### U4 — Safe local branch work

- Add checkout and branch creation with dirty-worktree preflight.
- Explain blocked operations and preserve the current repository when switching is unsafe.
- Keep delete, force, reset, and history rewriting outside this slice.

The initial safety contract is deliberately conservative: U4 switches existing local branches and creates a local branch from the current `HEAD` only when the full working tree is known to be clean. Staged, unstaged, conflicted, and untracked paths all block mutation. The interface explains the blockers first, while the Git core repeats the complete preflight immediately before `git switch`; it accepts only a selected `refs/heads/*` ref or a literal name that passes `git check-ref-format`. Automatic stash, carrying local changes, remote-branch materialization, deletion, force, and history rewriting require separate recovery-aware slices.

### U5 — Remote daily loop

- Add fetch first, then pull and push with explicit upstream and divergence previews.
- Introduce credential integration without storing secrets in application state or logs.
- Keep force push and provider-specific pull-request workflows deferred.

## Sequencing rule

U1–U3 are locally accepted as the first usability phase while Windows/macOS interactive release checks remain open. U4 and U5 are the next Stage 2 daily-driver Git workstation phase. Platform-specific polish becomes blocking again before an artifact is described as a release candidate, not before useful feature development.
