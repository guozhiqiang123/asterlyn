# CM4 commit-folder context actions acceptance — 2026-09-19

## Outcome

Commit details now expose one feature-owned H3 context menu for non-root directory rows in Tree
mode. Opening it captures the exact workspace generation, Git root, commit, first-parent/empty-tree
boundary, workspace path, and complete changed-file descendant range without changing directory
disclosure, the selected file, the visible Diff, or the History query.

The four read-only action groups are **Show Changes in This Folder**, **Reveal Current Folder in
Files**, **Folder History up to This Commit**, and a three-value **Copy Path** submenu. The folder
view projects only the captured descendants and reuses ordinary selected-commit Diff reads; file
navigation cannot escape the folder range. Files reveal reauthorizes the current directory and
expands its ancestors. History replaces transient filters with one root-qualified exact commit
start plus a literal directory path and moves keyboard focus to the new results.

## Safety and resource boundaries

- Ordinary commit-detail file lists and exact two-commit ranges share a 20,000-entry and 16 MiB Git
  output boundary. A truncated or over-limit list fails explicitly and is never exposed as a
  complete folder range.
- The target is derived from complete loaded commit details rather than mounted DOM descendants,
  so collapsed directories do not silently omit files.
- Activation re-resolves the target against the current workspace generation, repository root,
  details revision, commit/parent identity, file-view mode, directory path, and descendants. A
  stale menu cannot retarget a same-named directory after refresh or navigation.
- Root containers and Flat mode do not expose H3. Historical paths do not gain write authority;
  Files reveal succeeds only for a currently authorized directory.
- The feature controller retains at most the already bounded descendant identities and one selected
  path. Dismissal, replacement, invalidation, workspace change, or disposal clears the transient
  context target; no timer, polling loop, repository cache, or duplicate file payload is added.

## Automated verification

| Check | Result |
| --- | --- |
| H3 menu/provider/controller focused tests | 3 passed |
| Context binding, feature view and Files reveal focused tests | 22 passed |
| Commit-list partial and file-count limit regression | passed |
| Full frontend/delivery suite | 442 passed |
| Git core suite | 84 passed |
| TypeScript, protocol generation, Clippy and desktop check | passed |
| Production build | passed |
| Production startup JavaScript | 651,787 B raw / 148,178 B gzip |

The startup movement from the H2 comparison checkpoint is 18,020 B raw / 1,768 B gzip. It includes
the exact History-start foundation, folder target/policy/controller, detail projection, application
routing, localization, and tests. The existing startup chunk remains above the 500 kB architecture
target; H3 adds no eager third-party runtime. Lifecycle tests and the bounded immutable range are
the memory evidence for this checkpoint; a packaged long-running heap baseline remains part of the
release-platform matrix rather than being inferred from the Vite browser process.

## Browser interaction and accessibility evidence

In the built-in browser demo:

- Pointer right-click exposed exactly the four H3 groups. Opening the menu retained directory
  disclosure, the selected file, and the existing editor Diff while applying a separate context
  highlight.
- **Show Changes** displayed only `src/diff-editor.ts`; Previous/Next File were both disabled, so
  navigation could not escape to the other commit file.
- **Reveal Current Folder in Files** activated Files, expanded the current catalog path and focused
  `src` without replacing the editor document.
- **Folder History** installed `Up to df53578547` plus `src`, returned five path-limited commits,
  and focused `#history-results`.
- `Shift+F10` opened the same menu. Escape closed it and restored focus to the exact directory
  summary. The Copy Path submenu was keyboard navigable and reported successful workspace-relative
  path copying.
- Right-clicking the repository-root container opened no business menu; Flat mode mounted no
  directory targets. English/Simplified Chinese catalog parity, forced-colors, focus-visible, and
  listener-disposal gates passed in the full suite.

## Known limits

- Folder changes are a projection of paths changed by the selected commit, not a complete historical
  repository browser.
- The first release uses first-parent semantics for merge commits and does not offer a parent
  chooser.
- Directory/worktree comparison, Patch export, historical-directory restoration, and path-level
  Revert/Cherry-pick remain deliberately unsupported.
- Folder History is literal-path history and does not infer directory renames.
- Real renamed-directory, merge/root, nested-repository, packaged memory, and cross-platform native
  interaction matrices remain release-level acceptance work.
