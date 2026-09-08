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

### U2 — Complete commit inspection

- Load the selected commit's changed-file summary without blocking history navigation.
- Show a file list and read-only patch for the selected commit.
- Add history text/hash filtering and useful empty/error/loading states.
- Reject stale commit-detail responses when selection changes quickly.

### U3 — Scalable working-tree review

- Add change filtering and keyboard list navigation.
- Support multi-selection for stage/unstage while preserving partial-stage truth.
- Add unified/split and whitespace presentation controls without changing Git content.

### U4 — Safe local branch work

- Add checkout and branch creation with dirty-worktree preflight.
- Explain blocked operations and preserve the current repository when switching is unsafe.
- Keep delete, force, reset, and history rewriting outside this slice.

### U5 — Remote daily loop

- Add fetch first, then pull and push with explicit upstream and divergence previews.
- Introduce credential integration without storing secrets in application state or logs.
- Keep force push and provider-specific pull-request workflows deferred.

## Sequencing rule

U1–U3 are the immediate usability queue and may proceed while Windows/macOS interactive release checks remain open. U4 and U5 begin the Stage 2 daily-driver Git workstation. Platform-specific polish becomes blocking again before an artifact is described as a release candidate, not before useful feature development.
