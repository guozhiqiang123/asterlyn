# Context-action system design and implementation plan

- **Status:** CA0, CA1, R5, CM1, CM2, CM3, and CM4 locally accepted

> Further context-action capability expansion is paused while the
> [`foundation hardening plan`](foundation-hardening.md) closes the startup, dependency-direction,
> and feature-state ownership gaps exposed by the completed CM4 sequence. Accepted menu behavior
> remains a compatibility contract during that refactor.
- **Date:** 2026-09-19
- **Behavior input:** [`Context-menu surface drafts`](../design/context-menu-drafts.md)
- **Architecture decision:** [`ADR-0013`](../architecture/decisions/0013-feature-owned-context-actions.md)

## Outcome of the whole-system review

Asterlyn does not need a project-wide architectural rewrite before adding context actions. Its
current dependency direction, feature-owned controllers, window/repository sessions, reviewed Git
operations, recoverable workspace writes, and versioned reconciliation are the correct foundation.
Replacing them would discard proven safety properties without solving the menu problem.

The review did find four gaps that must be addressed before the complete draft can be implemented:

1. There is no reusable window-scoped context-menu presentation host.
2. Some cross-feature actions and branch state are still coordinated directly in the 7,139-line
   `AsterlynApp`; adding menu branches there would reverse the feature-ownership refactor.
3. R5 file creation, directory identity, move/copy, rename, paste collision, and trash capabilities
   do not exist yet.
4. Several Git/history requests in the draft are real new application capabilities—range Diff,
   commit-anchored path History, historical blob documents, arbitrary-ref branch mutations, and
   Revert sequencing—not menu rendering tasks.

The resulting strategy is therefore: build a shared presentation foundation, finish the necessary
application/domain foundations, and then add feature-owned menu providers one surface at a time.

## Draft audit

### What is consistent and retained

- Every action uses a stable workspace/repository/path/ref/object identity rather than a DOM row.
- Right-click never grants authority; reads and writes revalidate at their owning capability.
- Git remains repository truth and no Local History, Changelist, Shelf, or menu-specific state
  database is introduced.
- Mutations that can discard, overwrite, move, or rewrite work require a preview/review and a
  recovery or explicit abort story.
- Ordinary click, context selection, commit inclusion, and History range selection remain distinct.
- Menus remain compact and omit conceptually inapplicable commands. Temporarily blocked commands
  remain explainable.
- Files and Changes share path, History, reveal, trash, and feedback concepts without sharing each
  other's selection state.
- Branch/commit actions reuse the existing reviewed operation and Push/Update workflows rather than
  creating shortcut-only mutations.
- Commit details distinguish the projected changed-file tree from a complete historical repository
  tree and retain first-parent/root-commit semantics.

### Resolved global questions

| Question from the drafts | Decision |
| --- | --- |
| Who owns menu presentation? | One shared `ContextMenuHost` per window, created/disposed with Shell |
| Who owns menu contents and target state? | The target feature's context-action provider and binding |
| Who owns execution? | Existing feature controllers and typed application/domain services |
| Native or WebView menus? | A custom WebView overlay; native reveal/trash remain adapters |
| Is there one global command switch? | No; namespaced opaque IDs return to the provider that created the menu |
| Does right-click always change selection? | No; each surface preserves its reviewed selection contract |
| Does opening a menu run preflight? | No native work; expensive preflight begins only after action activation |
| Internal file clipboard scope? | First version is window- and workspace-session-scoped; it stores identities, not bytes |
| Paste collision policy? | First version offers a new name or cancel; it never silently replaces |
| System file clipboard interoperability? | Deferred; text copy uses the system text clipboard, file transfer remains internal |
| Menu nesting? | One submenu level in the first version |
| Context-menu persistence? | Transient, but unrelated projection refreshes keep it open; semantic target revalidation closes it only when the target changes or disappears |
| Existing dropdown migration? | Not required initially; share lower-level overlay utilities only after parity tests |

### Deliberately uncovered surfaces

The current behavior draft does not define business context actions for Changes groups/directories,
Tags, remote groups, repository-root containers, editor tabs, generic Diff content, terminal
content, or blank areas. The architecture supports future providers for these surfaces, but
implementation must not invent menu items before a product draft exists. The existing ordinary and
Diff Git Blame gutter action is explicitly covered by E1 and is the compatibility pilot for the
shared host.

## Target architecture

```text
stable feature host
  └─ feature binding resolves target and selection behavior
       └─ feature ContextActionProvider builds MenuModel
            └─ window ContextMenuHost renders/focuses/positions
                 └─ provider invokes feature/application action
                      ├─ WorkbenchNavigation port (open/reveal/query/diff)
                      ├─ WorkspaceMutationCoordinator
                      ├─ Repository/GitOperation coordinator
                      └─ Clipboard/Desktop adapter
                           └─ versioned reconciliation -> feature projections
```

### Frontend modules

The intended module layout is:

```text
src/shared/context-menu/
  context-menu-model.ts       closed item model and validation
  context-menu-host.ts        one-window overlay, focus, keyboard, lifecycle
  context-menu-position.ts    pure viewport/submenu geometry
  context-menu.css            shared menu presentation

src/application/
  workbench-navigation.ts     typed cross-feature navigation ports
  workspace-mutation-coordinator.ts

src/features/files-editor/
  editor-gutter-context-actions.ts
  project-files-context-actions.ts
  project-files-binding.ts    stable delegated row/context events

src/features/changes-commit/
  changes-context-actions.ts
  changes-navigation-binding.ts

src/features/git-history/
  branch-context-actions.ts
  history-context-actions.ts
  commit-detail-context-actions.ts

src/adapters/tauri/
  tauri-clipboard-adapter.ts
  tauri-desktop-path-adapter.ts
  tauri-workspace-mutation-bridge.ts
```

Names may be adjusted to existing conventions, but ownership may not move into `app.ts`, Tauri
commands, or one application-wide context-menu catalog.

### Core presentation contract

The following shape is illustrative, not a protocol DTO:

```ts
type MenuAvailability =
  | { kind: "enabled" }
  | { kind: "blocked"; reason: string }
  | { kind: "busy"; label: string };

type ContextMenuItem =
  | { kind: "command"; id: string; actionId: string; label: string;
      availability: MenuAvailability; shortcut?: string; tone?: "normal" | "danger" }
  | { kind: "check" | "radio"; id: string; actionId: string; label: string;
      checked: boolean; availability: MenuAvailability }
  | { kind: "submenu"; id: string; label: string; availability: MenuAvailability;
      children: readonly ContextMenuItem[] }
  | { kind: "separator" };

interface ContextMenuSession<TTarget> {
  readonly ownerId: string;
  readonly target: TTarget;
  readonly model: ContextMenuModel;
  isCurrent(target: TTarget): boolean;
  invoke(actionId: string, target: TTarget): void | Promise<void>;
  blocked(reason: string, target: TTarget): void;
  restoreFocus(target: TTarget): void;
}
```

The host may retain the generic session callback for the lifetime of one open menu because it is
ephemeral presentation state. Serializable feature state and protocol models remain callback-free.
Invocation must still call `isCurrent` and the underlying use case must repeat authoritative
validation.

The window-scoped host also suppresses the WebView's native document context menu, so browser-only
commands such as Reload cannot bypass the product action model. Repository revision counters are
not sufficient reason to invalidate a menu: refresh revalidation compares the captured feature
identity and relevant target fields. A workspace change, History query generation change, removed
ref/path, changed file status, or changed branch object still closes the menu. An unrelated file or
projection refresh keeps the overlay mounted, while every activation repeats semantic validation.
The overlay reads the root `--ui-font-size` token, exposes distinct hover/focus/pressed states, and
prevents navigation-row text selection so macOS WebKit cannot mark a commit message during a
secondary click.

### Selection and focus contract

The shared host has no global rule for selecting the target:

- Files selects the file/folder row without opening or expanding it.
- Changes installs a context/primary row selection without changing commit inclusion or loading a
  Diff.
- A single History commit becomes primary selection and may load details, but performs no file or
  Git action.
- History multi-selection is retained when right-click occurs inside the range and replaced by a
  single selection outside it.
- Branches and commit-detail folders/files use a context highlight without changing their current
  query or Diff until an action says so.

The provider applies this policy before opening and supplies a stable focus-return target. The host
stores the originating element only as a best-effort optimization. If virtualization or
reconciliation removes it, the provider scrolls/reveals the exact identity or focuses the stable
feature container. It never focuses a new row merely because it occupies the same index.

### Availability contract

Providers build menus synchronously from accepted frontend state. They distinguish:

- **not applicable:** omit the item, such as Rename on a remote-tracking branch;
- **temporarily blocked:** show a focusable `aria-disabled="true"` item with a reason, such as a
  branch switch while the worktree is dirty;
- **busy:** show named progress and prevent a second activation;
- **enabled:** accept activation, then start the owning application's validation or reviewed plan.

Blocked items use `aria-disabled` but not the native `disabled` attribute when explanation on
activation is required. The host delegates the explanation to the provider, satisfying the shared
action-feedback standard without inventing a domain reason.

Menu construction never waits for a complete directory scan, topology analysis, remote read, Git
object read, or mutation plan. An enabled action may open a loading review and then end as a no-op,
rejection, or failure when fresh validation differs from cached presentation state.

### Git Blame gutter migration contract

E1 is a presentation migration around an already accepted Git capability. Its feature provider owns
one check action, `editor.git-blame.toggle`, and resolves these targets without asking the shared
host to understand editors or revisions:

- an ordinary saved tracked file maps to the worktree source;
- a working side-by-side Diff maps the old side to exact `HEAD` and the new side to the worktree;
- a commit side-by-side Diff maps the old side to the exact first parent and the new side to the
  exact commit, retaining original/new paths across renames;
- missing added/deleted/root-parent sides, untracked or dirty files, non-Git state, and unified Diff
  remain blocked with the existing localized reason.

The target includes the window/workspace generation, editor document and mount/load identity, Diff
side, repository identity, path, full revision, and parent flag. The CodeMirror gutter/content
adapters contribute only an anchor and target; the Editor provider owns availability,
loading/result state, request generation, invocation, and focus fallback. Right-clicking a line
number or code row does not make the action a per-line command and does not move editor or Diff
selection.

CA0 removes the module-global `activeMenu`, direct body rendering, global listener lifecycle, and
manual `closeGutterMenu()` calls from `editor-gutter.ts`. It retains the bounded incremental Git
read, exact source validation, hunk representation, lazy loading, edit invalidation, and stale-result
guards. Changing those domain behaviors requires a separate capability change and new acceptance
evidence; they are not incidental consequences of adopting the shared host.

## Foundational application capabilities

### Typed workbench navigation

Repeated navigation actions become explicit ports rather than feature-to-feature DOM access:

- `openWorkspaceDocument(identity)`;
- `revealWorkspaceEntry(identity)`;
- `openWorkingDiff(fileChangeIdentity)`;
- `openCommitDiff(commitFileIdentity)`;
- `openRangeDiff(rangeIdentity)`;
- `installHistoryQuery(queryIntent)`;
- `openReviewedGitOperation(intent)`;
- `openUpdateReview()` and `openPushReview()`.

The composition root wires these ports to feature controllers. Providers call a typed method; they
do not dispatch a synthetic click, query another feature's DOM, or mutate another feature's state.

### Text clipboard

A small `TextClipboardPort` accepts only text and returns a typed success/failure result. Copy-path,
copy-ref, and copy-commit helpers format text from the exact target identity, then use this port and
the common feedback lifecycle. Clipboard code has no repository or selection state.

The internal file-operation clipboard is separate. Its first-version state is:

```text
kind: copy | move
workspace identity: canonical root + workspace generation
source: exact file identity or complete directory-plan identity
captured version/fingerprint
```

It is owned by the window's workspace-file operation feature, clears on project replacement, and
becomes stale when its source identity changes. It does not store file bytes, cross windows, cross
projects, or claim interoperability with an operating-system file clipboard.

### Desktop path actions

“Show in file manager” receives an active workspace identity plus a relative entry identity. The
native boundary revalidates the active window, canonical root, non-link path, current entry kind,
and platform behavior before invoking Finder/File Explorer/Linux desktop integration. It is not a
general open-arbitrary-path command.

Trash is not part of this read/navigation adapter. It is a destructive workspace mutation with its
own plan, dirty-buffer guard, exact target validation, platform adapter, outcome, and
reconciliation.

## R5 workspace mutation foundation

Files context actions must not be implemented as ad hoc Tauri filesystem calls. R5 lands before
Files create/cut/copy/paste/rename/trash is enabled.

### R5.1 — Entry identities and bounded plans

Add product-neutral workspace models for:

- file and real-directory identities relative to one canonical authorized root;
- entry kind, supported mode, exact file revision, and directory observation/fingerprint;
- bounded recursive inventory including files, directories, bytes, hidden/ignored entries,
  symlinks, nested Git roots/submodules, hard-link risk, open-document paths, and truncation;
- source/destination plans for create, rename/move, copy, and trash;
- explicit collision policy, with first-version `rename-target | cancel` and no replacement;
- exact path remaps and invalidation slices produced by a successful operation.

Directory plans read the actual authorized filesystem subtree, not the visible projected tree. A
truncated inventory cannot authorize a recursive write. Traversal never follows a symlink and
rejects self/descendant destinations.

### R5.2 — Workspace mutation coordinator and recovery

Add a host application `WorkspaceMutationCoordinator` over `asterlyn-workspace`. It owns one
workspace mutation at a time, the shared workspace write registry, plan tokens, cancellation before
the first write, durable recovery creation, execution, typed outcomes, and recovery listing.

The implementation may generalize proven `replace_file_bytes` and replacement-recovery primitives,
but it must not copy Git index/ref semantics into the workspace crate. Filesystem operations return
workspace outcomes; Git status is recovered by authoritative reconciliation.

Required behavior includes:

- atomic exclusive create for a zero-byte file;
- exact-source rename/move with case-only rename handling;
- bounded copy with temporary destination, verification, and atomic install where supported;
- cross-device move as copy, verify, then remove source, with the source preserved on failure;
- no silent destination overwrite;
- durable progress/recovery for multi-entry operations before the first destructive step;
- typed completed, no-op, cancelled-before-write, failed-without-change, failed-with-recovery, and
  uncertain outcomes;
- honest limits for multi-file atomicity, ACL/xattr preservation, network filesystems, and
  non-cooperating external writers.

### R5.3 — Editor path migration handshake

Moving or renaming a file/folder requires application coordination that a filesystem crate cannot
provide. Before execution, the coordinator obtains an editor migration lease containing all
affected open-document identities and destination collision checks.

- a save in flight or conflicting target tab blocks the operation;
- clean and dirty buffers may be remapped only when the complete path map is known before writing;
- dirty content, CodeMirror state, undo history, selection, and scroll remain attached to the
  remapped identity;
- deleting a path with any dirty descendant is blocked;
- successful deletion closes only clean affected tabs;
- failed or uncertain mutation does not apply a speculative remap;
- workspace/project replacement cancels an unstarted plan and invalidates all leases.

The mutation executes behind the existing window-session reconciliation barrier. After a successful
outcome, path remaps are installed and one exact invalidation commits `workspaceCatalog`, affected
`openDocuments`, and `workingTree`; watcher events remain coalesced hints rather than a competing
state owner.

### R5.4 — Trash adapters

Trash uses a platform adapter selected and tested for macOS, Windows, and supported Linux desktop
environments. Dependency choice is deferred until license, maintenance, integrity, package impact,
and native behavior are recorded. If the system trash is unavailable, Asterlyn fails without
falling back to permanent deletion. The confirmation and result explicitly identify files versus a
fully inventoried directory subtree.

One window-wide `WorkspaceTrashController` owns the single reviewed plan and confirmation lifetime.
Files and Changes contribute typed targets, current-target validation, completion behavior, and
focus restoration; they do not instantiate competing Trash coordinators or duplicate mutation
execution. The shared dialog remains business-neutral and receives localized copy from composition.

## Git and historical capability prerequisites

These foundations belong to Git/application services and can land independently of menu UI:

- arbitrary exact-object branch creation and checkout, local branch rename, safe exact-lease local
  branch deletion, tracked-branch resolution, and linked-worktree protection;
- single/multi Revert in the reviewed Git-operation lifecycle;
- multi-selection topology analysis and ordering;
- exact commit-to-commit changed-file ranges and per-file Diff;
- commit-anchored path History with explicit known rename boundary;
- bounded treeish/path blob and mode reads for read-only historical documents;
- historical blob versus current buffer/disk comparison;
- reviewed historical-file restore through the workspace mutation coordinator.

None of these commands may accept display labels, short hashes, open-ended revision expressions, or
arbitrary absolute paths. All mutating Git operations remain top-level-repository-only until a
separate authority decision expands that scope.

## Surface readiness and ownership

| Surface | Existing reusable capability | Required foundation before complete menu | Provider owner |
| --- | --- | --- | --- |
| Editor/Diff Git Blame gutters (E1) | accepted toggle/load, exact revision mapping, bounded hunks | shared host port into CodeMirror adapter; remove module-global lifecycle | Editor presentation |
| Files file/folder | selection, tree, file read/save, path History | all R5 phases, clipboard, reveal adapter | Files |
| Changes file | inclusion, Diff, conflict, tracked restore | shared host/navigation/clipboard; R5 trash | Changes/Commit |
| Local/remote branch | History, switch, current Update/Push, Merge/Rebase | branch-state extraction and missing exact-ref mutations | Git Branches/History |
| History single commit | selection/details, Cherry-pick | copy port, arbitrary-object branch create, Revert | Git History/Details |
| History multi commit | bounded virtual list, Cherry-pick plan, Squash core | range selection, topology analysis, range Diff, Revert | Git History/Details |
| Commit-detail folder | projected file tree, single file Diff | range Diff and commit-anchored History/navigation | Git History/Details |
| Commit-detail file | existing commit Diff | blob document, current comparison, anchored History, restore | Git History/Details + Editor ports |

Branch context actions must not be added directly to the current `AppState.selectedBranch` and
`AsterlynApp.runBranchMutation` path. First extract branch selection, policy projection, request
identity, and mutation intents into a Git-Branches-owned controller/application facade. Similarly,
Files and Changes row context events should move into feature-owned delegated bindings rather than
adding more per-render listeners in `app.ts`.

## Delivery sequence

### CA0 — Characterization and shared host

Status: **locally accepted on 2026-09-15**. Evidence:
[`CA0 shared context-menu host acceptance`](../benchmarks/2026-09-15-context-action-ca0.md).

1. Freeze E1 characterization for ordinary saved/dirty/untracked files, working Diff `HEAD` and
   worktree sides, commit Diff parent/current sides, added/deleted/renamed/root commits, unified
   layout, bounded results, open/close lifecycle, window disposal, locale/theme refresh, and focus.
2. Add the pure menu model validator, geometry functions, `ContextMenuHost`, styles, and deterministic
   keyboard/pointer tests.
3. Give each native window one host and migrate both the ordinary-editor and Diff Git Blame gutters
   through a narrow CodeMirror port; remove their module-global menu state and direct DOM/listener
   ownership without rewriting the accepted Git Blame service.
4. Add a guard that prohibits module-global active context-menu state and native work during menu
   construction.

Exit: the exact E1 revision/availability behavior remains functional; line-number, code-row, and
annotation-gutter triggers open the same action without changing editor/Diff selection; arrows,
type-ahead, Escape, edge placement, focus return, stale-result rejection, window isolation, and
disposal have accepted tests.

### CA1 — Navigation, clipboard, and feature bindings

Status: **locally accepted on 2026-09-15** as part of the R5/CM1 evidence below. Typed workbench
navigation and text-clipboard ports, stable delegated targets for all drafted surfaces, and
Git-Branches-owned presentation/action state are in place. Product menu providers remain owned by
their features; the composition root only wires ports.

1. Extract typed workbench navigation ports from remaining `app.ts` coordination.
2. Add `TextClipboardPort` and shared pure builders for path/ref/commit copy groups.
3. Give Files, Changes, History list, branch navigation, and commit details stable delegated context
   event bindings with exact target resolution.
4. Extract branch action ownership before contributing any branch menu.

Exit: a feature can open a fully accessible no-domain menu and invoke the same method as an existing
toolbar/ordinary-click entry without synthetic DOM activation or a central action switch.

### R5 — Workspace mutation foundation

Status: **locally accepted on 2026-09-15**. Evidence:
[`R5 and CM1 acceptance`](../benchmarks/2026-09-15-context-action-r5-cm1.md).

Implement R5.1 through R5.4 above with pure Rust unit tests, temporary-filesystem integration tests,
desktop protocol validation, application-coordinator tests, editor path-remap tests, recovery fault
injection, and platform trash/reveal smoke evidence.

Exit: file operations cannot escape the active workspace, silently replace a destination, lose a
dirty buffer, follow a symlink, execute from a truncated directory plan, or report success before
versioned reconciliation accepts the outcome.

### CM1 — Files menu

Status: **locally accepted on 2026-09-15**. Evidence:
[`R5 and CM1 acceptance`](../benchmarks/2026-09-15-context-action-r5-cm1.md).

Ship the first new context-menu surface after the E1 migration in the order requested by the
behavior draft. Start with copy path, Git History, and reveal, then enable
create/rename/copy/move/paste/trash only after their R5 capability passes. File and folder targets
keep the same visible item set with target-specific availability.

### CM2 — Changes menu

Status: **locally accepted on 2026-09-15**. Evidence:
[`CM2 Changes context-menu acceptance`](../benchmarks/2026-09-15-context-action-cm2.md).

Reuse inclusion, working Diff, conflict, tracked restore, and navigation actions. Add untracked trash
only through R5. The context target must not toggle commit inclusion or load a Diff merely by
opening.

### CM3 — Branch and single-commit menus

Status: **locally accepted on 2026-09-15**.
Evidence:
[`CM3 reviewed Git mutation foundation`](../benchmarks/2026-09-15-context-action-cm3-foundation.md).
[`CM3 Branches context-menu acceptance`](../benchmarks/2026-09-15-context-action-cm3-branches.md).
[`CM3 History single-commit acceptance`](../benchmarks/2026-09-15-context-action-cm3-history.md).

Exact-ref branch foundations and reviewed Revert landed before the Branches and H1 providers. Both
surfaces now reuse current Update/Push/Merge/Rebase/Cherry-pick review entry points and keep menu
construction free of native work.

### CM4 — History range and commit-detail menus

Status: **locally accepted on 2026-09-19**. Evidence:
[`CM4 History range-selection acceptance`](../benchmarks/2026-09-15-context-action-cm4-selection.md).
[`CM4 reviewed multi-Revert acceptance`](../benchmarks/2026-09-19-context-action-cm4-multi-revert.md).
[`CM4 History range-action acceptance`](../benchmarks/2026-09-19-context-action-cm4-range-actions.md).
[`CM4 exact comparison foundation`](../benchmarks/2026-09-19-context-action-cm4-comparison-foundation.md).
[`CM4 two-commit comparison acceptance`](../benchmarks/2026-09-19-context-action-cm4-comparison.md).
[`CM4 exact History start foundation`](../benchmarks/2026-09-19-context-action-cm4-history-start.md).
[`CM4 commit-folder context actions`](../benchmarks/2026-09-19-context-action-cm4-commit-folders.md).
[`CM4 exact historical file foundation`](../benchmarks/2026-09-19-context-action-cm4-file-version-foundation.md).
[`CM4 historical file inspection`](../benchmarks/2026-09-19-context-action-cm4-file-inspection.md).
[`CM4 commit-file context actions and reviewed restore`](../benchmarks/2026-09-19-context-action-cm4-file-restore.md).

Range selection/topology, comparison, historical blob documents, commit-anchored History, folder
actions, and reviewed historical restore landed as separately accepted capabilities. H2, H3, and
H4 providers expose only those accepted services; the shared host still owns no History selection,
Git object, workspace path, or recovery state.

### CA2 — Optional adjacent-menu convergence

After all context surfaces have production evidence, assess whether project, History-filter,
editor-tab, remote, and Push-mode dropdowns benefit from the same geometry/focus primitives. Do not
merge their feature state or force a context-action provider model onto persistent toggle menus.

### 2026-09-20 manual-test follow-up

Manual testing found missing pointer feedback, an undefined selection color token, menu and Files
folder text that did not consistently follow the UI scale, macOS secondary-click text selection,
the WebView Reload menu, branch-filter selection loss after repository refresh, and blanket menu
closure during unrelated file updates. The corrective implementation centralizes native-menu
suppression and font/interaction states in the shared host, keeps folder labels two pixels below
the configured menu size (with a 10 px floor), reconciles retained History refs instead of clearing
them on every ref/history result, and revalidates open menus by semantic target identity. Automated
checks cover those contracts. A Linux release build was manually verified for branch selection,
pointer hover, menu survival across a watcher refresh, and native-menu suppression; interactive
macOS and Windows re-verification remains required before this follow-up is marked manually accepted.

## Testing and acceptance matrix

### Pure presentation

- model validation: unique IDs, legal roles, checked states, blocked reasons, separator rules,
  submenu depth, and empty groups;
- positioning at every viewport edge, scaling, long Chinese/English labels, submenu flip, and
  pointer-intent corridor;
- mouse, keyboard, menu key, `Shift+F10`, type-ahead, Home/End, Left/Right, Enter/Space, and nested
  Escape behavior;
- configured UI scaling, visible hover/focus/pressed feedback, native WebView-menu suppression, and
  non-selectable navigation-row labels on secondary click;
- focus return after activation, cancellation, target removal, virtual scroll, and feature disposal;
- one host per window and no cross-window close/invoke leakage.

### Provider behavior

- E1 preserves ordinary saved/dirty/untracked availability, worktree `HEAD`/worktree and commit
  parent/current mapping, rename paths, added/deleted/root sides, independent Diff-side state,
  unified-layout blocking, edit invalidation, and stale-result rejection;
- every draft state matrix produces the expected present/omitted/blocked/checked item set;
- ordinary-click, toolbar, keyboard, and menu entry points call the same feature/application action;
- right-click selection rules match each surface and never perform the primary action;
- repository/query/workspace changes revalidate the captured target without retargeting; unrelated
  repository revisions preserve it, while semantic target changes invalidate it;
- blocked activation shows its current reason without invoking a native capability.

### Capability and integration

- path traversal, symlink swap, case-only rename, same-name collision, hard-link risk, cross-device
  move, permission failure, directory truncation, recovery corruption, and external-writer races;
- clean/dirty/saving open tabs, folder remaps, target-tab collision, failure before/after the first
  write, watcher event overlap, and project replacement;
- stale refs/OIDs, merge/root commits, renamed/copied/deleted paths, nested Git roots, multi-root
  logical branches, range topology gaps, and reviewed-operation restart;
- exact outcome slices and one accepted reconciliation projection without broad history/ref reload
  for workspace-only file mutations.

### Resource and release evidence

- opening a menu makes no native call and becomes visible by the next paint under the accepted
  bounded surface fixtures;
- only one menu and one submenu are mounted, with no retained listeners/timers after 1,000 open/close
  cycles;
- context-action code does not enter lazy Git-operation/editor chunks unnecessarily and keeps the
  main frontend chunk within the existing 500 kB target;
- native reveal, trash, file operations, keyboard accessibility, scaling, and focus are checked on
  Windows, macOS, and Linux;
- every milestone records functionality, latency, memory, accessibility, package movement, and known
  limitations before the next surface is enabled.

## Non-goals for the first implementation

- a public extension or plugin action API;
- arbitrary repository-supplied commands or shell strings;
- native OS business menus;
- more than one submenu level;
- cross-project/window file-operation clipboard;
- system file clipboard import/export;
- silent paste replacement or permanent-delete fallback;
- menu-local Git/filesystem implementations;
- Reset, force-delete, automatic stash, automatic force push, detached checkout, or history editor;
- converting every existing dropdown into a context menu.
