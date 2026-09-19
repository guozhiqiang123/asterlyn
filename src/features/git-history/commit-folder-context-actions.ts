import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { HistoryCopy } from "../../localization/catalog.ts";
import type {
  ContextMenuAvailability,
  ContextMenuItem,
  ContextMenuModel,
  ContextMenuPort,
} from "../../shared/context-menu/context-menu-model.ts";
import {
  buildPathCopyGroup,
  textForCopyAction,
  workspacePathCopyActions,
} from "../../shared/context-menu/context-menu-copy-actions.ts";
import type { DelegatedContextRequest } from "../../shared/context-menu/delegated-context-binding.ts";
import type { CommitDetailDirectoryContextTarget } from "./commit-detail-context-binding.ts";
import {
  commitFolderHistoryIntent,
  type CommitFolderContextPolicy,
} from "./commit-folder-context-policy.ts";

export const COMMIT_FOLDER_CONTEXT_OWNER_ID = "git-history.commit-folder-context-actions";
const OWNER_ID = COMMIT_FOLDER_CONTEXT_OWNER_ID;
const ENABLED = { kind: "enabled" } as const;

export interface CommitFolderContextRuntime {
  current(target: CommitDetailDirectoryContextTarget): boolean;
  policy(target: CommitDetailDirectoryContextTarget): CommitFolderContextPolicy;
  highlight(target: CommitDetailDirectoryContextTarget, highlighted: boolean): void;
  showChanges(target: CommitDetailDirectoryContextTarget): void;
  revealCurrentDirectory(target: CommitDetailDirectoryContextTarget): void;
  installHistoryQuery(intent: HistoryQueryIntent): void;
  blocked(reason: string): void;
  status(message: string): void;
  error(error: unknown): void;
}

export class CommitFolderContextActions {
  private readonly host: ContextMenuPort;
  private readonly clipboard: TextClipboardPort;
  private readonly runtime: CommitFolderContextRuntime;
  private readonly copy: () => HistoryCopy;

  constructor(
    host: ContextMenuPort,
    clipboard: TextClipboardPort,
    runtime: CommitFolderContextRuntime,
    copy: () => HistoryCopy,
  ) {
    this.host = host;
    this.clipboard = clipboard;
    this.runtime = runtime;
    this.copy = copy;
  }

  open(request: DelegatedContextRequest<CommitDetailDirectoryContextTarget>): boolean {
    const { target } = request;
    if (!this.runtime.current(target)) return false;
    const labels = this.copy().commitFolderContextMenu;
    const pathLabels = {
      copy: labels.copyPath,
      fileName: labels.folderName,
      relativePath: labels.relativePath,
      absolutePath: labels.absolutePath,
    };
    const pathActions = workspacePathCopyActions(OWNER_ID, target, pathLabels);
    this.runtime.highlight(target, true);
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model: commitFolderContextMenuModel(target, this.runtime.policy(target), this.copy()),
      isCurrent: () => this.runtime.current(target),
      invoke: async (actionId) => {
        try {
          const text = textForCopyAction(pathActions, actionId);
          if (text !== null) {
            const result = await this.clipboard.writeText(text);
            if (result.status === "failure") {
              this.runtime.error(result.error ?? new Error(labels.clipboardUnavailable));
              return;
            }
            this.runtime.status(copyPathFeedback(actionId, labels));
            return;
          }
          this.invoke(actionId, target);
        } catch (error) {
          this.runtime.error(error);
        }
      },
      blocked: (reason) => this.runtime.blocked(reason),
      dismissed: () => this.runtime.highlight(target, false),
      restoreFocus: request.restoreFocus,
    });
    return true;
  }

  private invoke(actionId: string, target: CommitDetailDirectoryContextTarget): void {
    switch (actionId) {
      case `${OWNER_ID}.show-changes`: return this.runtime.showChanges(target);
      case `${OWNER_ID}.reveal`: return this.runtime.revealCurrentDirectory(target);
      case `${OWNER_ID}.history`:
        return this.runtime.installHistoryQuery(commitFolderHistoryIntent(target));
      default: throw new Error(`Unknown commit folder context action: ${actionId}`);
    }
  }
}

export function commitFolderContextMenuModel(
  target: CommitDetailDirectoryContextTarget,
  policy: CommitFolderContextPolicy,
  copy: HistoryCopy,
): ContextMenuModel {
  const labels = copy.commitFolderContextMenu;
  const command = (
    id: string,
    label: string,
    availability: ContextMenuAvailability,
  ): ContextMenuItem => ({
    kind: "command",
    id: `${OWNER_ID}.${id}`,
    actionId: `${OWNER_ID}.${id}`,
    label,
    availability,
  });
  const pathLabels = {
    copy: labels.copyPath,
    fileName: labels.folderName,
    relativePath: labels.relativePath,
    absolutePath: labels.absolutePath,
  };
  return {
    ariaLabel: labels.ariaLabel(target.path),
    items: [
      command("show-changes", labels.showChanges, ENABLED),
      { kind: "separator" },
      command("reveal", labels.revealInFiles, policy.reveal),
      { kind: "separator" },
      command("history", labels.historyUpToCommit, ENABLED),
      { kind: "separator" },
      buildPathCopyGroup(
        `${OWNER_ID}.copy-path`,
        pathLabels,
        workspacePathCopyActions(OWNER_ID, target, pathLabels),
      ),
    ],
  };
}

function copyPathFeedback(
  actionId: string,
  labels: HistoryCopy["commitFolderContextMenu"],
): string {
  if (actionId.endsWith(".copy-name")) return labels.copiedFolderName;
  if (actionId.endsWith(".copy-relative-path")) return labels.copiedRelativePath;
  return labels.copiedAbsolutePath;
}
