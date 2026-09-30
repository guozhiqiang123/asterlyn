import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { HistoryCopy } from "../../localization/catalog.ts";
import type { TagMutationKind } from "../../models.ts";
import type {
  ContextMenuAvailability,
  ContextMenuItem,
  ContextMenuModel,
  ContextMenuPort,
} from "../../shared/context-menu/context-menu-model.ts";
import {
  commitCopyAction,
  copyCommandItem,
  textForCopyAction,
} from "../../shared/context-menu/context-menu-copy-actions.ts";
import type { DelegatedContextRequest } from "../../shared/context-menu/delegated-context-binding.ts";
import type { HistoryCommitContextTarget } from "./history-context-binding.ts";
import {
  historyCommitContextPolicy,
  type HistoryCommitContextPolicy,
  type HistoryCommitContextPolicyOptions,
} from "./history-commit-context-policy.ts";

export const HISTORY_COMMIT_CONTEXT_OWNER_ID = "git-history.commit-context-actions";
const OWNER_ID = HISTORY_COMMIT_CONTEXT_OWNER_ID;

export interface HistoryCommitContextRuntime {
  current(target: HistoryCommitContextTarget): boolean;
  select(target: HistoryCommitContextTarget): boolean;
  policyOptions(target: HistoryCommitContextTarget): Omit<HistoryCommitContextPolicyOptions, "reasons">;
  openGitOperation(kind: "cherryPick" | "revert", oid: string): void;
  openBranchFromCommit(target: HistoryCommitContextTarget): void;
  tagRemotes(target: HistoryCommitContextTarget): readonly string[];
  openTagMutation(
    kind: TagMutationKind,
    target: HistoryCommitContextTarget,
    tagName?: string,
    remote?: string | null,
  ): void;
  openReset(target: HistoryCommitContextTarget): void;
  blocked(reason: string): void;
  status(message: string): void;
  error(error: unknown): void;
}

export class HistoryCommitContextActions {
  private readonly host: ContextMenuPort;
  private readonly clipboard: TextClipboardPort;
  private readonly runtime: HistoryCommitContextRuntime;
  private readonly copy: () => HistoryCopy;

  constructor(
    host: ContextMenuPort,
    clipboard: TextClipboardPort,
    runtime: HistoryCommitContextRuntime,
    copy: () => HistoryCopy,
  ) {
    this.host = host;
    this.clipboard = clipboard;
    this.runtime = runtime;
    this.copy = copy;
  }

  open(request: DelegatedContextRequest<HistoryCommitContextTarget>): boolean {
    if (!this.runtime.current(request.target) || !this.runtime.select(request.target)) return false;
    const labels = this.copy().commitContextMenu;
    const policy = historyCommitContextPolicy(request.target, {
      ...this.runtime.policyOptions(request.target),
      reasons: labels,
    });
    const copyAction = commitCopyAction(OWNER_ID, labels.copyCommitId, request.target.oid);
    const tagRemotes = this.runtime.tagRemotes(request.target);
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model: historyCommitContextMenuModel(request.target, policy, this.copy(), tagRemotes),
      isCurrent: () => this.runtime.current(request.target),
      invoke: async (actionId) => {
        try {
          const text = textForCopyAction([copyAction], actionId);
          if (text !== null) {
            const result = await this.clipboard.writeText(text);
            if (result.status === "failure") {
              this.runtime.error(result.error ?? new Error(labels.clipboardUnavailable));
              return;
            }
            this.runtime.status(labels.copiedCommitId);
            return;
          }
          this.invoke(actionId, request.target, tagRemotes);
        } catch (error) {
          this.runtime.error(error);
        }
      },
      blocked: (reason) => this.runtime.blocked(reason),
      restoreFocus: request.restoreFocus,
    });
    return true;
  }

  commandAvailability(target: HistoryCommitContextTarget): ContextMenuAvailability {
    return this.runtime.current(target)
      ? { kind: "enabled" }
      : { kind: "blocked", reason: this.copy().commitContextMenu.targetChanged };
  }

  async executeCopyCommand(target: HistoryCommitContextTarget): Promise<void> {
    const availability = this.commandAvailability(target);
    if (availability.kind !== "enabled") {
      this.runtime.blocked(availability.kind === "busy" ? availability.label : availability.reason);
      return;
    }
    if (!this.runtime.select(target)) {
      this.runtime.blocked(this.copy().commitContextMenu.targetChanged);
      return;
    }
    await this.copyCommitId(target.oid);
  }

  private async copyCommitId(oid: string): Promise<void> {
    const labels = this.copy().commitContextMenu;
    const result = await this.clipboard.writeText(oid);
    if (result.status === "failure") this.runtime.error(result.error ?? new Error(labels.clipboardUnavailable));
    else this.runtime.status(labels.copiedCommitId);
  }

  private invoke(
    actionId: string,
    target: HistoryCommitContextTarget,
    remotes: readonly string[],
  ): void {
    switch (actionId) {
      case `${OWNER_ID}.cherry-pick`:
        this.runtime.openGitOperation("cherryPick", target.oid);
        return;
      case `${OWNER_ID}.revert`:
        this.runtime.openGitOperation("revert", target.oid);
        return;
      case `${OWNER_ID}.reset`:
        this.runtime.openReset(target);
        return;
      case `${OWNER_ID}.create-branch`:
        this.runtime.openBranchFromCommit(target);
        return;
      case `${OWNER_ID}.new-tag`:
        this.runtime.openTagMutation("create", target);
        return;
      default: {
        const tagAction = resolveTagAction(actionId, target, remotes);
        if (!tagAction) throw new Error(`Unknown History commit context action: ${actionId}`);
        this.runtime.openTagMutation(
          tagAction.kind,
          target,
          tagAction.tagName,
          tagAction.remote,
        );
      }
    }
  }
}

export function historyCommitContextMenuModel(
  target: HistoryCommitContextTarget,
  policy: HistoryCommitContextPolicy,
  copy: HistoryCopy,
  remotes: readonly string[] = [],
): ContextMenuModel {
  const labels = copy.commitContextMenu;
  const command = (
    id: string,
    label: string,
    availability: ContextMenuAvailability,
  ): ContextMenuItem => ({
    kind: "command", id: `${OWNER_ID}.${id}`, actionId: `${OWNER_ID}.${id}`,
    label, availability,
  });
  const copyAction = commitCopyAction(OWNER_ID, labels.copyCommitId, target.oid);
  const items: ContextMenuItem[] = [copyCommandItem(copyAction)];
  if (policy.writable) {
    items.push(
      { kind: "separator" },
      command("cherry-pick", labels.cherryPick, policy.cherryPick),
      command("revert", labels.revertCommit, policy.revert),
      ...(policy.reset ? [command("reset", labels.resetToHere, policy.reset)] : []),
      { kind: "separator" },
      command("create-branch", labels.newBranchFromCommit, policy.create),
      command("new-tag", labels.newTag, policy.tag),
      ...tagSubmenus(target, policy, copy, remotes),
    );
  }
  return { ariaLabel: labels.ariaLabel(target.commit.subject), items };
}

function tagSubmenus(
  target: HistoryCommitContextTarget,
  policy: HistoryCommitContextPolicy,
  copy: HistoryCopy,
  remotes: readonly string[] = [],
): ContextMenuItem[] {
  return commitTagNames(target).map((tagName, tagIndex) => ({
    kind: "submenu" as const,
    id: `${OWNER_ID}.tag-${tagIndex}`,
    label: copy.commitContextMenu.tagMenu(tagName),
    availability: policy.tag,
    children: [
      dangerCommand(`tag-${tagIndex}.delete-local`, copy.commitContextMenu.deleteLocalTag, policy.tag),
      ...remotes.map((remote, remoteIndex) => dangerCommand(
        `tag-${tagIndex}.delete-remote-${remoteIndex}`,
        copy.commitContextMenu.deleteRemoteTag(remote),
        policy.tag,
      )),
    ],
  }));
}

function commitTagNames(target: HistoryCommitContextTarget): string[] {
  return target.commit.decorations
    .filter((value) => value.startsWith("tag: "))
    .map((value) => value.slice("tag: ".length))
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
}

function dangerCommand(
  id: string,
  label: string,
  availability: ContextMenuAvailability,
): ContextMenuItem & { kind: "command" } {
  return {
    kind: "command", id: `${OWNER_ID}.${id}`, actionId: `${OWNER_ID}.${id}`,
    label, availability, tone: "danger",
  };
}

function resolveTagAction(
  actionId: string,
  target: HistoryCommitContextTarget,
  remotes: readonly string[],
): { kind: TagMutationKind; tagName: string; remote: string | null } | null {
  for (const [tagIndex, tagName] of commitTagNames(target).entries()) {
    if (actionId === `${OWNER_ID}.tag-${tagIndex}.delete-local`) {
      return { kind: "deleteLocal", tagName, remote: null };
    }
    for (const [remoteIndex, remote] of remotes.entries()) {
      if (actionId === `${OWNER_ID}.tag-${tagIndex}.delete-remote-${remoteIndex}`) {
        return { kind: "deleteRemote", tagName, remote };
      }
    }
  }
  return null;
}
