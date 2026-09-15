import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";
import type { HistoryCommitContextTarget } from "./history-context-binding.ts";

export interface HistoryCommitContextPolicyReasons {
  readonly busy: string;
  readonly cleanRequired: string;
  readonly localBranchRequired: string;
  readonly mergeMainlineRequired: string;
}

export interface HistoryCommitContextPolicyOptions {
  readonly busy: boolean;
  readonly clean: boolean;
  readonly cleanReason: string;
  readonly localBranch: boolean;
  readonly reasons: HistoryCommitContextPolicyReasons;
}

export interface HistoryCommitContextPolicy {
  readonly writable: boolean;
  readonly cherryPick: ContextMenuAvailability;
  readonly revert: ContextMenuAvailability;
  readonly create: ContextMenuAvailability;
}

export function historyCommitContextPolicy(
  target: HistoryCommitContextTarget,
  options: HistoryCommitContextPolicyOptions,
): HistoryCommitContextPolicy {
  const writable = target.repositoryId === ".";
  const mutation = options.busy
    ? busy(options.reasons.busy)
    : !options.localBranch
      ? blocked(options.reasons.localBranchRequired)
      : !options.clean
        ? blocked(options.cleanReason || options.reasons.cleanRequired)
        : enabled();
  const singleParent = target.commit.parents.length <= 1;
  const commitMutation = singleParent
    ? mutation
    : blocked(options.reasons.mergeMainlineRequired);
  return { writable, cherryPick: commitMutation, revert: commitMutation, create: mutation };
}

function enabled(): ContextMenuAvailability {
  return { kind: "enabled" };
}

function blocked(reason: string): ContextMenuAvailability {
  return { kind: "blocked", reason };
}

function busy(label: string): ContextMenuAvailability {
  return { kind: "busy", label };
}
