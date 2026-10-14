import type { Localization } from "../../localization/localization.ts";
import { remotePolicy } from "../../remote-policy.ts";
import type {
  BranchSummary,
  RepositoryMutationOutcome,
  RepositorySnapshot,
} from "../../models.ts";
import type { BranchContextTarget } from "./branch-context-binding.ts";

type BranchRemoteAction = "pull" | "push";

export interface BranchRemoteActionRuntimePorts {
  readonly snapshot: () => RepositorySnapshot | null;
  readonly targetCurrent: (target: BranchContextTarget) => boolean;
  readonly localization: () => Localization;
  readonly selectedRemote: () => string | null;
  readonly remoteOperation: () => { readonly kind: "fetch" | "pull" | "push" } | null;
  readonly workbenchBusy: () => boolean;
  readonly activateCurrent: (kind: BranchRemoteAction, anchor: HTMLElement) => Promise<void>;
  readonly openBranchPush: (sourceBranch: string, remoteName: string) => boolean;
  readonly focusPushDialog: (anchor: HTMLElement) => void;
  readonly updateLocalBranch: (
    repositoryRoot: string,
    sourceBranch: string,
    expectedOid: string,
    operationId: string,
  ) => Promise<RepositoryMutationOutcome>;
  readonly beginTransition: () => number;
  readonly matches: (generation: number, repositoryRoot: string) => boolean;
  readonly completeTransition: (generation: number) => void;
  readonly currentGeneration: () => number;
  readonly acceptRemoteOutcome: (outcome: RepositoryMutationOutcome) => void;
  readonly clearError: () => void;
  readonly setLoading: (loading: boolean, message: string) => void;
  readonly setStatus: (message: string, kind: "warning" | "success") => void;
  readonly showWarning: (message: string) => void;
  readonly showInformation: (message: string) => void;
  readonly showError: (error: unknown) => void;
  readonly describeError: (error: unknown) => string;
}

export class BranchRemoteActionRuntime {
  private readonly ports: BranchRemoteActionRuntimePorts;

  constructor(ports: BranchRemoteActionRuntimePorts) {
    this.ports = ports;
  }

  blockedReason(
    kind: BranchRemoteAction,
    target: BranchContextTarget | null = null,
  ): string | null {
    if (!target || target.branch.current) return this.currentBlockedReason(kind);
    const localization = this.ports.localization();
    const remoteCopy = localization.catalog.remote;
    const branchCopy = localization.catalog.history.branchContextMenu;
    const snapshot = this.ports.snapshot();
    if (!snapshot || !this.ports.targetCurrent(target)) return branchCopy.targetChanged;
    if (this.ports.remoteOperation() || snapshot.operation) {
      return remoteCopy.unavailable(branchCopy.busy);
    }
    if (this.ports.workbenchBusy()) return remoteCopy.unavailable(remoteCopy.workbenchBusy);
    if (
      target.branch.kind !== "local" ||
      target.matches.length !== 1 ||
      target.branch.repositoryId !== "."
    ) return branchCopy.targetChanged;
    if (kind === "pull") return this.updateBlockedReason(target.branch, snapshot, localization);
    const remoteName = this.remoteName(target.branch, snapshot);
    if (!remoteName) return remoteCopy.unavailable(remoteCopy.policy.selectConfigured);
    const remote = snapshot.remotes.find((candidate) => candidate.name === remoteName);
    return remote?.pushSupported
      ? null
      : remoteCopy.unavailable(remoteCopy.policy.unsupportedPush);
  }

  async activate(
    kind: BranchRemoteAction,
    target: BranchContextTarget,
    anchor: HTMLElement,
  ): Promise<void> {
    if (target.branch.current) {
      await this.ports.activateCurrent(kind, anchor);
      return;
    }
    const blocked = this.blockedReason(kind, target);
    if (blocked) {
      this.ports.showWarning(blocked);
      return;
    }
    if (!this.ports.targetCurrent(target)) {
      this.ports.showWarning(this.ports.localization().catalog.history.branchContextMenu.targetChanged);
      return;
    }
    if (kind === "pull") {
      await this.update(target);
      return;
    }
    const snapshot = this.ports.snapshot();
    const remoteName = snapshot ? this.remoteName(target.branch, snapshot) : null;
    if (!remoteName || !this.ports.openBranchPush(target.branch.fullName, remoteName)) {
      this.ports.showWarning(
        this.blockedReason("push", target) ??
          this.ports.localization().catalog.remote.actionStateChanged(
            this.ports.localization().catalog.remote.actionNames.push,
          ),
      );
      return;
    }
    this.ports.focusPushDialog(anchor);
  }

  private currentBlockedReason(kind: BranchRemoteAction): string | null {
    const localization = this.ports.localization();
    const copy = localization.catalog.remote;
    const snapshot = this.ports.snapshot();
    if (!snapshot) return kind === "pull" ? copy.updateUnavailable : copy.pushUnavailable;
    const operation = this.ports.remoteOperation();
    if (operation) {
      return copy.unavailable(copy.operationInProgress(copy.actionNames[operation.kind]));
    }
    if (this.ports.workbenchBusy()) return copy.unavailable(copy.workbenchBusy);
    const policy = remotePolicy(snapshot, this.ports.selectedRemote(), localization);
    if (!policy[kind].enabled || (kind === "push" && !policy.selectedRemote)) {
      return copy.unavailable(policy[kind].detail);
    }
    return null;
  }

  private updateBlockedReason(
    branch: BranchSummary,
    snapshot: RepositorySnapshot,
    localization: Localization,
  ): string | null {
    const remoteCopy = localization.catalog.remote;
    const branchCopy = localization.catalog.history.branchContextMenu;
    if (branch.primaryWorktreePath || branch.linkedWorktreePath) {
      return remoteCopy.unavailable(branchCopy.worktreeCheckedOut);
    }
    if (!branch.upstreamRemote || !branch.upstreamRef) {
      return remoteCopy.unavailable(remoteCopy.policy.publishOrConfigure);
    }
    const upstream = snapshot.remotes.find((remote) => remote.name === branch.upstreamRemote);
    if (!upstream) {
      return remoteCopy.unavailable(remoteCopy.policy.selectNamedUpstream(branch.upstreamRemote));
    }
    return upstream.fetchSupported
      ? null
      : remoteCopy.unavailable(remoteCopy.policy.unsupportedUpstream);
  }

  private remoteName(branch: BranchSummary, snapshot: RepositorySnapshot): string | null {
    if (branch.upstreamRemote) return branch.upstreamRemote;
    const selected = snapshot.remotes.find(
      (remote) => remote.name === this.ports.selectedRemote(),
    );
    return selected?.name ?? snapshot.remotes.find((remote) => remote.name === "origin")?.name ??
      snapshot.remotes[0]?.name ?? null;
  }

  private async update(target: BranchContextTarget): Promise<void> {
    const snapshot = this.ports.snapshot();
    if (!snapshot || !this.ports.targetCurrent(target)) return;
    const generation = this.ports.beginTransition();
    const copy = this.ports.localization().catalog.history.branchContextMenu;
    this.ports.clearError();
    this.ports.setLoading(true, copy.updating(target.branch.name));
    try {
      const outcome = await this.ports.updateLocalBranch(
        snapshot.root,
        target.branch.fullName,
        target.branch.oid,
        `${generation}-branch-update-${Date.now()}`,
      );
      if (!this.ports.matches(generation, snapshot.root)) return;
      this.ports.acceptRemoteOutcome(outcome);
      this.ports.showInformation(copy.updated(target.branch.name));
    } catch (error) {
      if (!this.ports.matches(generation, snapshot.root)) return;
      this.ports.showError(error);
      this.ports.setStatus(this.ports.describeError(error), "warning");
    } finally {
      this.ports.completeTransition(generation);
      if (generation === this.ports.currentGeneration()) {
        this.ports.setLoading(false, this.ports.localization().catalog.common.ready);
      }
    }
  }
}
