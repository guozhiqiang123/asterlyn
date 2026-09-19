import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { HistoryCopy } from "../../localization/catalog.ts";
import type {
  ContextMenuAvailability,
  ContextMenuItem,
  ContextMenuModel,
  ContextMenuPort,
} from "../../shared/context-menu/context-menu-model.ts";
import type { DelegatedContextRequest } from "../../shared/context-menu/delegated-context-binding.ts";
import type { HistoryCommitRangeTarget } from "./history-range-context.ts";
import {
  historyCommitRangePolicy,
  type HistoryCommitRangePolicy,
  type HistoryCommitRangePolicyOptions,
} from "./history-range-context-policy.ts";

export const HISTORY_RANGE_CONTEXT_OWNER_ID = "git-history.range-context-actions";
const OWNER_ID = HISTORY_RANGE_CONTEXT_OWNER_ID;

export interface HistoryCommitRangeRuntime {
  current(target: HistoryCommitRangeTarget): boolean;
  policyOptions(target: HistoryCommitRangeTarget): Omit<HistoryCommitRangePolicyOptions, "reasons">;
  openGitOperation(kind: "cherryPick" | "revert" | "squash", targets: readonly string[]): void;
  openComparison(target: HistoryCommitRangeTarget): void;
  blocked(reason: string): void;
  status(message: string): void;
  error(error: unknown): void;
}

export class HistoryCommitRangeContextActions {
  private readonly host: ContextMenuPort;
  private readonly clipboard: TextClipboardPort;
  private readonly runtime: HistoryCommitRangeRuntime;
  private readonly copy: () => HistoryCopy;

  constructor(
    host: ContextMenuPort,
    clipboard: TextClipboardPort,
    runtime: HistoryCommitRangeRuntime,
    copy: () => HistoryCopy,
  ) {
    this.host = host;
    this.clipboard = clipboard;
    this.runtime = runtime;
    this.copy = copy;
  }

  open(request: DelegatedContextRequest<HistoryCommitRangeTarget>): boolean {
    if (!this.runtime.current(request.target)) return false;
    const labels = this.copy().rangeContextMenu;
    const policy = historyCommitRangePolicy(request.target, {
      ...this.runtime.policyOptions(request.target),
      reasons: labels,
    });
    this.host.open(request.anchor, {
      ownerId: OWNER_ID,
      model: historyCommitRangeContextMenuModel(request.target, policy, this.copy()),
      isCurrent: () => this.runtime.current(request.target),
      invoke: async (actionId) => {
        try {
          if (actionId === `${OWNER_ID}.copy-commit-ids`) {
            const result = await this.clipboard.writeText(
              request.target.commits.map((commit) => commit.oid).join("\n"),
            );
            if (result.status === "failure") {
              this.runtime.error(result.error ?? new Error(labels.clipboardUnavailable));
              return;
            }
            this.runtime.status(labels.copiedCommitIds(request.target.commits.length));
            return;
          }
          this.invoke(actionId, policy, request.target);
        } catch (error) {
          this.runtime.error(error);
        }
      },
      blocked: (reason) => this.runtime.blocked(reason),
      restoreFocus: request.restoreFocus,
    });
    return true;
  }

  private invoke(
    actionId: string,
    policy: HistoryCommitRangePolicy,
    target: HistoryCommitRangeTarget,
  ): void {
    switch (actionId) {
      case `${OWNER_ID}.cherry-pick`:
        this.runtime.openGitOperation("cherryPick", policy.oldestToNewest.map((commit) => commit.oid));
        return;
      case `${OWNER_ID}.revert`:
        this.runtime.openGitOperation("revert", policy.newestToOldest.map((commit) => commit.oid));
        return;
      case `${OWNER_ID}.squash`:
        if (policy.squashBaseOid) this.runtime.openGitOperation("squash", [policy.squashBaseOid]);
        return;
      case `${OWNER_ID}.compare`:
        this.runtime.openComparison(target);
        return;
      default: throw new Error(`Unknown History range context action: ${actionId}`);
    }
  }
}

export function historyCommitRangeContextMenuModel(
  target: HistoryCommitRangeTarget,
  policy: HistoryCommitRangePolicy,
  copy: HistoryCopy,
): ContextMenuModel {
  const labels = copy.rangeContextMenu;
  const command = (
    id: string,
    label: string,
    availability: ContextMenuAvailability,
    tone: "normal" | "danger" = "normal",
  ): ContextMenuItem => ({
    kind: "command", id: `${OWNER_ID}.${id}`, actionId: `${OWNER_ID}.${id}`,
    label, availability, tone,
  });
  return {
    ariaLabel: labels.ariaLabel(target.commits.length),
    items: [
      command("copy-commit-ids", labels.copyCommitIds, { kind: "enabled" }),
      ...(target.commits.length === 2 && policy.sameRoot
        ? [command("compare", labels.compareTwoCommits, { kind: "enabled" })]
        : []),
      { kind: "separator" },
      command("cherry-pick", labels.cherryPickSelected, policy.cherryPick),
      command("revert", labels.revertSelected, policy.revert),
      { kind: "separator" },
      command("squash", labels.squashSelected, policy.squash, "danger"),
    ],
  };
}
