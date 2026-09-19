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
import type { CommitDetailFileContextTarget } from "./commit-detail-context-binding.ts";
import {
  commitFileHistoryIntent,
  type CommitFileContextPolicy,
} from "./commit-file-context-policy.ts";

export const COMMIT_FILE_CONTEXT_OWNER_ID = "git-history.commit-file-context-actions";
const OWNER_ID = COMMIT_FILE_CONTEXT_OWNER_ID;
const ENABLED = { kind: "enabled" } as const;

export interface CommitFileContextRuntime {
  current(target: CommitDetailFileContextTarget): boolean;
  policy(target: CommitDetailFileContextTarget): CommitFileContextPolicy;
  highlight(target: CommitDetailFileContextTarget, highlighted: boolean): void;
  showDiff(target: CommitDetailFileContextTarget): void;
  openHistorical(target: CommitDetailFileContextTarget): void;
  compareCurrent(target: CommitDetailFileContextTarget): void;
  openCurrent(target: CommitDetailFileContextTarget): void;
  restore(target: CommitDetailFileContextTarget): void;
  installHistoryQuery(intent: HistoryQueryIntent): void;
  blocked(reason: string): void;
  status(message: string): void;
  error(error: unknown): void;
}

export class CommitFileContextActions {
  private readonly host: ContextMenuPort;
  private readonly clipboard: TextClipboardPort;
  private readonly runtime: CommitFileContextRuntime;
  private readonly copy: () => HistoryCopy;

  constructor(
    host: ContextMenuPort,
    clipboard: TextClipboardPort,
    runtime: CommitFileContextRuntime,
    copy: () => HistoryCopy,
  ) {
    this.host = host;
    this.clipboard = clipboard;
    this.runtime = runtime;
    this.copy = copy;
  }

  open(request: DelegatedContextRequest<CommitDetailFileContextTarget>): boolean {
    const { target } = request;
    if (!this.runtime.current(target)) return false;
    const labels = this.copy().commitFileContextMenu;
    const pathLabels = {
      copy: labels.copyPath,
      fileName: labels.fileName,
      relativePath: labels.relativePath,
      absolutePath: labels.absolutePath,
    };
    const pathActions = workspacePathCopyActions(OWNER_ID, target, pathLabels);
    this.runtime.highlight(target, true);
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model: commitFileContextMenuModel(target, this.runtime.policy(target), this.copy()),
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
            this.runtime.status(copyFeedback(actionId, labels));
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

  private invoke(actionId: string, target: CommitDetailFileContextTarget): void {
    switch (actionId) {
      case `${OWNER_ID}.show-diff`: return this.runtime.showDiff(target);
      case `${OWNER_ID}.open-historical`: return this.runtime.openHistorical(target);
      case `${OWNER_ID}.compare-current`: return this.runtime.compareCurrent(target);
      case `${OWNER_ID}.open-current`: return this.runtime.openCurrent(target);
      case `${OWNER_ID}.restore`: return this.runtime.restore(target);
      case `${OWNER_ID}.history`:
        return this.runtime.installHistoryQuery(commitFileHistoryIntent(target));
      default: throw new Error(`Unknown commit file context action: ${actionId}`);
    }
  }
}

export function commitFileContextMenuModel(
  target: CommitDetailFileContextTarget,
  policy: CommitFileContextPolicy,
  copy: HistoryCopy,
): ContextMenuModel {
  const labels = copy.commitFileContextMenu;
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
    fileName: labels.fileName,
    relativePath: labels.relativePath,
    absolutePath: labels.absolutePath,
  };
  return {
    ariaLabel: labels.ariaLabel(target.path),
    items: [
      command("show-diff", labels.showDiff, ENABLED),
      command("open-historical", labels.openHistorical, ENABLED),
      command("compare-current", labels.compareCurrent, policy.currentFile),
      command("open-current", labels.openCurrent, policy.currentFile),
      { kind: "separator" },
      command("restore", labels.restore, policy.restore),
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

function copyFeedback(
  actionId: string,
  labels: HistoryCopy["commitFileContextMenu"],
): string {
  if (actionId.endsWith(".copy-name")) return labels.copiedFileName;
  if (actionId.endsWith(".copy-relative-path")) return labels.copiedRelativePath;
  return labels.copiedAbsolutePath;
}
