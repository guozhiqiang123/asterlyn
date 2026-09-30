import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { BranchContextCommandAction } from "../../application/commands/history-command-ids.ts";
import type { HistoryCopy } from "../../localization/catalog.ts";
import type {
  BranchMutationKind,
  BranchSummary,
  RepositorySnapshot,
  TagMutationKind,
} from "../../models.ts";
import type {
  ContextMenuAvailability,
  ContextMenuItem,
  ContextMenuModel,
  ContextMenuPort,
} from "../../shared/context-menu/context-menu-model.ts";
import {
  copyCommandItem,
  textForCopyAction,
  type TextCopyAction,
} from "../../shared/context-menu/context-menu-copy-actions.ts";
import type { DelegatedContextRequest } from "../../shared/context-menu/delegated-context-binding.ts";
import type { BranchContextTarget } from "./branch-context-binding.ts";
import {
  branchContextPolicy,
  type BranchContextPolicy,
  type BranchContextPolicyOptions,
} from "./branch-context-policy.ts";

export const BRANCH_CONTEXT_OWNER_ID = "git-branches.context-actions";
const OWNER_ID = BRANCH_CONTEXT_OWNER_ID;
const ENABLED = { kind: "enabled" } as const;

export interface BranchContextRuntime {
  current(target: BranchContextTarget): boolean;
  highlight(target: BranchContextTarget, highlighted: boolean): void;
  snapshot(): RepositorySnapshot | null;
  policyOptions(target: BranchContextTarget): Omit<BranchContextPolicyOptions, "reasons">;
  showHistory(target: BranchContextTarget): void;
  openMutation(
    kind: BranchMutationKind,
    branch: BranchSummary,
    suggestedName: string,
  ): void;
  openGitOperation(kind: "merge" | "rebase", fullName: string): void;
  openRemoteAction(kind: "pull" | "push", returnFocus: HTMLElement): void | Promise<void>;
  tagRemotes(target: BranchContextTarget): readonly string[];
  openTagMutation(
    kind: TagMutationKind,
    target: BranchContextTarget,
    remote?: string | null,
  ): void;
  blocked(reason: string): void;
  status(message: string): void;
  error(error: unknown): void;
}

export class BranchContextActions {
  private readonly host: ContextMenuPort;
  private readonly clipboard: TextClipboardPort;
  private readonly runtime: BranchContextRuntime;
  private readonly copy: () => HistoryCopy;

  constructor(
    host: ContextMenuPort,
    clipboard: TextClipboardPort,
    runtime: BranchContextRuntime,
    copy: () => HistoryCopy,
  ) {
    this.host = host;
    this.clipboard = clipboard;
    this.runtime = runtime;
    this.copy = copy;
  }

  open(request: DelegatedContextRequest<BranchContextTarget>): boolean {
    const snapshot = this.runtime.snapshot();
    if (!snapshot || !this.runtime.current(request.target)) return false;
    this.runtime.highlight(request.target, true);
    const labels = this.copy().branchContextMenu;
    const policy = branchContextPolicy(request.target, snapshot, {
      ...this.runtime.policyOptions(request.target),
      reasons: labels,
    });
    const copyActions = branchCopyActions(request.target.branch, labels);
    const tagRemotes = this.runtime.tagRemotes(request.target);
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model: branchContextMenuModel(request.target, policy, copyActions, this.copy(), tagRemotes),
      isCurrent: () => this.runtime.current(request.target),
      invoke: async (actionId) => {
        try {
          const text = textForCopyAction(copyActions, actionId);
          if (text !== null) {
            const result = await this.clipboard.writeText(text);
            if (result.status === "failure") {
              this.runtime.error(result.error ?? new Error(labels.clipboardUnavailable));
              return;
            }
            this.runtime.status(actionId.endsWith("copy-short") ? labels.copiedShort : labels.copiedFull);
            return;
          }
          await this.invoke(actionId, request, policy, tagRemotes);
        } catch (error) {
          this.runtime.error(error);
        }
      },
      blocked: (reason) => this.runtime.blocked(reason),
      dismissed: () => this.runtime.highlight(request.target, false),
      restoreFocus: request.restoreFocus,
    });
    return true;
  }

  commandAvailability(
    action: BranchContextCommandAction,
    target: BranchContextTarget,
  ): ContextMenuAvailability {
    const snapshot = this.runtime.snapshot();
    if (!snapshot || !this.runtime.current(target)) return blocked(this.copy().branchContextMenu.targetChanged);
    const policy = branchContextPolicy(target, snapshot, {
      ...this.runtime.policyOptions(target), reasons: this.copy().branchContextMenu,
    });
    if (action === "ref-history") return ENABLED;
    if (action === "branch-switch") return target.branch.kind !== "tag" && policy.switchTarget
      ? policy.switch : blocked(this.copy().branchContextMenu.targetChanged);
    if (action === "branch-checkout-remote") return target.branch.kind === "remote" && policy.remoteCheckout
      ? policy.switch : blocked(this.copy().branchContextMenu.targetChanged);
    if (action === "branch-create") return target.branch.kind !== "tag" && policy.writable
      ? policy.create : blocked(this.copy().branchContextMenu.targetChanged);
    if (action === "branch-merge" || action === "branch-rebase") {
      return target.branch.kind !== "tag" && !target.branch.current && policy.writable
        ? policy.integrate : blocked(this.copy().branchContextMenu.targetChanged);
    }
    if (action === "branch-rename") return target.branch.kind === "local" && policy.writable
      ? policy.rename : blocked(this.copy().branchContextMenu.targetChanged);
    if (action === "branch-delete") return target.branch.kind === "local" && !target.branch.current && policy.writable
      ? policy.delete : blocked(this.copy().branchContextMenu.targetChanged);
    if (target.branch.kind !== "tag" || !policy.writable) return blocked(this.copy().branchContextMenu.targetChanged);
    if (action === "tag-checkout") return policy.tagCheckout;
    if (action === "tag-merge") return policy.tagIntegrate;
    return policy.tagMutation;
  }

  executeCommand(action: BranchContextCommandAction, target: BranchContextTarget): void {
    const availability = this.commandAvailability(action, target);
    if (availability.kind !== "enabled") {
      this.runtime.blocked(availability.kind === "busy" ? availability.label : availability.reason);
      return;
    }
    const snapshot = this.runtime.snapshot();
    if (!snapshot) return;
    const policy = branchContextPolicy(target, snapshot, {
      ...this.runtime.policyOptions(target), reasons: this.copy().branchContextMenu,
    });
    try {
      this.invokeCommand(action, target, policy);
    } catch (error) {
      this.runtime.error(error);
    }
  }

  private async invoke(
    actionId: string,
    request: DelegatedContextRequest<BranchContextTarget>,
    policy: BranchContextPolicy,
    tagRemotes: readonly string[],
  ): Promise<void> {
    const target = request.target;
    const commandAction = commandActionForMenuId(actionId);
    if (commandAction) {
      this.invokeCommand(commandAction, target, policy);
      return;
    }
    switch (actionId) {
      case `${OWNER_ID}.update`: return this.runtime.openRemoteAction("pull", request.trigger);
      case `${OWNER_ID}.push`: return this.runtime.openRemoteAction("push", request.trigger);
      default: {
        for (const [index, remote] of tagRemotes.entries()) {
          if (actionId === `${OWNER_ID}.tag-push-${index}`) {
            return this.runtime.openTagMutation("push", target, remote);
          }
          if (actionId === `${OWNER_ID}.tag-delete-remote-${index}`) {
            return this.runtime.openTagMutation("deleteRemote", target, remote);
          }
        }
        throw new Error(`Unknown Branches context action: ${actionId}`);
      }
    }
  }

  private invokeCommand(
    action: BranchContextCommandAction,
    target: BranchContextTarget,
    policy: BranchContextPolicy,
  ): void {
    switch (action) {
      case "ref-history": return this.runtime.showHistory(target);
      case "branch-switch":
        if (policy.switchTarget) this.runtime.openMutation("switch", policy.switchTarget, "");
        return;
      case "branch-checkout-remote":
        return this.runtime.openMutation("checkoutRemote", target.branch, suggestedLocalName(target.branch.name));
      case "branch-create": return this.runtime.openMutation("create", target.branch, "");
      case "branch-merge": return this.runtime.openGitOperation("merge", target.branch.fullName);
      case "branch-rebase": return this.runtime.openGitOperation("rebase", target.branch.fullName);
      case "branch-rename": return this.runtime.openMutation("rename", target.branch, target.branch.name);
      case "branch-delete": return this.runtime.openMutation("delete", target.branch, "");
      case "tag-checkout": return this.runtime.openTagMutation("checkout", target);
      case "tag-merge": return this.runtime.openGitOperation("merge", target.branch.fullName);
      case "tag-delete-local": return this.runtime.openTagMutation("deleteLocal", target);
    }
  }
}

export function branchContextMenuModel(
  target: BranchContextTarget,
  policy: BranchContextPolicy,
  copyActions: readonly TextCopyAction[],
  copy: HistoryCopy,
  tagRemotes: readonly string[] = [],
): ContextMenuModel {
  const labels = copy.branchContextMenu;
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
  if (target.branch.kind === "tag") {
    const items: ContextMenuItem[] = [];
    if (policy.writable) {
      items.push(
        command("tag-checkout", labels.checkoutTag, policy.tagCheckout),
        command(
          "tag-merge",
          labels.mergeTagInto(target.branch.name, policy.currentBranchName),
          policy.tagIntegrate,
        ),
        ...tagRemotes.map((remote, index) =>
          command(`tag-push-${index}`, labels.pushTagTo(remote), policy.tagMutation)
        ),
        { kind: "separator" },
        command("tag-delete-local", labels.deleteLocalTag, policy.tagMutation, "danger"),
        ...tagRemotes.map((remote, index) =>
          command(
            `tag-delete-remote-${index}`,
            labels.deleteRemoteTag(remote),
            policy.tagMutation,
            "danger",
          )
        ),
      );
    } else {
      items.push(
        command("history", labels.viewHistory, ENABLED),
        { kind: "separator" },
        {
          kind: "submenu",
          id: `${OWNER_ID}.copy`,
          label: labels.copyTag,
          availability: ENABLED,
          children: copyActions.map(copyCommandItem),
        },
      );
    }
    return { ariaLabel: labels.tagAriaLabel(target.branch.name), items };
  }
  const items: ContextMenuItem[] = [command("history", labels.viewHistory, ENABLED)];
  if (policy.writable) {
    if (policy.switchTarget) {
      items.push(command("switch", labels.switchTo(policy.switchTarget.name), policy.switch));
    } else if (policy.remoteCheckout) {
      items.push(command("checkout-remote", labels.checkoutRemote, policy.switch));
    }
    items.push(command("create", labels.newBranchFrom, policy.create));
    if (!target.branch.current) {
      items.push(
        command("merge", labels.mergeIntoCurrent, policy.integrate),
        command("rebase", labels.rebaseCurrentOnto, policy.integrate),
      );
    }
    if (target.branch.kind === "local" && target.branch.current) {
      items.push(
        { kind: "separator" },
        command("update", labels.update, policy.update),
        command("push", labels.push, policy.push),
      );
    }
    if (target.branch.kind === "local") {
      items.push({ kind: "separator" }, command("rename", labels.rename, policy.rename));
    }
  }
  if (items.at(-1)?.kind !== "separator") items.push({ kind: "separator" });
  items.push({
    kind: "submenu",
    id: `${OWNER_ID}.copy`,
    label: labels.copyBranch,
    availability: ENABLED,
    children: copyActions.map(copyCommandItem),
  });
  if (policy.writable && target.branch.kind === "local" && !target.branch.current) {
    items.push(
      { kind: "separator" },
      command("delete", labels.deleteLocal, policy.delete, "danger"),
    );
  }
  return { ariaLabel: labels.ariaLabel(target.branch.name), items };
}

export function branchCopyActions(
  branch: BranchSummary,
  labels: HistoryCopy["branchContextMenu"],
): readonly TextCopyAction[] {
  return [
    {
      id: `${OWNER_ID}.copy-short`, actionId: `${OWNER_ID}.copy-short`,
      label: labels.shortName, text: branch.name,
    },
    {
      id: `${OWNER_ID}.copy-full`, actionId: `${OWNER_ID}.copy-full`,
      label: labels.fullReference, text: branch.fullName,
    },
  ];
}

function suggestedLocalName(remoteName: string): string {
  const separator = remoteName.indexOf("/");
  return separator >= 0 ? remoteName.slice(separator + 1) : remoteName;
}

function blocked(reason: string): ContextMenuAvailability {
  return { kind: "blocked", reason };
}

function commandActionForMenuId(actionId: string): BranchContextCommandAction | null {
  return ({
    [`${OWNER_ID}.history`]: "ref-history",
    [`${OWNER_ID}.switch`]: "branch-switch",
    [`${OWNER_ID}.checkout-remote`]: "branch-checkout-remote",
    [`${OWNER_ID}.create`]: "branch-create",
    [`${OWNER_ID}.merge`]: "branch-merge",
    [`${OWNER_ID}.rebase`]: "branch-rebase",
    [`${OWNER_ID}.rename`]: "branch-rename",
    [`${OWNER_ID}.delete`]: "branch-delete",
    [`${OWNER_ID}.tag-checkout`]: "tag-checkout",
    [`${OWNER_ID}.tag-merge`]: "tag-merge",
    [`${OWNER_ID}.tag-delete-local`]: "tag-delete-local",
  } as Record<string, BranchContextCommandAction>)[actionId] ?? null;
}
