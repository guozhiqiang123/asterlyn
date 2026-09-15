import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { ProjectFilesCopy } from "../../localization/catalog.ts";
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
import type { ProjectFilesContextTarget } from "./project-files-binding.ts";

const OWNER_ID = "project-files.context-actions";
const ENABLED = { kind: "enabled" } as const;

export interface ProjectFilesContextPolicy {
  readonly mutation: ContextMenuAvailability;
  readonly paste: ContextMenuAvailability;
  readonly history: ContextMenuAvailability;
}

export interface ProjectFilesContextRuntime {
  current(target: ProjectFilesContextTarget): boolean;
  select(target: ProjectFilesContextTarget): boolean;
  policy(target: ProjectFilesContextTarget): ProjectFilesContextPolicy;
  createFile(target: ProjectFilesContextTarget): void | Promise<void>;
  cut(target: ProjectFilesContextTarget): void | Promise<void>;
  copy(target: ProjectFilesContextTarget): void | Promise<void>;
  paste(target: ProjectFilesContextTarget): void | Promise<void>;
  reveal(target: ProjectFilesContextTarget): void | Promise<void>;
  rename(target: ProjectFilesContextTarget): void | Promise<void>;
  historyIntent(target: ProjectFilesContextTarget): HistoryQueryIntent | null;
  installHistoryQuery(intent: HistoryQueryIntent): void;
  trash(target: ProjectFilesContextTarget): void | Promise<void>;
  blocked(reason: string): void;
  status(message: string): void;
  error(error: unknown): void;
}

/** Files owns target policy and action routing; the shared host owns presentation only. */
export class ProjectFilesContextActions {
  private readonly host: ContextMenuPort;
  private readonly clipboard: TextClipboardPort;
  private readonly runtime: ProjectFilesContextRuntime;
  private readonly copy: () => ProjectFilesCopy;

  constructor(
    host: ContextMenuPort,
    clipboard: TextClipboardPort,
    runtime: ProjectFilesContextRuntime,
    copy: () => ProjectFilesCopy,
  ) {
    this.host = host;
    this.clipboard = clipboard;
    this.runtime = runtime;
    this.copy = copy;
  }

  open(request: DelegatedContextRequest<ProjectFilesContextTarget>): boolean {
    const { target } = request;
    if (!this.runtime.current(target) || !this.runtime.select(target)) return false;
    const labels = this.copy().contextMenu;
    const pathActions = workspacePathCopyActions(OWNER_ID, target, {
      copy: labels.copyPath,
      fileName: labels.fileName,
      relativePath: labels.relativePath,
      absolutePath: labels.absolutePath,
    });
    const policy = this.runtime.policy(target);
    const model = projectFilesContextMenuModel(target, policy, this.copy());
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model,
      isCurrent: () => this.runtime.current(target),
      invoke: async (actionId) => {
        try {
          const pathText = textForCopyAction(pathActions, actionId);
          if (pathText !== null) {
            const result = await this.clipboard.writeText(pathText);
            if (result.status === "failure") {
              this.runtime.error(result.error ?? new Error(labels.clipboardUnavailable));
              return;
            }
            this.runtime.status(copyPathFeedback(actionId, labels));
            return;
          }
          await this.invoke(actionId, target);
        } catch (error) {
          this.runtime.error(error);
        }
      },
      blocked: (reason) => this.runtime.blocked(reason),
      restoreFocus: request.restoreFocus,
    });
    return true;
  }

  private async invoke(actionId: string, target: ProjectFilesContextTarget): Promise<void> {
    switch (actionId) {
      case `${OWNER_ID}.new-file`: return this.runtime.createFile(target);
      case `${OWNER_ID}.cut`: return this.runtime.cut(target);
      case `${OWNER_ID}.copy`: return this.runtime.copy(target);
      case `${OWNER_ID}.paste`: return this.runtime.paste(target);
      case `${OWNER_ID}.reveal`: return this.runtime.reveal(target);
      case `${OWNER_ID}.rename`: return this.runtime.rename(target);
      case `${OWNER_ID}.history`: {
        const intent = this.runtime.historyIntent(target);
        if (intent) this.runtime.installHistoryQuery(intent);
        return;
      }
      case `${OWNER_ID}.trash`: return this.runtime.trash(target);
      default: throw new Error(`Unknown Files context action: ${actionId}`);
    }
  }
}

export function projectFilesContextMenuModel(
  target: ProjectFilesContextTarget,
  policy: ProjectFilesContextPolicy,
  copy: ProjectFilesCopy,
): ContextMenuModel {
  const labels = copy.contextMenu;
  const command = (
    id: string,
    label: string,
    availability: ContextMenuAvailability,
    tone: "normal" | "danger" = "normal",
  ): ContextMenuItem => ({
    kind: "command",
    id: `${OWNER_ID}.${id}`,
    actionId: `${OWNER_ID}.${id}`,
    label,
    availability,
    ...(tone === "danger" ? { tone } : {}),
  });
  const pathActions = workspacePathCopyActions(OWNER_ID, target, {
    copy: labels.copyPath,
    fileName: labels.fileName,
    relativePath: labels.relativePath,
    absolutePath: labels.absolutePath,
  });
  return {
    ariaLabel: labels.ariaLabel(target.workspacePath),
    items: [
      command("new-file", labels.newFile, policy.mutation),
      { kind: "separator" },
      command("cut", labels.cut, policy.mutation),
      command("copy", labels.copy, policy.mutation),
      command("paste", labels.paste, policy.paste),
      { kind: "separator" },
      command("reveal", labels.reveal, ENABLED),
      command("rename", labels.rename, policy.mutation),
      buildPathCopyGroup(`${OWNER_ID}.copy-path`, {
        copy: labels.copyPath,
        fileName: labels.fileName,
        relativePath: labels.relativePath,
        absolutePath: labels.absolutePath,
      }, pathActions),
      { kind: "separator" },
      command("history", labels.gitHistory, policy.history),
      { kind: "separator" },
      command("trash", labels.trash, policy.mutation, "danger"),
    ],
  };
}

function copyPathFeedback(
  actionId: string,
  labels: ProjectFilesCopy["contextMenu"],
): string {
  if (actionId.endsWith(".copy-name")) return labels.copiedFileName;
  if (actionId.endsWith(".copy-relative-path")) return labels.copiedRelativePath;
  return labels.copiedAbsolutePath;
}
