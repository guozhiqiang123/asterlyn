import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { HistoryCopy } from "../../localization/catalog.ts";
import type { BranchMutationKind, BranchSummary, RepositorySnapshot } from "../../models.ts";
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
  select(target: BranchContextTarget): void;
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
    this.runtime.select(request.target);
    const labels = this.copy().branchContextMenu;
    const policy = branchContextPolicy(request.target, snapshot, {
      ...this.runtime.policyOptions(request.target),
      reasons: labels,
    });
    const copyActions = branchCopyActions(request.target.branch, labels);
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model: branchContextMenuModel(request.target, policy, copyActions, this.copy()),
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
          await this.invoke(actionId, request, policy);
        } catch (error) {
          this.runtime.error(error);
        }
      },
      blocked: (reason) => this.runtime.blocked(reason),
      restoreFocus: request.restoreFocus,
    });
    return true;
  }

  private async invoke(
    actionId: string,
    request: DelegatedContextRequest<BranchContextTarget>,
    policy: BranchContextPolicy,
  ): Promise<void> {
    const target = request.target;
    switch (actionId) {
      case `${OWNER_ID}.history`: return this.runtime.showHistory(target);
      case `${OWNER_ID}.switch`:
        if (policy.switchTarget) this.runtime.openMutation("switch", policy.switchTarget, "");
        return;
      case `${OWNER_ID}.checkout-remote`:
        return this.runtime.openMutation(
          "checkoutRemote",
          target.branch,
          suggestedLocalName(target.branch.name),
        );
      case `${OWNER_ID}.create`:
        return this.runtime.openMutation("create", target.branch, "");
      case `${OWNER_ID}.merge`:
        return this.runtime.openGitOperation("merge", target.branch.fullName);
      case `${OWNER_ID}.rebase`:
        return this.runtime.openGitOperation("rebase", target.branch.fullName);
      case `${OWNER_ID}.update`: return this.runtime.openRemoteAction("pull", request.trigger);
      case `${OWNER_ID}.push`: return this.runtime.openRemoteAction("push", request.trigger);
      case `${OWNER_ID}.rename`:
        return this.runtime.openMutation("rename", target.branch, target.branch.name);
      case `${OWNER_ID}.delete`:
        return this.runtime.openMutation("delete", target.branch, "");
      default: throw new Error(`Unknown Branches context action: ${actionId}`);
    }
  }
}

export function branchContextMenuModel(
  target: BranchContextTarget,
  policy: BranchContextPolicy,
  copyActions: readonly TextCopyAction[],
  copy: HistoryCopy,
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
