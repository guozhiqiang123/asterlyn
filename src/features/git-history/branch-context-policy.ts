import type { BranchSummary, RepositorySnapshot } from "../../models.ts";
import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";
import type { BranchContextTarget } from "./branch-context-binding.ts";

export interface BranchContextPolicyReasons {
  readonly busy: string;
  readonly cleanRequired: string;
}

export interface BranchContextPolicyOptions {
  readonly busy: boolean;
  readonly clean: boolean;
  readonly cleanReason: string;
  readonly updateBlocked: string | null;
  readonly pushBlocked: string | null;
  readonly reasons: BranchContextPolicyReasons;
}

export interface BranchContextPolicy {
  readonly writable: boolean;
  readonly switchTarget: BranchSummary | null;
  readonly remoteCheckout: boolean;
  readonly switch: ContextMenuAvailability;
  readonly create: ContextMenuAvailability;
  readonly integrate: ContextMenuAvailability;
  readonly rename: ContextMenuAvailability;
  readonly delete: ContextMenuAvailability;
  readonly update: ContextMenuAvailability;
  readonly push: ContextMenuAvailability;
}

export function branchContextPolicy(
  target: BranchContextTarget,
  snapshot: RepositorySnapshot,
  options: BranchContextPolicyOptions,
): BranchContextPolicy {
  const exact = target.matches.length === 1 ? target.matches[0]! : null;
  const writable = Boolean(exact && exact.repositoryId === ".");
  const mutation = options.busy ? busy(options.reasons.busy) : enabled();
  const cleanMutation = options.busy
    ? mutation
    : options.clean
      ? enabled()
      : blocked(options.cleanReason || options.reasons.cleanRequired);
  const trackingLocals = target.branch.kind === "remote" && writable
    ? snapshot.branches.filter((branch) =>
        branch.repositoryId === "." && branch.kind === "local" &&
        branch.upstream === target.branch.fullName
      )
    : [];
  const switchTarget = target.branch.kind === "local"
    ? (target.branch.current ? null : exact)
    : trackingLocals.length === 1 && !trackingLocals[0]!.current
      ? trackingLocals[0]!
      : null;
  return {
    writable,
    switchTarget,
    remoteCheckout: writable && target.branch.kind === "remote" && trackingLocals.length === 0,
    switch: cleanMutation,
    create: cleanMutation,
    integrate: mutation,
    rename: mutation,
    delete: mutation,
    update: options.updateBlocked ? blocked(options.updateBlocked) : mutation,
    push: options.pushBlocked ? blocked(options.pushBlocked) : mutation,
  };
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
