import type {
  ReplacementApplyResult,
  ReplacementRecoverySummary,
  WorkspaceReplacementPreview,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchReport,
} from "../models.ts";

export interface WorkspaceOperationGateway {
  searchWorkspaceText(
    repositoryRoot: string,
    requestId: string,
    query: string,
    options: WorkspaceTextSearchOptions,
  ): Promise<WorkspaceTextSearchReport>;
  cancelWorkspaceTextSearch(repositoryRoot: string, requestId: string): Promise<void>;
  previewWorkspaceReplacement(
    repositoryRoot: string,
    planId: string,
    query: string,
    replacement: string,
    options: WorkspaceTextSearchOptions,
  ): Promise<WorkspaceReplacementPreview>;
  applyWorkspaceReplacement(
    repositoryRoot: string,
    planId: string,
    selectedPaths: string[],
  ): Promise<ReplacementApplyResult>;
  cancelWorkspaceReplacement(repositoryRoot: string, operationId: string): Promise<void>;
  listWorkspaceReplacementRecoveries(
    repositoryRoot: string,
  ): Promise<ReplacementRecoverySummary[]>;
  rollbackWorkspaceReplacement(
    repositoryRoot: string,
    recoveryId: string,
  ): Promise<ReplacementApplyResult>;
  finalizeWorkspaceReplacement(repositoryRoot: string, recoveryId: string): Promise<void>;
}

export interface WorkspaceOperationIdentity {
  readonly root: string;
  readonly generation: number;
}

export type WorkspaceOperationCompletion<T> =
  | { status: "success"; value: T }
  | { status: "failure"; error: unknown }
  | { status: "stale" };

export interface WorkspaceOperationStart<T> {
  readonly operationId: string;
  readonly completion: Promise<WorkspaceOperationCompletion<T>>;
}

export class WorkspaceOperationCoordinator {
  private searchSequence = 0;
  private replacementSequence = 0;
  private activeSearch: WorkspaceOperationIdentity & { operationId: string } | null = null;
  private activeReplacement: WorkspaceOperationIdentity & { operationId: string } | null = null;
  private readonly gateway: WorkspaceOperationGateway;
  private readonly currentIdentity: () => WorkspaceOperationIdentity | null;

  constructor(
    gateway: WorkspaceOperationGateway,
    currentIdentity: () => WorkspaceOperationIdentity | null,
  ) {
    this.gateway = gateway;
    this.currentIdentity = currentIdentity;
  }

  startSearch(
    identity: WorkspaceOperationIdentity,
    query: string,
    options: WorkspaceTextSearchOptions,
  ): WorkspaceOperationStart<WorkspaceTextSearchReport> {
    this.cancelSearch();
    const operationId = `workspace-search-${Date.now()}-${++this.searchSequence}`;
    const active = { ...identity, operationId };
    this.activeSearch = active;
    return {
      operationId,
      completion: this.complete(
        active,
        () => this.gateway.searchWorkspaceText(identity.root, operationId, query, options),
        () => this.activeSearch,
        () => {
          if (this.activeSearch === active) this.activeSearch = null;
        },
      ),
    };
  }

  cancelSearch(): void {
    const active = this.activeSearch;
    if (!active) return;
    this.activeSearch = null;
    void this.gateway
      .cancelWorkspaceTextSearch(active.root, active.operationId)
      .catch(() => undefined);
  }

  startReplacementPreview(
    identity: WorkspaceOperationIdentity,
    query: string,
    replacement: string,
    options: WorkspaceTextSearchOptions,
  ): WorkspaceOperationStart<WorkspaceReplacementPreview> {
    this.cancelReplacement();
    const operationId = `workspace-replace-${Date.now()}-${++this.replacementSequence}`;
    const active = { ...identity, operationId };
    this.activeReplacement = active;
    return {
      operationId,
      completion: this.complete(
        active,
        () => this.gateway.previewWorkspaceReplacement(
          identity.root,
          operationId,
          query,
          replacement,
          options,
        ),
        () => this.activeReplacement,
        () => undefined,
      ),
    };
  }

  async applyReplacement(
    identity: WorkspaceOperationIdentity,
    operationId: string,
    selectedPaths: string[],
  ): Promise<WorkspaceOperationCompletion<ReplacementApplyResult>> {
    const active = this.activeReplacement;
    if (!active || !sameOperation(active, { ...identity, operationId })) {
      return { status: "stale" };
    }
    return this.complete(
      active,
      () => this.gateway.applyWorkspaceReplacement(identity.root, operationId, selectedPaths),
      () => this.activeReplacement,
      () => {
        if (this.activeReplacement === active) this.activeReplacement = null;
      },
    );
  }

  cancelReplacement(): void {
    const active = this.activeReplacement;
    if (!active) return;
    this.activeReplacement = null;
    void this.gateway
      .cancelWorkspaceReplacement(active.root, active.operationId)
      .catch(() => undefined);
  }

  listRecoveries(repositoryRoot: string): Promise<ReplacementRecoverySummary[]> {
    return this.gateway.listWorkspaceReplacementRecoveries(repositoryRoot);
  }

  rollback(
    repositoryRoot: string,
    recoveryId: string,
  ): Promise<ReplacementApplyResult> {
    return this.gateway.rollbackWorkspaceReplacement(repositoryRoot, recoveryId);
  }

  finalize(repositoryRoot: string, recoveryId: string): Promise<void> {
    return this.gateway.finalizeWorkspaceReplacement(repositoryRoot, recoveryId);
  }

  private async complete<T>(
    active: WorkspaceOperationIdentity & { operationId: string },
    task: () => Promise<T>,
    currentOperation: () => (WorkspaceOperationIdentity & { operationId: string }) | null,
    finalize: () => void,
  ): Promise<WorkspaceOperationCompletion<T>> {
    try {
      const value = await task();
      if (!sameOperation(currentOperation(), active) || !sameIdentity(this.currentIdentity(), active)) {
        return { status: "stale" };
      }
      return { status: "success", value };
    } catch (error) {
      if (!sameOperation(currentOperation(), active) || !sameIdentity(this.currentIdentity(), active)) {
        return { status: "stale" };
      }
      return { status: "failure", error };
    } finally {
      finalize();
    }
  }
}

function sameIdentity(
  left: WorkspaceOperationIdentity | null,
  right: WorkspaceOperationIdentity,
): boolean {
  return left?.root === right.root && left.generation === right.generation;
}

function sameOperation(
  left: (WorkspaceOperationIdentity & { operationId: string }) | null,
  right: WorkspaceOperationIdentity & { operationId: string },
): boolean {
  return sameIdentity(left, right) && left?.operationId === right.operationId;
}
