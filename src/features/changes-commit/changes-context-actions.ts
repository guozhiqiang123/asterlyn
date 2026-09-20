import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { ChangesCopy } from "../../localization/catalog.ts";
import type { RepositorySnapshot } from "../../models.ts";
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
import type { ChangesContextTarget } from "./changes-navigation-binding.ts";
import type { ChangesFileContextTarget, ChangesGroupContextTarget } from "./changes-navigation-binding.ts";
import {
  changesContextPolicy,
  changesHistoryIntent,
  type ChangesContextPolicy,
  type ChangesContextPolicyOptions,
} from "./changes-context-policy.ts";

export const CHANGES_CONTEXT_OWNER_ID = "changes.context-actions";
const OWNER_ID = CHANGES_CONTEXT_OWNER_ID;
const ENABLED = { kind: "enabled" } as const;

export interface ChangesContextRuntime {
  current(target: ChangesContextTarget): boolean;
  select(target: ChangesFileContextTarget): boolean;
  included(target: ChangesFileContextTarget): boolean;
  snapshot(): RepositorySnapshot | null;
  policyOptions(target: ChangesFileContextTarget): Omit<ChangesContextPolicyOptions, "snapshot">;
  groupPolicy(target: ChangesGroupContextTarget): { stage: ContextMenuAvailability; trash: ContextMenuAvailability };
  setIncluded(target: ChangesFileContextTarget, included: boolean): void;
  showDiff(target: ChangesFileContextTarget): void | Promise<void>;
  jumpToSource(target: ChangesFileContextTarget): void | Promise<void>;
  resolveConflict(target: ChangesFileContextTarget): void | Promise<void>;
  restore(target: ChangesFileContextTarget): void | Promise<void>;
  trash(target: ChangesFileContextTarget): void | Promise<void>;
  stageAll(target: ChangesGroupContextTarget): void | Promise<void>;
  trashAll(target: ChangesGroupContextTarget): void | Promise<void>;
  installHistoryQuery(intent: HistoryQueryIntent): void;
  blocked(reason: string): void;
  status(message: string): void;
  error(error: unknown): void;
}

/** Changes owns its file-row semantics; the shared host only presents this model. */
export class ChangesContextActions {
  private readonly host: ContextMenuPort;
  private readonly clipboard: TextClipboardPort;
  private readonly runtime: ChangesContextRuntime;
  private readonly copy: () => ChangesCopy;

  constructor(
    host: ContextMenuPort,
    clipboard: TextClipboardPort,
    runtime: ChangesContextRuntime,
    copy: () => ChangesCopy,
  ) {
    this.host = host;
    this.clipboard = clipboard;
    this.runtime = runtime;
    this.copy = copy;
  }

  open(request: DelegatedContextRequest<ChangesContextTarget>): boolean {
    const { target } = request;
    if (!this.runtime.current(target)) return false;
    if (target.kind === "group") return this.openGroup(request, target);
    if (!this.runtime.select(target)) return false;
    const labels = this.copy().contextMenu;
    const pathLabels = {
      copy: labels.copyPath,
      fileName: labels.fileName,
      relativePath: labels.relativePath,
      absolutePath: labels.absolutePath,
    };
    const pathActions = workspacePathCopyActions(OWNER_ID, target, pathLabels);
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model: changesContextMenuModel(
        target,
        this.runtime.included(target),
        changesContextPolicy(target, {
          snapshot: this.runtime.snapshot(),
          ...this.runtime.policyOptions(target),
        }),
        this.copy(),
      ),
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

  private openGroup(
    request: DelegatedContextRequest<ChangesContextTarget>,
    target: ChangesGroupContextTarget,
  ): boolean {
    const policy = this.runtime.groupPolicy(target);
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model: unversionedGroupContextMenuModel(target, policy, this.copy()),
      isCurrent: () => this.runtime.current(target),
      invoke: async (actionId) => {
        try {
          if (actionId === `${OWNER_ID}.stage-all`) await this.runtime.stageAll(target);
          else if (actionId === `${OWNER_ID}.trash-all`) await this.runtime.trashAll(target);
          else throw new Error(`Unknown Changes group context action: ${actionId}`);
        } catch (error) {
          this.runtime.error(error);
        }
      },
      blocked: (reason) => this.runtime.blocked(reason),
      restoreFocus: request.restoreFocus,
    });
    return true;
  }

  private async invoke(actionId: string, target: ChangesFileContextTarget): Promise<void> {
    const labels = this.copy().contextMenu;
    switch (actionId) {
      case `${OWNER_ID}.include`: {
        const included = !this.runtime.included(target);
        this.runtime.setIncluded(target, included);
        this.runtime.status(included ? labels.included : labels.excluded);
        return;
      }
      case `${OWNER_ID}.diff`: return this.runtime.showDiff(target);
      case `${OWNER_ID}.source`: return this.runtime.jumpToSource(target);
      case `${OWNER_ID}.resolve`: return this.runtime.resolveConflict(target);
      case `${OWNER_ID}.restore`: return this.runtime.restore(target);
      case `${OWNER_ID}.trash`: return this.runtime.trash(target);
      case `${OWNER_ID}.history`: {
        const intent = changesHistoryIntent(target, this.runtime.snapshot());
        if (intent) this.runtime.installHistoryQuery(intent);
        return;
      }
      default: throw new Error(`Unknown Changes context action: ${actionId}`);
    }
  }
}

export function unversionedGroupContextMenuModel(
  target: ChangesGroupContextTarget,
  policy: { stage: ContextMenuAvailability; trash: ContextMenuAvailability },
  copy: ChangesCopy,
): ContextMenuModel {
  const labels = copy.contextMenu;
  return {
    ariaLabel: labels.unversionedGroupAriaLabel(target.paths.length),
    items: [
      {
        kind: "command", id: `${OWNER_ID}.stage-all`, actionId: `${OWNER_ID}.stage-all`,
        label: labels.stageAllUnversioned, availability: policy.stage,
      },
      { kind: "separator" },
      {
        kind: "command", id: `${OWNER_ID}.trash-all`, actionId: `${OWNER_ID}.trash-all`,
        label: labels.trashAllUnversioned, availability: policy.trash, tone: "danger",
      },
    ],
  };
}

export function changesContextMenuModel(
  target: ChangesFileContextTarget,
  included: boolean,
  policy: ChangesContextPolicy,
  copy: ChangesCopy,
): ContextMenuModel {
  const labels = copy.contextMenu;
  const command = (
    id: string,
    label: string,
    availability: ContextMenuAvailability,
    tone: "normal" | "danger" = "normal",
  ): ContextMenuItem => ({
    kind: "command", id: `${OWNER_ID}.${id}`, actionId: `${OWNER_ID}.${id}`,
    label, availability, ...(tone === "danger" ? { tone } : {}),
  });
  const items: ContextMenuItem[] = [
    {
      kind: "check", id: `${OWNER_ID}.include`, actionId: `${OWNER_ID}.include`,
      label: labels.includeInCommit, checked: included, availability: policy.include,
    },
    { kind: "separator" },
    command("diff", labels.showDiff, ENABLED),
    command("source", labels.jumpToSource, policy.source),
  ];
  if (target.change.conflicted) items.push(command("resolve", labels.resolveConflict, policy.conflict));
  items.push(
    { kind: "separator" },
    command("restore", labels.restoreChanges, policy.restore),
  );
  if (target.change.worktreeStatus === "untracked" || target.change.indexStatus === "untracked") {
    items.push(command("trash", labels.trash, policy.trash, "danger"));
  }
  const pathLabels = {
    copy: labels.copyPath,
    fileName: labels.fileName,
    relativePath: labels.relativePath,
    absolutePath: labels.absolutePath,
  };
  const pathActions = workspacePathCopyActions(OWNER_ID, target, pathLabels);
  items.push(
    { kind: "separator" },
    buildPathCopyGroup(`${OWNER_ID}.copy-path`, pathLabels, pathActions),
    command("history", labels.gitHistory, policy.history),
  );
  return { ariaLabel: labels.ariaLabel(target.path), items };
}

function copyPathFeedback(actionId: string, labels: ChangesCopy["contextMenu"]): string {
  if (actionId.endsWith(".copy-name")) return labels.copiedFileName;
  if (actionId.endsWith(".copy-relative-path")) return labels.copiedRelativePath;
  return labels.copiedAbsolutePath;
}
