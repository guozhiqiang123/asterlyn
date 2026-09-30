# Keyboard shortcut coverage

- **Status:** Active architecture contract
- **Owner:** Product surface owner for each section; command/keybinding infrastructure owns the
  shared registry, dispatch, persistence, Settings presentation, and validation gates.
- **Last full UI inventory:** 2026-09-30

## Purpose

This page is the durable inventory for user-visible actions and their keyboard policy. A feature is
not complete when only its button works: its owner must decide whether the action is an application
command, a component-local keyboard interaction, or intentionally excluded from shortcut routing.
That decision and any stable command ID belong here in the same change.

The inventory is organized primarily by **product surface**. This matches UI ownership, manual
acceptance, and code review: a Files change updates Files, a Changes change updates Changes, and a
History change updates History. The secondary **action family** column supports cross-surface review
for navigation, editing, presentation, read, write, destructive, and window actions without making
one feature appear in several chapters.

## Required classification

Every new user-visible action must receive exactly one classification:

- **Command** — a stable, repeatable product action. It must have a stable command ID, localized
  title/detail/keywords, current availability, declared focus scopes, command-palette discovery, and
  a customizable entry in Keyboard Shortcuts. A shipped default is recommended but not mandatory.
- **Local** — widget semantics whose meaning depends on the focused component, such as list arrows,
  tree disclosure, text editing, menu traversal, dialog Enter/Escape, or splitter movement. The
  component owns and tests these keys; they are not user-remappable application commands.
- **Excluded** — operating-system-owned behavior or an action for which shortcut invocation cannot
  preserve current authorization, confirmation, identity, or recovery guarantees. The reason must
  be documented. “No time to add a command” is not an exclusion reason.

Commands that write, discard, publish, or delete data are still eligible for customization, but
their command route must enter the same preview/confirmation/revalidation/recovery flow as the
button. Such commands normally ship **unassigned** so users opt in deliberately.

## Coverage notation

| State | Meaning |
| --- | --- |
| **Default** | Registered, customizable, and ships with the listed platform-neutral default. |
| **Custom** | Registered and customizable, but deliberately ships unassigned. |
| **Local** | Component keyboard contract; not listed as an application command. |
| **Gap** | Visible product action that must still be promoted to a registered command. |
| **Excluded** | Intentionally outside shortcut routing for the documented reason. |

`Primary` means Command on macOS and Control on Windows/Linux. A command with no default must still
appear in Settings and the command palette while unavailable commands remain visible with a precise
blocked reason.

## 1. Workbench and project

| User action | Family | Command / local route | State / default |
| --- | --- | --- | --- |
| Open command palette | navigation | `workbench.commandPalette.open` | **Default:** Primary+Shift+P |
| Open project | navigation | `workspace.repository.open` | **Default:** Primary+O |
| Open project menu / recent projects | navigation | `workspace.repository.menu.toggle` | **Gap** |
| Go to file | navigation | `workspace.quickOpen.open` | **Default:** Primary+P |
| Open recent files | navigation | `workspace.recentFiles.open` | **Default:** Primary+E |
| Find in files / reviewed replace | navigation | `workspace.search.open` | **Default:** Primary+Shift+F |
| Refresh project and local Git state | read | `workbench.refresh` | **Default:** Primary+R |
| Open Settings | navigation | `workbench.settings.open` | **Gap**, target default Primary+, |
| Return from Settings | navigation | `workbench.settings.close` | **Gap**; Escape remains **Local** |
| Dismiss visible error toast | presentation | `workbench.notification.dismiss` | **Gap** |
| Reorder activity tools | presentation | activity-rail drag and Alt+Arrow local behavior | **Local** |
| Choose current/new window when opening a project | window | repository-target dialog | **Local** dialog choice |
| Minimize, maximize/restore, close window | window | native/custom window controls | **Excluded:** operating-system lifecycle shortcuts own these actions |

## 2. Tool windows

| User action | Family | Command | State / default |
| --- | --- | --- | --- |
| Show/hide Files | presentation | `workbench.tool.files.toggle` | **Custom** |
| Show/hide Search results | presentation | `workbench.tool.search.toggle` | **Gap** |
| Show/hide Changes | presentation | `workbench.tool.changes.toggle` | **Custom** |
| Show/hide Branches and Log | presentation | `workbench.tool.branches.toggle` | **Custom** |
| Show/hide Stash | presentation | `workbench.tool.stash.toggle` | **Gap** |
| Show/hide Terminal | presentation | `workbench.tool.terminal.toggle` | **Custom** |
| Hide the active left tool | presentation | `workbench.tool.left.hide` | **Gap** |
| Hide the active bottom tool | presentation | `workbench.tool.bottom.hide` | **Gap** |
| Resize tool panes | presentation | keyboard-operable splitters | **Local** |

Default number/chord bindings for tool windows are intentionally deferred until the complete set is
registered, so one release does not claim combinations that the next release must immediately
reassign. Users may already assign the four registered commands.

## 3. Files

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Locate the active editor file | navigation | `files.active.locate` | **Gap** |
| Expand selected folder recursively | presentation | `files.folder.expand` | **Gap** |
| Collapse selected folder recursively | presentation | `files.folder.collapse` | **Gap** |
| Open selected file | navigation | `files.selection.open` | **Gap**; Enter/double-click remains **Local** |
| Create file at selected target | write | `files.file.create` | **Gap** |
| Rename selected item | write | `files.selection.rename` | **Gap** |
| Cut, copy, paste selected item | write | `files.selection.cut`, `.copy`, `.paste` | **Gap** |
| Reveal selected item in the OS file manager | navigation | `files.selection.reveal` | **Gap** |
| Copy name, relative path, absolute path | read | `files.selection.copyName`, `.copyRelativePath`, `.copyAbsolutePath` | **Gap** |
| Show Git history for selected path | navigation | `files.selection.history` | **Gap** |
| Move selected item(s) to system Trash | destructive | `files.selection.trash` | **Gap**, must remain unassigned and confirmed |
| Review recoverable file operations | navigation | `files.recovery.open` | **Gap** |
| Retry a failed catalog read | read | `files.refresh` | **Gap**; may share the project refresh service when identities match |
| Select rows, extend selection, disclose one directory | navigation | tree keyboard/mouse contract | **Local** |

## 4. Search and replacement

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Open Files / Recent / Text / Commands mode | navigation | existing workspace navigation commands | **Default** where listed in section 1 |
| Switch command-surface mode | navigation | tab buttons and Primary+1…4 while surface is open | **Local** |
| Move through and activate results | navigation | Arrow keys, Enter, pointer selection | **Local** |
| Toggle case, whole-word, regex, ignored-files options | presentation | focused search-field controls | **Local**; typing context owns these options |
| Insert a query line break | editing | focused query control | **Local** |
| Preview workspace replacement | write | `search.replace.preview` | **Gap** |
| Apply reviewed replacement | write | `search.replace.apply` | **Gap**, must preserve review/recovery |
| Open/close Find results tool | presentation | `workbench.tool.search.toggle` | **Gap** |
| Locate current file in Find results | navigation | `search.results.locateCurrent` | **Gap** |
| Toggle tree/flat results | presentation | `search.results.view.toggle` | **Gap** |
| Expand/collapse selected result folder | presentation | `search.results.expand`, `.collapse` | **Gap** |

## 5. Editor, Markdown, and Diff

| User action | Family | Command / local route | State / default |
| --- | --- | --- | --- |
| Find/replace in active editor or Diff | editing | `editor.find.open` | **Default:** Primary+F in editor/Diff scopes |
| Save active editable file | write | `editor.file.save` | **Default:** Primary+S |
| Close active tab/preview | navigation | `editor.tab.close` | **Gap**; dirty confirmation must remain intact |
| Activate previous/next tab | navigation | `editor.tab.previous`, `.next` | **Gap** |
| Open the tab list | navigation | `editor.tabList.toggle` | **Gap** |
| Select a tab or close a named tab | navigation | tab/list component interaction | **Local** dynamic target |
| Markdown Source / Split / Preview | presentation | `editor.markdown.source`, `.split`, `.preview` | **Gap** |
| Previous/next changed hunk | navigation | `diff.change.previous`, `.next` | **Gap** |
| Previous/next file in current Diff set | navigation | `diff.file.previous`, `.next` | **Gap** |
| Open current Diff source file | navigation | `diff.source.open` | **Gap** |
| Expand/collapse unchanged Diff context | presentation | `diff.unchanged.toggle` | **Gap** |
| Unified / side-by-side Diff | presentation | `diff.layout.unified`, `.split` | **Gap** |
| Show/hide whitespace | presentation | `diff.whitespace.toggle` | **Gap** |
| Fold, select, edit, undo/redo, copy/paste | editing | CodeMirror behavior | **Local** until explicitly promoted as product commands |
| Resize Markdown split | presentation | splitter keyboard contract | **Local** |

## 6. Changes, commit, and working-tree recovery

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Refresh Changes | read | `changes.refresh` | **Gap**; routes through canonical project refresh |
| Include/exclude selected path in commit | write selection | `changes.selection.include.toggle` | **Gap** |
| Open selected working Diff | navigation | `changes.selection.diff.open` | **Gap** |
| Jump to selected source file | navigation | `changes.selection.source.open` | **Gap** |
| Restore selected tracked change to `HEAD` | destructive | `changes.selection.restore` | **Gap**, unassigned and confirmed/recoverable |
| Move selected untracked path to Trash | destructive | `changes.selection.trash` | **Gap**, unassigned and confirmed |
| Resolve selected conflict | write | `changes.selection.conflict.resolve` | **Gap** |
| Show selected path history | navigation | `changes.selection.history` | **Gap** |
| Toggle tree/flat view | presentation | `changes.view.toggle` | **Gap** |
| Expand/collapse all Changes folders | presentation | `changes.folders.expandAll`, `.collapseAll` | **Gap** |
| Stage all Unversioned / Trash all Unversioned | write/destructive | `changes.unversioned.stageAll`, `.trashAll` | **Gap**; Trash remains unassigned and confirmed |
| Commit included files | write | `changes.commit.create` | **Gap**, target default Primary+Enter while commit message is focused |
| Stash included changes | write | `changes.stash.create` | **Gap** |
| Select row, disclose group/directory, edit commit message | navigation/editing | list/tree/input behavior | **Local** |

## 7. Branches, tags, History, and commit details

| User action | Family | Command / target command | State |
| --- | --- | --- | --- |
| Focus History filter | navigation | `history.find.focus` | **Default:** Primary+F in History scope |
| Toggle History regex / match case | presentation | `history.filter.regex.toggle`, `.case.toggle` | **Gap** |
| Open branch/user/date/path/graph filters | navigation | `history.filter.branch.open`, `.user.open`, `.date.open`, `.path.open`, `.graph.open` | **Gap** |
| Clear one/all active History filters | presentation | `history.filter.clearCurrent`, `.clearAll` | **Gap** |
| Select commits and ranges | navigation | History list keyboard/pointer contract | **Local** |
| Open selected commit/range comparison | navigation | `history.selection.compare` | **Gap** |
| Load more history | read | `history.loadMore` | **Gap** |
| Toggle commit-file tree/flat, expand/collapse | presentation | `history.files.view.toggle`, `.expandAll`, `.collapseAll` | **Gap** |
| Open historical file, compare current, open current | navigation | `history.file.openHistorical`, `.compareCurrent`, `.openCurrent` | **Gap** |
| Restore file from selected commit | destructive | `history.file.restore` | **Gap**, unassigned and confirmed |
| Show folder changes / reveal in Files / path history | navigation | `history.folder.changes`, `.reveal`, `.history` | **Gap** |
| Show branch/tag history | navigation | `git.ref.history` | **Gap** |
| Switch/checkout/create/rename branch | write | `git.branch.switch`, `.checkoutRemote`, `.create`, `.rename` | **Gap** |
| Merge/rebase selected ref | write | `git.branch.merge`, `.rebase` | **Gap**, reviewed Git-operation route only |
| Delete local branch | destructive | `git.branch.delete` | **Gap**, unassigned and confirmed |
| Checkout/merge/push/delete tag | write/destructive | `git.tag.checkout`, `.merge`, `.push`, `.deleteLocal`, `.deleteRemote` | **Gap**, mutations unassigned and confirmed |
| Copy ref names and paths | read | selection-specific copy commands | **Gap** |

Dynamic branch, tag, commit, and file identities never enter persisted keybindings as arguments. A
selection command resolves and revalidates the current exact target when invoked.

## 8. Stash

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Refresh stash catalog/details | read | `stash.refresh` | **Gap** |
| Toggle stash-file tree/flat view | presentation | `stash.files.view.toggle` | **Gap** |
| Expand/collapse stash folders | presentation | `stash.files.expandAll`, `.collapseAll` | **Gap** |
| Open selected stash-file Diff | navigation | `stash.file.diff.open` | **Gap** |
| Apply selected stash | write | `stash.selection.apply` | **Gap**, reviewed operation route |
| Pop selected stash | destructive | `stash.selection.pop` | **Gap**, unassigned and confirmed |
| Select stash/file or disclose folder | navigation | list/tree behavior | **Local** |

## 9. Remote update and Push

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Update current branch | network write | `remote.update.open` | **Gap**, opens existing review/strategy flow |
| Review Push | network write | `remote.push.open` | **Gap**, opens existing Push review |
| Cancel active remote operation | network write | `remote.operation.cancel` | **Gap**, unassigned |
| Manage remotes | write | `remote.manage.open` | **Gap** |
| Confirm Update or Push | network write | dialog confirmation | **Local**; never a global shortcut |
| Choose remote, branch, force-with-lease mode, tags | editing | form/select controls | **Local** |
| Select outgoing commit/file; load more | navigation/read | list controls | **Local** dynamic targets |
| Open outgoing Diff/current file | navigation | `remote.push.file.diff`, `.openCurrent` | **Gap** |
| Toggle Push file tree; expand/collapse | presentation | `remote.push.files.view.toggle`, `.expandAll`, `.collapseAll` | **Gap** |
| Navigate/present outgoing Diff | navigation/presentation | shared `diff.*` commands when Push Diff is active | **Gap** |
| Save/recheck authentication | credential | authentication dialog | **Local**; focus and secret-handling boundary owns Enter/Escape |

## 10. Reviewed Git operations and conflict resolution

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Open Git operations launcher | navigation | `git.operation.open` | **Gap** |
| Review recoverable operations | navigation | `git.operation.recovery.open` | **Gap** |
| Prepare Merge/Cherry-pick/Rebase/Squash | write | launcher/form controls | **Local** until a complete exact plan exists |
| Execute, Continue, Skip, Abort | destructive/write | reviewed operation dialog/banner | **Local**; no global default and no bypass of confirmation |
| Open selected conflict resolution | write | `changes.selection.conflict.resolve` | **Gap** |
| Select Base/Ours/Theirs, save resolution | editing/write | conflict editor controls | **Local** until promoted through a stable active-conflict adapter |

## 11. Terminal

| User action | Family | Command / route | State |
| --- | --- | --- | --- |
| Show/hide Terminal | presentation | `workbench.tool.terminal.toggle` | **Custom**, explicit terminal interception only when assigned |
| Open command palette from Terminal | navigation | `workbench.commandPalette.open` | **Default:** Primary+Shift+P, explicitly intercepted |
| Clear terminal display | presentation | `terminal.clear` | **Gap** |
| Restart/close the supervised session | process | `terminal.session.restart`, `.close` | **Gap**, must preserve session lifecycle |
| Send text, Control+C/Z/D, shell completion/history | terminal input | xterm/PTY contract | **Local**, always pass through unless an explicit terminal command wins |

## 12. Settings and Keyboard Shortcuts

| User action | Family | Command / route | State |
| --- | --- | --- | --- |
| Open/close Settings | navigation | `workbench.settings.open`, `.close` | **Gap** |
| Select a Settings section | navigation | Settings navigation buttons | **Local** |
| Change locale/theme/font/editor/Diff preferences | preference | form controls | **Local**; each value is directly discoverable and focused |
| Search/filter/category-filter shortcuts | editing | Keyboard Shortcuts controls | **Local** |
| Add/edit/remove/reset command binding | preference | keybinding row controls/recorder | **Local**; recorder owns captured keys |
| Reset all shortcuts | destructive preference | guarded Settings confirmation | **Local** |

Settings and dialogs are excluded from ordinary command dispatch while they own focus except for
commands explicitly scoped to `settings` or `dialog`. This prevents a newly assigned workbench key
from activating hidden content behind a modal.

## Maintenance workflow

Every feature change that adds, removes, renames, or materially changes a user action must complete
all applicable items:

1. Update the owning section of this inventory, including action family and classification.
2. For a **Command**, add or retain a stable ID, localized metadata, focus scopes, live availability,
   one execution route, and an explicit default-binding decision.
3. Route buttons, menus, the command palette, and shortcuts through the same feature-owned behavior;
   a shortcut must not reimplement or bypass business policy.
4. Add dynamic `aria-keyshortcuts`/shortcut presentation to persistent controls when a binding is
   effective; never leave a hard-coded label after customization.
5. Test keyboard dispatch, blocked availability, dangerous-action confirmation, focus-scope
   isolation, and disposal. Add installed interaction evidence for platform-specific keys.
6. For **Local** or **Excluded**, record the owner/reason and test the component interaction when it
   is non-native.
7. Update this page and the command coverage test in the same commit. A feature is incomplete if its
   visible button ships without this decision.

The automated coverage gate ensures every registered command remains listed here and every shipped
binding points to a registered command. Code review remains responsible for detecting a new button
that has not yet been classified; presentation tests should add focused assertions for durable
toolbar actions as those surfaces migrate.

## Expansion order

Shortcut coverage should close gaps in this order:

1. persistent global and toolbar actions (Settings, missing tool windows, Files/Changes/Editor/Diff);
2. current-selection commands that already have exact feature policy and confirmation routes;
3. History/Stash/Remote presentation commands;
4. context-menu mutations after their current-target adapters can reuse the exact action provider;
5. terminal and conflict-editor actions with explicit lifecycle adapters.

This order maximizes useful coverage without turning dynamic target identities into stored shortcut
arguments or weakening destructive-action safety.
