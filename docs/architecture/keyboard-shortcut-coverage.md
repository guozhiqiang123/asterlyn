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
| Open Settings | navigation | `workbench.settings.open` | **Default:** Primary+, |
| Return from Settings | navigation | `workbench.settings.close` | **Custom**; Escape remains **Local** |
| Dismiss visible error toast | presentation | `workbench.notification.dismiss` | **Gap** |
| Reorder activity tools | presentation | activity-rail drag and Alt+Arrow local behavior | **Local** |
| Choose current/new window when opening a project | window | repository-target dialog | **Local** dialog choice |
| Minimize, maximize/restore, close window | window | native/custom window controls | **Excluded:** operating-system lifecycle shortcuts own these actions |

## 2. Tool windows

| User action | Family | Command | State / default |
| --- | --- | --- | --- |
| Show/hide Files | presentation | `workbench.tool.files.toggle` | **Custom** |
| Show/hide Search results | presentation | `workbench.tool.search.toggle` | **Custom** |
| Show/hide Changes | presentation | `workbench.tool.changes.toggle` | **Custom** |
| Show/hide Branches and Log | presentation | `workbench.tool.branches.toggle` | **Custom** |
| Show/hide Stash | presentation | `workbench.tool.stash.toggle` | **Custom** |
| Show/hide Terminal | presentation | `workbench.tool.terminal.toggle` | **Custom** |
| Hide the active left tool | presentation | `workbench.tool.left.hide` | **Custom** |
| Hide the active bottom tool | presentation | `workbench.tool.bottom.hide` | **Custom** |
| Resize tool panes | presentation | keyboard-operable splitters | **Local** |

Default number/chord bindings for tool windows are intentionally omitted: these presentation
commands are registered and discoverable, while users choose combinations that fit their workflow
without Asterlyn claiming common editor or terminal keys.

## 3. Files

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Locate the active editor file | navigation | `files.active.locate` | **Custom** |
| Expand selected folder recursively | presentation | `files.folder.expand` | **Custom** |
| Collapse selected folder recursively | presentation | `files.folder.collapse` | **Custom** |
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
| Preview workspace replacement | write | `search.replace.preview` | **Custom** |
| Apply reviewed replacement | write | `search.replace.apply` | **Custom**, preserves review/recovery and remains dialog-scoped |
| Open/close Find results tool | presentation | `workbench.tool.search.toggle` | **Custom** |
| Locate current file in Find results | navigation | `search.results.locateCurrent` | **Custom** |
| Toggle tree/flat results | presentation | `search.results.view.toggle` | **Custom** |
| Expand/collapse selected result folder | presentation | `search.results.expand`, `search.results.collapse` | **Custom** |

## 5. Editor, Markdown, and Diff

| User action | Family | Command / local route | State / default |
| --- | --- | --- | --- |
| Find/replace in active editor or Diff | editing | `editor.find.open` | **Default:** Primary+F in editor/Diff scopes |
| Save active editable file | write | `editor.file.save` | **Default:** Primary+S |
| Close active tab/preview | navigation | `editor.tab.close` | **Custom**; dirty confirmation remains intact |
| Activate previous/next tab | navigation | `editor.tab.previous`, `.next` | **Gap** |
| Open the tab list | navigation | `editor.tabList.toggle` | **Custom** |
| Select a tab or close a named tab | navigation | tab/list component interaction | **Local** dynamic target |
| Markdown Source / Split / Preview | presentation | `editor.markdown.source`, `editor.markdown.split`, `editor.markdown.preview` | **Custom** |
| Previous/next changed hunk | navigation | `diff.change.previous`, `diff.change.next` | **Custom** |
| Previous/next file in current Diff set | navigation | `diff.file.previous`, `diff.file.next` | **Custom** |
| Open current Diff source file | navigation | `diff.source.open` | **Custom** |
| Expand/collapse unchanged Diff context | presentation | `diff.unchanged.toggle` | **Custom** |
| Unified / side-by-side Diff | presentation | `diff.layout.unified`, `diff.layout.split` | **Custom** |
| Show/hide whitespace | presentation | `diff.whitespace.toggle` | **Custom** |
| Fold, select, edit, undo/redo, copy/paste | editing | CodeMirror behavior | **Local** until explicitly promoted as product commands |
| Resize Markdown split | presentation | splitter keyboard contract | **Local** |

## 6. Changes, commit, and working-tree recovery

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Refresh Changes | read | `changes.refresh` | **Custom**; routes through canonical project refresh |
| Include/exclude selected path in commit | write selection | `changes.selection.include.toggle` | **Custom** |
| Open selected working Diff | navigation | `changes.selection.diff.open` | **Custom** |
| Jump to selected source file | navigation | `changes.selection.source.open` | **Custom** |
| Restore selected tracked change to `HEAD` | destructive | `changes.selection.restore` | **Custom**, unassigned and confirmed/recoverable |
| Move selected untracked path to Trash | destructive | `changes.selection.trash` | **Custom**, unassigned and confirmed |
| Resolve selected conflict | write | `changes.selection.conflict.resolve` | **Custom** |
| Show selected path history | navigation | `changes.selection.history` | **Custom** |
| Toggle tree/flat view | presentation | `changes.view.toggle` | **Custom** |
| Expand/collapse all Changes folders | presentation | `changes.folders.expandAll`, `changes.folders.collapseAll` | **Custom** |
| Stage all Unversioned / Trash all Unversioned | write/destructive | `changes.unversioned.stageAll`, `changes.unversioned.trashAll` | **Custom**; Trash remains unassigned and confirmed |
| Commit included files | write | `changes.commit.create` | **Custom**; Primary+Enter remains **Local** while the commit message is focused |
| Stash included changes | write | `changes.stash.create` | **Custom** |
| Select row, disclose group/directory, edit commit message | navigation/editing | list/tree/input behavior | **Local** |

## 7. Branches, tags, History, and commit details

| User action | Family | Command / target command | State |
| --- | --- | --- | --- |
| Focus History filter | navigation | `history.find.focus` | **Default:** Primary+F in History scope |
| Toggle History regex / match case | presentation | `history.filter.regex.toggle`, `history.filter.case.toggle` | **Custom** |
| Open branch/user/date/path/graph filters | navigation | `history.filter.branch.open`, `history.filter.user.open`, `history.filter.date.open`, `history.filter.path.open`, `history.filter.graph.open` | **Custom** |
| Clear one/all active History filters | presentation | `history.filter.clearCurrent`, `.clearAll` | **Gap** |
| Select commits and ranges | navigation | History list keyboard/pointer contract | **Local** |
| Open selected commit/range comparison | navigation | `history.selection.compare` | **Custom**; exact current two-commit range is revalidated |
| Load more history | read | `history.loadMore` | **Custom** |
| Toggle commit-file tree/flat, expand/collapse | presentation | `history.files.view.toggle`, `history.files.expandAll`, `history.files.collapseAll` | **Custom** |
| Swap the before/after sides of a commit comparison | presentation | `history.comparison.swap` | **Custom** |
| Open selected historical file Diff | navigation | `history.file.diff.open` | **Custom** |
| Open historical file, compare current, open current | navigation | `history.file.openHistorical`, `history.file.compareCurrent`, `history.file.openCurrent` | **Custom** |
| Restore file from selected commit | destructive | `history.file.restore` | **Custom**, unassigned and confirmed |
| Show selected file history up to the commit | navigation | `history.file.history` | **Custom** |
| Show folder changes / reveal in Files / path history | navigation | `history.folder.changes`, `history.folder.reveal`, `history.folder.history` | **Custom**; folder commands use the focused directory |
| Show branch/tag history | navigation | `git.ref.history` | **Custom**; exact current ref is revalidated |
| Switch/checkout/create/rename branch | write | `git.branch.switch`, `git.branch.checkoutRemote`, `git.branch.create`, `git.branch.rename` | **Custom** |
| Merge/rebase selected ref | write | `git.branch.merge`, `git.branch.rebase` | **Custom**, reviewed Git-operation route only |
| Delete local branch | destructive | `git.branch.delete` | **Custom**, unassigned and confirmed |
| Checkout/merge/delete local tag | write/destructive | `git.tag.checkout`, `git.tag.merge`, `git.tag.deleteLocal` | **Custom**, destructive action unassigned and confirmed |
| Push/delete tag on selected remote | network write/destructive | `git.tag.push`, `git.tag.deleteRemote` | **Custom**, exact selected remote is revalidated; destructive action unassigned and confirmed |
| Copy ref names and paths | read | selection-specific copy commands | **Gap** |

Dynamic branch, tag, commit, and file identities never enter persisted keybindings as arguments. A
selection command resolves and revalidates the current exact target when invoked.

## 8. Stash

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Refresh stash catalog/details | read | `stash.refresh` | **Custom** |
| Toggle stash-file tree/flat view | presentation | `stash.files.view.toggle` | **Custom** |
| Expand/collapse stash folders | presentation | `stash.files.expandAll`, `stash.files.collapseAll` | **Custom** |
| Open selected stash-file Diff | navigation | `stash.file.diff.open` | **Custom** |
| Apply selected stash | write | `stash.selection.apply` | **Custom**; exact current stash is revalidated |
| Pop selected stash | destructive | `stash.selection.pop` | **Custom**, deliberately unassigned |
| Select stash/file or disclose folder | navigation | list/tree behavior | **Local** |

## 9. Remote update and Push

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Update current branch | network write | `remote.update.open` | **Custom**, opens existing review/strategy flow |
| Review Push | network write | `remote.push.open` | **Custom**, opens existing Push review |
| Cancel active remote operation | network write | `remote.operation.cancel` | **Custom**, unassigned |
| Manage remotes | write | `remote.manage.open` | **Custom** |
| Confirm Update or Push | network write | dialog confirmation | **Local**; never a global shortcut |
| Choose remote, branch, force-with-lease mode, tags | editing | form/select controls | **Local** |
| Select outgoing commit/file; load more | navigation/read | list controls | **Local** dynamic targets |
| Open outgoing Diff/current file | navigation | `remote.push.file.diff`, `remote.push.file.openCurrent` | **Custom** |
| Toggle Push file tree; expand/collapse | presentation | `remote.push.files.view.toggle`, `remote.push.files.expandAll`, `remote.push.files.collapseAll` | **Custom** |
| Load more outgoing commits | read | `remote.push.loadMore` | **Custom** |
| Navigate/present outgoing Diff | navigation/presentation | shared `diff.*` commands when Push Diff is active | **Gap** |
| Save/recheck authentication | credential | authentication dialog | **Local**; focus and secret-handling boundary owns Enter/Escape |

## 10. Reviewed Git operations and conflict resolution

| User action | Family | Target command | State |
| --- | --- | --- | --- |
| Open Git operations launcher | navigation | `git.operation.open` | **Gap** |
| Review recoverable operations | navigation | `git.operation.recovery.open` | **Gap** |
| Prepare Merge/Cherry-pick/Rebase/Squash | write | launcher/form controls | **Local** until a complete exact plan exists |
| Execute, Continue, Skip, Abort | destructive/write | reviewed operation dialog/banner | **Local**; no global default and no bypass of confirmation |
| Open selected conflict resolution | write | `changes.selection.conflict.resolve` | **Custom** |
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
| Open/close Settings | navigation | `workbench.settings.open`, `.close` | **Default** Primary+, to open; close is **Custom** |
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
