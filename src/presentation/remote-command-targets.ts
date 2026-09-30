import {
  WORKBENCH_FOCUS_SCOPES,
  type CommandFocusScope,
  type CommandId,
} from "../application/commands/command-service.ts";
import {
  REMOTE_COMMANDS,
  type RemoteCommandAction,
} from "../application/commands/remote-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import type { DomCommandDefinition } from "./dom-command-definition.ts";

const CANCEL_SCOPES: readonly CommandFocusScope[] = [...WORKBENCH_FOCUS_SCOPES, "remote"];
const REVIEW_SCOPES: readonly CommandFocusScope[] = ["remote"];

export interface RemoteCommandDefinition {
  readonly id: CommandId;
  readonly action: RemoteCommandAction;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
  readonly presentationSelector?: string;
}

export const REMOTE_COMMAND_DEFINITIONS: readonly RemoteCommandDefinition[] = [
  remote(REMOTE_COMMANDS.openUpdate, "open-update", WORKBENCH_FOCUS_SCOPES, (catalog) => catalog.remote.update, "remote update pull current branch", "#remote-update"),
  remote(REMOTE_COMMANDS.openPush, "open-push", WORKBENCH_FOCUS_SCOPES, (catalog) => catalog.remote.push, "remote push publish review current branch", "#remote-push"),
  remote(REMOTE_COMMANDS.cancelOperation, "cancel-operation", CANCEL_SCOPES, (catalog) => catalog.remote.cancelRemoteOperation, "cancel active remote update push", "#cancel-remote-operation"),
  remote(REMOTE_COMMANDS.manage, "manage", WORKBENCH_FOCUS_SCOPES, (catalog) => catalog.remote.management.title, "manage add edit delete git remotes"),
  remote(REMOTE_COMMANDS.openFileDiff, "open-file-diff", REVIEW_SCOPES, (catalog) => catalog.remote.openOutgoingDiff, "push review selected outgoing file diff", '[data-push-file-action="diff"]'),
  remote(REMOTE_COMMANDS.openCurrentFile, "open-current-file", REVIEW_SCOPES, (catalog) => catalog.editor.openSource, "push review open selected current file", '[data-push-file-action="open"]'),
  remote(REMOTE_COMMANDS.toggleFileView, "toggle-file-view", REVIEW_SCOPES, (catalog) => catalog.remote.showPushedFilesAs(`${catalog.remote.flatList} / ${catalog.remote.folderTree}`), "push review files tree flat view", '[data-push-file-action="view"]'),
  remote(REMOTE_COMMANDS.expandFolders, "expand-folders", REVIEW_SCOPES, (catalog) => catalog.remote.expandPushedFolders, "push review expand all file folders", '[data-push-file-action="expand"]'),
  remote(REMOTE_COMMANDS.collapseFolders, "collapse-folders", REVIEW_SCOPES, (catalog) => catalog.remote.collapsePushedFolders, "push review collapse all file folders", '[data-push-file-action="collapse"]'),
  remote(REMOTE_COMMANDS.loadMore, "load-more", REVIEW_SCOPES, (catalog) => catalog.remote.showMore, "push review load more outgoing commits", "#push-load-more"),
];

export const REMOTE_SHORTCUT_TARGETS: readonly DomCommandDefinition[] =
  REMOTE_COMMAND_DEFINITIONS.flatMap((definition) => definition.presentationSelector
    ? [{
        id: definition.id, category: "workspace" as const,
        selector: definition.presentationSelector, scopes: definition.scopes,
        title: definition.title, detail: definition.detail, keywords: definition.keywords,
        blockedReason: (catalog: LocaleCatalog) => catalog.settings.keybindings.gitRequired,
      }]
    : []);

function remote(
  id: CommandId,
  action: RemoteCommandAction,
  scopes: readonly CommandFocusScope[],
  title: (catalog: LocaleCatalog) => string,
  keywords: string,
  presentationSelector?: string,
): RemoteCommandDefinition {
  return {
    id, action, scopes, title, keywords, presentationSelector,
    detail: (catalog) => catalog.shell.remoteActions,
  };
}
