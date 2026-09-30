import type {
  CommandFocusScope,
  CommandId,
} from "../application/commands/command-service.ts";
import { CHANGES_COMMANDS } from "../application/commands/changes-command-ids.ts";
import type { ChangesContextCommandAction } from "../features/changes-commit/changes-context-actions.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import type { DomCommandDefinition } from "./dom-command-definition.ts";

const CHANGES_SCOPES: readonly CommandFocusScope[] = [
  "changes",
];

export interface ChangesContextCommandDefinition {
  readonly id: CommandId;
  readonly action: ChangesContextCommandAction;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
  readonly presentationSelector?: string;
}

export const CHANGES_DOM_COMMANDS: readonly DomCommandDefinition[] = [
  changesDom(CHANGES_COMMANDS.refresh, '[data-change-action="refresh"]', (copy) => copy.refreshChanges, "refresh reload changes git status"),
  changesDom(CHANGES_COMMANDS.toggleView, '[data-change-action="view"]', (copy) => copy.showAs(`${copy.flatList} / ${copy.directoryTree}`), "changes tree flat view"),
  changesDom(CHANGES_COMMANDS.expandAll, '[data-change-action="expand"]', (copy) => copy.expandAll, "changes expand all folders"),
  changesDom(CHANGES_COMMANDS.collapseAll, '[data-change-action="collapse"]', (copy) => copy.collapseAll, "changes collapse all folders"),
  changesDom(CHANGES_COMMANDS.commit, "#commit-button", (copy) => copy.commitButton, "git commit included selected files"),
  changesDom(CHANGES_COMMANDS.stash, "#stash-changes-button", (copy) => copy.stashButton, "git stash included selected changes"),
];

export const CHANGES_CONTEXT_COMMANDS: readonly ChangesContextCommandDefinition[] = [
  changesContext(CHANGES_COMMANDS.toggleIncluded, "include", (copy) => copy.contextMenu.includeInCommit, "include exclude selected change commit stash", '[data-change-path].primary [data-include-path]'),
  changesContext(CHANGES_COMMANDS.openDiff, "diff", (copy) => copy.contextMenu.showDiff, "open selected working diff", '[data-change-action="diff"]'),
  changesContext(CHANGES_COMMANDS.openSource, "source", (copy) => copy.contextMenu.jumpToSource, "open selected change source file"),
  changesContext(CHANGES_COMMANDS.restore, "restore", (copy) => copy.contextMenu.restoreChanges, "restore discard selected tracked change head", '[data-change-action="revert"]'),
  changesContext(CHANGES_COMMANDS.trash, "trash", (copy) => copy.contextMenu.trash, "trash delete selected untracked file"),
  changesContext(CHANGES_COMMANDS.resolveConflict, "resolve", (copy) => copy.contextMenu.resolveConflict, "resolve selected merge conflict", '[data-change-path].primary [data-resolve-conflict]'),
  changesContext(CHANGES_COMMANDS.showHistory, "history", (copy) => copy.contextMenu.gitHistory, "selected path git history log"),
  changesContext(CHANGES_COMMANDS.copyName, "copy-name", (copy) => copy.contextMenu.fileName, "copy selected change file name"),
  changesContext(CHANGES_COMMANDS.copyRelativePath, "copy-relative-path", (copy) => copy.contextMenu.relativePath, "copy selected change relative path"),
  changesContext(CHANGES_COMMANDS.copyAbsolutePath, "copy-absolute-path", (copy) => copy.contextMenu.absolutePath, "copy selected change absolute path"),
  changesContext(CHANGES_COMMANDS.stageAllUnversioned, "stage-all", (copy) => copy.contextMenu.stageAllUnversioned, "stage add all unversioned files"),
  changesContext(CHANGES_COMMANDS.trashAllUnversioned, "trash-all", (copy) => copy.contextMenu.trashAllUnversioned, "trash delete all unversioned files"),
];

export const CHANGES_SHORTCUT_TARGETS: readonly DomCommandDefinition[] = [
  ...CHANGES_DOM_COMMANDS,
  ...CHANGES_CONTEXT_COMMANDS.flatMap((definition) => definition.presentationSelector
    ? [{
        id: definition.id,
        category: "workspace" as const,
        selector: definition.presentationSelector,
        scopes: definition.scopes,
        title: definition.title,
        detail: definition.detail,
        keywords: definition.keywords,
        blockedReason: (catalog: LocaleCatalog) => catalog.settings.keybindings.gitRequired,
      }]
    : []),
];

function changesDom(
  id: CommandId,
  selector: string,
  title: (copy: LocaleCatalog["changes"]) => string,
  keywords: string,
): DomCommandDefinition {
  return {
    id, selector, keywords, category: "workspace", scopes: CHANGES_SCOPES,
    title: (catalog) => title(catalog.changes),
    detail: (catalog) => catalog.changes.commitFileActions,
    blockedReason: (catalog) => catalog.settings.keybindings.gitRequired,
  };
}

function changesContext(
  id: CommandId,
  action: ChangesContextCommandAction,
  title: (copy: LocaleCatalog["changes"]) => string,
  keywords: string,
  presentationSelector?: string,
): ChangesContextCommandDefinition {
  return {
    id, action, keywords, presentationSelector, scopes: CHANGES_SCOPES,
    title: (catalog) => title(catalog.changes),
    detail: (catalog) => catalog.changes.changedFiles,
  };
}
