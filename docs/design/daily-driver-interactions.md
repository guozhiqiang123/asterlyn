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

Known limits are explicit: U3 did not yet provide intraline word highlighting, moved-block detection, or source-file line-number gutters; its line numbers described aligned patch rows. U6 supersedes that presentation with hunk-derived source line gutters and conservative intraline highlighting, while moved-block detection and complete-file context remain deferred. Large patches remain bounded at 4 MiB. These limits do not affect Git state and do not block safe local branch work in U4.

### U4 — Safe local branch work

- Add checkout and branch creation with dirty-worktree preflight.
- Explain blocked operations and preserve the current repository when switching is unsafe.
- Keep delete, force, reset, and history rewriting outside this slice.

The initial safety contract is deliberately conservative: U4 switches existing local branches and creates a local branch from the current `HEAD` only when the full working tree is known to be clean. Staged, unstaged, conflicted, and untracked paths all block mutation. The interface explains the blockers first, while the Git core repeats the complete preflight immediately before `git switch`; it accepts only a selected `refs/heads/*` ref or a literal name that passes `git check-ref-format`. Automatic stash, carrying local changes, remote-branch materialization, deletion, force, and history rewriting require separate recovery-aware slices.

**Implemented and locally accepted on 2026-09-08.** The branch inspector now distinguishes the current branch, switchable local branches, remote-only refs, pending or failed untracked discovery, and dirty-worktree blockers before enabling a mutation. The real Tauri window showed all five modified Asterlyn paths and disabled branch creation in the dirty repository. A separate clean clone then created and checked out `feature/u4-native` through the interface, switched back to the existing `main` branch, moved branch selection from the keyboard, and rejected `bad name` without changing `HEAD`. The refreshed snapshot, branch list, status bar, and inspector all followed each successful mutation.

The 15-test Git core suite covers clean checkout and creation, tracked and untracked blockers, invalid and duplicate names, option-shaped local refs, and rejection of remote refs in addition to the earlier status, history, and patch contracts. TypeScript checking, the production frontend build, the desktop Rust check through the local WebKit environment, and strict workspace Clippy passed. Asterlyn does not hold an operating-system lock across preflight and `git switch`; Git remains the final authority if another process changes the repository in that short interval. This slice still provides no automatic stash, dirty-change carry, remote-branch materialization, deletion, force, reset, or history rewriting.

### U5 — Remote daily loop

- Add fetch first, then pull and push with explicit upstream and divergence previews.
- Introduce credential integration without storing secrets in application state or logs.
- Keep force push and provider-specific pull-request workflows deferred.

The initial remote contract is intentionally narrow. Asterlyn accepts a configured remote name but never imports its URL into application state. Fetch updates the standard `refs/heads/*` to `refs/remotes/<remote>/*` mapping without tags, submodules, or pruning. Pull is a cancellable upstream fetch followed by a second branch/upstream/operation/cleanliness check and a fast-forward-only merge to the fetched commit ID. Push uses an explicit non-force refspec to the configured upstream, or publishes a same-named new branch to the selected remote and sets upstream only after success. Mirror remotes, custom fetch namespaces, local-dot upstreams, divergence, force, tag propagation, signing, submodule recursion, and credential prompts are rejected or deferred rather than interpreted silently.

Remote processes receive null stdin, non-interactive credential settings, and no inherited askpass or Git tracing. Configured credential helpers and SSH agents remain trusted system integrations; their secrets are never represented by Asterlyn models. Output is retained only in a small transient buffer for failure classification and is then discarded. Cancellation targets the matching repository operation and performs no rollback: fetch tracking refs or local pull state may already have changed, while a cancelled push has an unknown remote outcome until a later successful fetch.

**Implemented and locally accepted on 2026-09-08.** A compact top-bar Sync popover now exposes the selected remote, exact source and destination refs, last-known ahead/behind state, Fetch, fast-forward Pull, Push or Publish, blocked reasons, credential boundary, and an operation-specific Cancel control from every workspace view. A local bare-remote exercise fetched one new peer commit, changed the visible state to behind by one, fast-forwarded the local branch to the exact remote commit, pushed one ahead commit, and published `feature/native-publish` with `origin/feature/native-publish` configured as upstream. A deliberately blocked remote process showed the cancellable state and its whole process group was gone after cancellation. A failing helper emitted a URL containing synthetic credentials and query data; the interface displayed only the typed unknown-failure guidance and no child output.

The 20-test Git core suite now includes remote metadata, unsupported mappings, dirty-worktree fetch/push, clean fast-forward pull, divergence, ordinary push, first publish, mirror rejection, detached `HEAD`, pre-cancellation, and failure classification. Eleven frontend script tests cover remote selection and Fetch/Pull/Push policy in addition to diff and delivery behavior, while the Tauri registry test checks per-repository serialization and exact cancellation IDs. U5 deliberately has no pruning, transfer-progress meter, interactive credential prompt, force or lease push, tags, submodule recursion, signing, custom fetch namespace, local-dot upstream, merge, or rebase. Cancellation never claims rollback, and a cancelled push remains indeterminate until Fetch succeeds.

### U6 — Persistent IDE workbench

- Replace mutually exclusive whole-page views with a fixed Files, Branches, Changes activity rail.
- Keep one permanent center editor while Files or Changes occupies the left dock and Branches independently occupies the bottom dock.
- Arrange Branches as branch/ref navigation, commit history, and commit/file details in three columns.
- Make the left dock, bottom dock, Branches columns, and side-by-side Diff boundary pointer- and keyboard-resizable with versioned local persistence.
- Route working-tree and commit-file selections into typed editor documents without direct cross-zone DOM calls.
- Present bounded patches as source-like side-by-side rows with real hunk line numbers, omitted-context markers, aligned gaps, and conservative intraline highlighting.

U6 deliberately freezes the long-term layout contract before expanding Git operations. Its Files tree is read-only and includes tracked plus non-ignored untracked paths; file creation, deletion, rename, editing, watching, save/recovery, encodings, and complete-file Diff reads remain Stage 3 capabilities. The activity rail itself is fixed-width because it is a control strip rather than a content pane. Layout references from Android Studio and Rebased remain behavioral studies only; Asterlyn does not reuse their source, assets, icons, fonts, branding, or screenshots.

**Implemented and locally accepted on 2026-09-08.** Compared with the previous three mutually exclusive whole-page modes, the new shell supports both required simultaneous arrangements (`Files + Branches` and `Changes + Branches`) while preserving the active editor document. All five content boundaries are now adjustable, up from zero: left/editor, editor/bottom, branch/log, log/details, and before/after Diff. Pointer dragging, arrow keys, `Home`, `End`, reset, viewport clamping, malformed-persistence fallback, and exclusion of repository/session state from persisted layout were exercised. The bottom Git tool keeps branch refs, commit history, and branch or commit-file details in three columns; selecting a branch changes only its details, while selecting a working-tree or commit file opens the center editor.

The source-like split view removes patch headers and line prefixes, uses real old/new hunk line numbers, aligns additions and deletions with explicit gaps, marks omitted ranges and no-newline records, highlights conservative changed substrings, and reports binary content without pretending it is text. A same-scope refresh check kept the working-tree Diff for `repository.rs` open while unstaging that path's independent index side: the visible changed-file count moved from five to four and the active worktree document was reloaded under a new content revision. A focused regression now proves that equal document identity cannot reuse the loading or previous patch revision key.

Local acceptance passed 20 frontend and delivery tests, 21 Git-core tests, two Tauri tests, strict Clippy, TypeScript checking, and the production frontend build. The release binary remained alive in the automated six-second smoke window. The real Linux release window then completed two `working Diff -> project file -> working Diff` cycles against an isolated repository and exited normally through its window close action. Tauri produced Debian, RPM, and AppImage packages; the final package run produced a 12 MiB binary, 3.4 MiB Debian and RPM packages, and an 87 MiB AppImage.

The comparison conclusion is **improved**: the required concurrent work contexts and every planned content splitter are present, the permanent editor survives unrelated tool changes, and prior U1-U5 Git behavior remains covered. The evidence does not claim lower runtime memory or faster Git operations because U6 changed layout and presentation rather than those performance paths. Remaining limitations are the 5,000 tracked-path UI cap after Git output has already been buffered, patch-derived rather than complete-file Diff content, no moved-code detection, a read-only Files route, and no Windows/macOS interactive verification. The next product action is Stage 3's bounded file-content, editor buffer, save, and recovery contract; future large-repository work should stream or incrementally enumerate project paths before increasing the visible cap.

### U7 — Desktop interaction fidelity

- Present each active activity-rail item as one rounded accent tile, without a second edge marker.
- Treat each Changes row as the complete selection target. Selection uses row background plus the existing `aria-selected` state; checkbox-like decoration and an additional primary stripe are removed while modifier, range, and keyboard selection remain intact.
- Make changed files the first substantive region in commit details and give their list the available height. Author, date, object identity, ancestry, and message remain available afterward in a collapsed semantic disclosure.
- Add a visible Hide action to the Git tool-window header. It closes only the bottom tool through the existing persisted layout transition and does not replace or clear the active editor document.
- Open repositories through the operating system's folder chooser in the desktop runtime. Cancellation leaves the current workspace unchanged, errors stay visible, and the manual absolute-path dialog is retained only as an explicitly labeled browser-demo fallback.
- Maintain one original Asterlyn SVG mark with a measurable transparent safe area, then regenerate the complete Tauri platform icon set rather than hand-adjusting individual outputs.

U7 is a presentation and platform-adapter slice. It changes neither Git mutation semantics nor the typed editor-document boundary established by U6. Native directory access is limited to the user-selected path; the workbench does not receive a general filesystem browser capability. Platform icons remain Asterlyn-owned artwork and do not reuse Android Studio, JetBrains, or operating-system assets.

**Implemented and locally accepted on 2026-09-08.** Browser interaction checks found no activity-item pseudo-element and measured the active tile at the single `#3574f0` accent background. The Changes DOM contains no checkbox decoration; whole-row plain and modifier clicks retained `aria-selected` multi-selection, and focus remains visibly outlined. Commit details place the changed-file region before the collapsed semantic Commit information disclosure in DOM order, and the file list receives the flexible height. Hiding the Git tool removed both its panel and splitter while an open `repository.rs` Diff remained the active editor document; reopening Branches restored the same independent tool region.

A release-build native run used a fresh temporary application-data directory. It presented the Deepin system folder chooser titled `Open Git Repository`; cancelling left the empty workspace intact, and selecting `/home/gzq/asterlyn` then loaded 121 project paths, 53 visible commits, and the current branch through the existing repository-open flow. Browser mode instead showed the explicitly labeled simulation dialog. The desktop capability adds only `dialog:allow-open`; no filesystem plugin is initialized or exposed to the frontend. The original SVG now keeps a 40-unit transparent inset, and the pinned generator replaced the platform matrix. Automated checks cover 32–512 px desktop PNG outputs, Windows 16/24/32/48/64/256 frames, and macOS 128/256/512/1024 Retina resources.

Local acceptance passed 24 frontend, delivery, and icon tests, 21 Git-core tests, two Tauri tests, strict Clippy, TypeScript checking, the production frontend build, and Debian/RPM/AppImage packaging. Outputs were 12,981,720 bytes for the binary, 3,644,278 bytes for Debian, 3,646,538 bytes for RPM, and 91,347,448 bytes for AppImage. Relative to the exact M1.1 evidence, the binary and Debian package are cumulatively 10.69% and 10.58% larger respectively; that comparison spans U2–U7 and cannot attribute the increase to this slice alone.

The resource conclusion is **inconclusive** rather than a memory-improvement claim. Three short-settle runs against the Asterlyn checkout measured process-tree PSS at 213.07, 214.75, and 212.96 MiB (213.07 MiB median), summed RSS at 465.70, 467.37, and 465.67 MiB, and idle CPU at 0.00%, 0.33%, and 0.00%. Every PSS sample remained below the provisional 220 MiB ceiling, but the 15-second settle and different repository are not normalized with the earlier five-run, 60-second Rebased series. The interaction comparison is **improved** because all six requested redundancies or desktop mismatches are removed without changing Git truth or editor continuity. Windows/macOS chooser behavior and installed-icon appearance remain unverified, and Deepin emitted a non-fatal file-dialog heartbeat warning on application shutdown. The next product action remains Stage 3's bounded editor buffer and recovery contract; repeat the normalized memory series when that runtime surface lands.

### U8 — Diff and ref-navigation consistency

- Synchronize both axes of the two split Diff scrollers. The panes retain one shared source position while their vertical ranges remain normalized for unequal document heights.
- Scope the initial history snapshot to the current `HEAD`, then load the selected local branch, remote-tracking branch, or tag through a separate bounded exact-ref query.
- Reject branch-history responses unless their generation, repository root, and selected full ref still match the visible workbench.
- Keep the history filter available during loading and expose explicit loading, empty, failure, and retry states without replacing the selected branch inspector or active editor document.
- Make Local, Remote, and Tags semantic disclosure controls with visible counts, `aria-expanded`, native keyboard activation, and branch-row navigation restricted to expanded groups.

U8 corrects two U6 assumptions after real use. Branch selection now defines the commit-history scope instead of changing only the details column, and split Diff horizontal inspection is linked instead of independent. The Git boundary accepts only complete refs from `refs/heads/`, `refs/remotes/`, or `refs/tags/`, validates that the literal ref still exists, resolves it to a commit, and passes the resulting object ID to `git log` before a path separator. Tags that do not resolve to commits are rejected rather than interpreted as revision expressions. Repository snapshots use the object ID reported by porcelain status so their branch metadata and initial history describe the same observed `HEAD` even if another process moves a ref during refresh.

This slice does not add graph lanes, history pagination beyond the existing 150-commit bound, arbitrary revision expressions, branch mutation for remote refs, or persistence for disclosure state. It also does not claim complete-file Diff context; the existing bounded-patch limitation remains.

## Sequencing rule

U1–U3 are published as the first usability phase, U4 is published as the safe local-branch slice, U5 is locally accepted as the remote daily-loop slice, U6 is locally accepted as the persistent workbench contract, and U7 closes the highest-friction desktop interaction mismatches. U8 is the active consistency correction before Stage 3 editor foundations begin. Windows/macOS interactive release checks remain open; platform-specific polish becomes blocking again before an artifact is described as a release candidate, not before useful feature development.
