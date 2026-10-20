# Submodule working-tree changes plan

- **Status:** SM0–SM5 implemented, fully validated, and installed locally
- **Date:** 2026-10-20
- **Baseline:** `80465ef`
- **Working branch:** `main`
- **Scope:** Treat every initialized Git submodule beneath an opened repository as a first-class
  working-tree root for file decorations, the Changes tool, diff inspection, staging, and commit.

## Objective

Asterlyn already discovers initialized submodules for project files, branch history, and commit
history, but working-tree changes still come only from the primary repository. This produces three
connected failures: edited child-repository files keep their normal file color, the Changes tool is
empty for those files, and the commit workflow cannot choose or commit a child repository.

The first complete delivery must:

1. discover tracked, staged, conflicted, renamed, deleted, and untracked changes in every
   initialized repository root;
2. preserve the owning repository as part of every change's identity so equal relative paths in
   different roots cannot collide;
3. decorate the project tree by workspace-relative path;
4. group the Changes tool by repository root and provide root-level as well as file-level selection;
5. route diff, staging, untracked-file trash, and commit operations to the owning repository; keep
   child-root restore, stash, and conflict-resolution actions disabled until their transactional
   backends become repository-qualified;
6. commit exactly one repository per action, then refresh the complete workspace so a child commit
   exposes the parent repository's updated gitlink as a separate change;
7. reject stale, ambiguous, mixed-root, or no-longer-discovered requests before invoking Git.

This work adopts the useful multi-repository behavior shown by Android Studio without copying its
implementation or visual assets. Asterlyn keeps its existing Changes composer and adds repository
selection there instead of introducing a second commit window.

## User-visible contract

### Project files

- Modified, added, deleted, conflicted, and ignored colors are computed from the full workspace
  path, including the submodule directory.
- Editing or creating a child-repository file updates its decoration through the normal watcher and
  snapshot refresh path; reopening the project is not required.
- A child file can be opened and diffed from either the Files or Changes tool with the same result.

### Changes tool

- Changes are grouped under stable repository headings. The primary repository is shown first;
  initialized child roots follow in workspace-path order.
- Each heading shows its repository name and changed-file count, has an include checkbox, and owns
  a tree whose paths are relative to that repository.
- File selection, exclusion, keyboard navigation, context actions, and diff selection use the pair
  `(repositoryId, path)`, never a bare path.
- A dirty submodule may therefore produce both child-file rows and a primary-repository gitlink
  row. They describe different Git states and remain visibly separate.

### Commit

- The commit composer identifies the repository that will receive the commit.
- A commit may include any subset of staged or unstaged changes from one repository root.
- If included files span multiple roots, Commit is disabled with an actionable instruction to
  select one repository. Asterlyn never performs a partially successful sequence of commits.
- After a child commit succeeds, all repositories are refreshed. The child rows disappear and the
  primary repository's submodule pointer remains available for a separate parent commit.

## Repository-qualified change identity

`FileChange` gains two fields already used by `ProjectFile`:

- `repositoryId`: `.` for the primary root, otherwise the discovered root's stable workspace-
  relative identifier;
- `workspacePath`: the primary-workspace-relative path used for project-tree matching and display
  outside a repository group.

`path` and `originalPath` remain relative to the owning repository because they are the only safe
values to pass to Git. Renderer maps and DOM identities use an encoded qualified key derived from
`repositoryId` and `path`. They do not concatenate display paths and later parse them back into Git
arguments.

The native layer initially parses status inside one root, then scopes every result with its
discovered descriptor. The primary root consequently has `repositoryId == "."` and
`workspacePath == path`; a child `vaLib` change `src/A.kt` has `repositoryId == "vaLib"` and
`workspacePath == "vaLib/src/A.kt"`.

## Snapshot and watcher contract

- Tracked snapshot collection runs bounded status reads for every initialized discovered root and
  merges repository-qualified changes, branches, and commits in deterministic root order.
- Untracked scanning covers every initialized root and reports a single aggregate completeness
  state only after every root finishes. Per-root results are scoped before reconciliation.
- Nested Git repositories that are not discovered initialized submodules remain opaque.
- The workspace watcher continues to observe ordinary files under child roots and also watches the
  effective Git metadata locations required to notice child index, HEAD, and ref changes. A watcher
  hint only schedules refresh; the authoritative multi-root snapshot remains the source of truth.
- A removed or deinitialized child root disappears on the next discovery refresh. Pending UI
  selections for it are invalidated rather than redirected to the primary root.

## Operation safety boundary

Every mutation request carries a repository-qualified target. The Tauri boundary resolves
`repositoryId` only through the current repository's discovered initialized roots; it never accepts
an arbitrary filesystem path from the renderer.

Before a file mutation or commit, the backend:

1. resolves the exact discovered repository root;
2. re-reads its current status;
3. matches each selected `(repositoryId, path, staged/worktree state)` against current evidence;
4. rejects paths owned by another root, stale status, submodule gitlink misuse, or mixed-root input;
5. invokes Git with repository-relative literal pathspecs in only that resolved root;
6. returns or triggers an authoritative full-workspace refresh.

Stage, unstage, untracked-file trash, and commit never silently split a mixed-root selection into a
sequence. The UI may offer one operation per selected root, but each native mutation is atomic only
within the Git repository that owns it. Child-root restore, stash, and conflict-resolution controls
fail closed rather than accidentally executing against the primary repository.

Top-level branch mutation policy continues to consider only primary-root changes. Child-file rows
do not block a primary branch operation twice; the primary gitlink row remains the source of truth
for whether the parent checkout is dirty.

## Architecture changes

### Rust repository layer

- Extend `FileChange` with repository identity and scope status results through `GitRootDescriptor`.
- Aggregate tracked and untracked changes across `discover_git_roots()`.
- Add a reviewed root resolver shared by read and mutation commands.
- Route working-tree diff, image diff, baseline read, stage/unstage, untracked trash, and
  `commit_selected` through the resolved child `GitRepository`.
- Keep `commit_selected`'s stale-status validation and literal path handling inside the target root.
- Add real-submodule fixtures for modified and untracked child files, duplicate relative paths,
  child diff, child commit, and mixed-root rejection.

### Typed desktop boundary

- Regenerate the Rust/TypeScript protocol after adding the two `FileChange` fields.
- Replace bare path arrays used by cross-root-capable calls with typed repository targets or a
  single `repositoryId` plus repository-relative paths.
- Validate qualified identity at runtime and preserve it through demo data and errors.

### Frontend feature layer

- Introduce common `changeKey`, repository-id, and workspace-path helpers; migrate selection,
  exclusion, reconciliation, and change maps to them.
- Match Files rows against `workspacePath` and allow file-editor baseline/staging for discovered
  child roots.
- Render repository groups and root-level include controls in Changes while preserving existing
  staged/unstaged directory trees inside each group.
- Derive the commit target from included changes and disable mixed-root commits before reaching the
  bridge.
- Route diff and context actions with the selected change's repository identity.
- Limit primary branch/worktree safety checks to primary-root changes.

## Delivery phases

### SM0 — Characterize and document

- Save this plan before implementation.
- Add focused failing tests for qualified identity, child project-tree decorations, root grouping,
  commit-target policy, and primary-only branch blockers.

### SM1 — Native multi-root snapshot

- Extend the protocol model and scope tracked status for every initialized root.
- Scan and reconcile untracked files for every root.
- Verify deterministic aggregation and duplicate relative paths with a real submodule fixture.

### SM2 — Qualified Files and Changes presentation

- Migrate frontend maps and selections to qualified keys.
- Decorate by workspace path and render repository groups with root-level inclusion.
- Verify modified/new child files appear without filtering or reopening the project.

### SM3 — Root-routed operations and commit

- Route diff and file mutations to the owning root.
- Enable one-root selected commits and reject mixed-root requests in both frontend and backend.
- Refresh the whole workspace after success and verify the parent gitlink lifecycle.

### SM4 — Acceptance and local installation

- Run focused frontend and Rust tests while iterating.
- Run the complete frontend script suite, type checks, production build, Rust tests, formatting,
  strict Clippy, and patch-hygiene checks.
- Build the macOS app, verify architecture and signature, archive it, replace the local installation
  through a recoverable backup, relaunch it, and run the installed native smoke test.

## Acceptance gates

- An edit and an untracked file inside `superboost_pro`'s initialized child repository appear in
  Files and Changes after refresh with the correct decoration and repository heading.
- Primary and child roots may both contain `src/main/A.kt` without selection, exclusion, diff, or
  decoration collision.
- Child diff reads child `HEAD`/index/worktree content, never similarly named primary-root content.
- Selecting a child repository and committing a subset creates exactly one child commit and does
  not commit the primary gitlink.
- Selecting files from two roots cannot start a commit or any ambiguous destructive mutation.
- After the child commit, the child changes clear and the primary gitlink change remains visible.
- Existing single-root repositories keep their current compact behavior and all prior tests pass.
- Branch mutation blockers continue to reflect only the primary repository's working-tree state.
- The installed `/Applications/Asterlyn.app` passes the native smoke test with the accepted build.

## Implementation result

SM0 through SM3 are complete for the three requested behaviors. Tracked and untracked child-root
changes now carry repository-qualified identities, Files decorations use workspace-relative paths,
Changes renders repository headings with root/group/directory/file inclusion controls, and diff,
stage, unstage, untracked trash, and one-root commits resolve the owning discovered repository. A
real-submodule integration fixture verifies duplicate relative paths, child diffs, mixed-root commit
rejection, child-only commit, and the remaining primary gitlink change.

The frontend script suite passed 1,245 tests. Type checking, production frontend build, the complete
Rust workspace tests, strict Clippy, Rust formatting, and patch hygiene passed. The accepted arm64
macOS `0.1.13` bundle has an ad-hoc hardened-runtime signature and passed strict deep verification.
The archive is `target/release/bundle/macos/Asterlyn-0.1.13-submodule-working-tree-20261020.app.zip`
(14,776,298 bytes, SHA-256
`249fad8041825c5c74543eb4a53ed62bfecd9d36db7bde93fc41903526afec76`). The installed executable
matches the accepted bundle with SHA-256
`934113b7cf59c9623eec40a13ea10513530084ba9eb85fd80e578bdbd60ebf8a`; the previous installation is
recoverable at `/Applications/Asterlyn-before-submodule-working-tree-20261020.app`.

The process-liveness native smoke passed for both the accepted build and installed executable. The
rendered-window accessibility probe could not be accepted in this host session because both the
unchanged previous installation and the new bundle remained alive while macOS reported
`WINDOW_MISSING`; this comparison rules out the submodule patch as the cause but does not claim a
rendered-probe pass. The installed application was relaunched against
`/Users/gzq/AndroidStudioProjects/superboost_pro` for user-visible acceptance.

Child-root transactional restore, stash, and conflict editing remain explicit guarded follow-ups.
They are not silently redirected to the primary repository and do not block Files decoration,
Changes discovery/grouping, child diff, staging, or per-repository commit acceptance.

## SM5 follow-up — hierarchy and repository-scoped Push

The first installed implementation exposed two remaining gaps during acceptance. Repository groups
were present in Changes, but their inner status groups had the same horizontal origin and therefore
did not read as children. Push also continued to derive remotes, previews, authentication, file
details, and execution from the primary repository even when outgoing commits belonged to an
initialized child root.

This follow-up closes both gaps with these boundaries:

- Changes renders an explicit `repository -> status group -> directory/file` hierarchy. Status
  groups receive one repository-level indent and descendants retain their existing tree depth.
- Remote summaries and push previews carry `repositoryId`; child remotes are scoped during the
  authoritative multi-root snapshot instead of being collapsed by a shared remote name such as
  `origin`.
- Push presents every initialized root as a selectable target, automatically preferring a root with
  outgoing commits. Source branch, destination, outgoing commits, changed files, file diff,
  authentication, credential configuration, and final push all use that same selected identity.
- One Push action targets exactly one repository. Asterlyn does not silently combine independent
  repositories into a partially successful operation.
- Native commands resolve the renderer's `repositoryId` only against discovered initialized roots;
  arbitrary filesystem paths remain outside the operation boundary.
- The main toolbar and remote-management editor remain primary-root controls. This avoids showing
  duplicate `origin` entries without repository context while the Push dialog owns multi-root
  publication.

Acceptance requires a fixture where the primary root has no outgoing commits and a child root has
one. Opening Push must select the child root, render its branch and outgoing commit, request its
preview and authentication, and execute only against that child. Existing single-root behavior and
all primary-root remote controls must remain unchanged.

SM5 passed the complete 1,246-test frontend suite, type checking, production build, the complete
Rust workspace tests, strict Clippy, formatting, and patch-hygiene checks. The real-submodule Rust
fixture verifies child-remote discovery and a repository-scoped outgoing preview; the frontend
fixture verifies automatic child-root selection plus repository-qualified preview and execution.

The accepted arm64 macOS `0.1.13` archive is
`target/release/bundle/macos/Asterlyn-0.1.13-submodule-push-roots-20261020.app.zip` (14,788,601
bytes, SHA-256 `3a3254686fc0942ab0a37df6c1cb33b67abb21836978a2cb688e5d88d1cae322`). Its ad-hoc
hardened-runtime signature passed strict deep verification, and both the bundle and installed app
passed the rendered-window smoke test. The installed executable matches the accepted bundle with
SHA-256 `a976672ffafb9f0cbfab3af802e274ed692a33d63adf9a37decd6d1cdbf96695`; the immediately
previous installation is recoverable at
`/Applications/Asterlyn-before-submodule-push-roots-20261020.app`.
