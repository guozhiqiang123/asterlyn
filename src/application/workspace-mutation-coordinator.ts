import type {
  WorkspaceCollisionPolicy,
  WorkspaceMutationOperation,
  WorkspaceMutationOutcome,
  WorkspaceMutationPreview,
  WorkspaceMutationRecoverySummary,
} from "../models.ts";
import type { EditorPathMutationRequest } from "../editor-path-mutation.ts";
import type {
  EditorPathMigrationLease,
  EditorPathMigrationPreparation,
  EditorPathRuntimeChange,
} from "./editor-session-port.ts";
import type { WorkspaceOperationIdentity } from "./workspace-operation-coordinator.ts";

export type WorkspaceMutationIdentity = WorkspaceOperationIdentity;

export interface WorkspaceMutationGateway {
  planWorkspaceMutation(
    repositoryRoot: string,
    planId: string,
    operation: WorkspaceMutationOperation,
    collisionPolicy: WorkspaceCollisionPolicy,
  ): Promise<WorkspaceMutationPreview>;
  executeWorkspaceMutation(
    repositoryRoot: string,
    planId: string,
  ): Promise<WorkspaceMutationOutcome>;
  cancelWorkspaceMutation(repositoryRoot: string, planId: string): Promise<void>;
  listWorkspaceMutationRecoveries(
    repositoryRoot: string,
  ): Promise<WorkspaceMutationRecoverySummary[]>;
}

export interface WorkspaceMutationEditorPort {
  preparePathMigration(
    repositoryRoot: string,
    request: EditorPathMutationRequest,
  ): EditorPathMigrationPreparation;
  applyPathMigration(
    lease: EditorPathMigrationLease,
    applyRuntime: (change: EditorPathRuntimeChange) => boolean,
  ): "applied" | "stale" | "runtime-conflict";
  releasePathMigration(lease: EditorPathMigrationLease): void;
}

export interface WorkspaceMutationReconciliationLease {
  readonly root: string;
  readonly generation: number;
}

export type WorkspaceMutationReconciliationResult =
  | { status: "accepted" }
  | { status: "stale" }
  | { status: "failure"; error: unknown };

export interface WorkspaceMutationReconciliationPort {
  begin(identity: WorkspaceMutationIdentity): WorkspaceMutationReconciliationLease | null;
  accept(
    lease: WorkspaceMutationReconciliationLease,
    outcome: WorkspaceMutationOutcome,
  ): Promise<WorkspaceMutationReconciliationResult>;
  settle(lease: WorkspaceMutationReconciliationLease): void;
}

export type WorkspaceMutationPlanResult =
  | { status: "ready"; preview: WorkspaceMutationPreview }
  | {
      status: "blocked";
      source: "workspace" | "editor";
      preview: WorkspaceMutationPreview;
      reason: string;
    }
  | { status: "stale" }
  | { status: "busy" }
  | { status: "failure"; error: unknown };

export type WorkspaceMutationExecutionResult =
  | { status: "completed"; outcome: WorkspaceMutationOutcome }
  | { status: "stale" }
  | { status: "busy" }
  | {
      status: "reconciliation-required";
      outcome: WorkspaceMutationOutcome;
      error: unknown;
    }
  | {
      status: "editor-conflict";
      outcome: WorkspaceMutationOutcome;
      reason: "stale" | "runtime-conflict";
    }
  | { status: "failure"; error: unknown };

interface ActiveMutation {
  identity: WorkspaceMutationIdentity;
  planId: string;
  operation: WorkspaceMutationOperation;
  phase: "planning" | "review" | "executing" | "reconciling" | "cancelling";
  editorLease: EditorPathMigrationLease | null;
}

export class WorkspaceMutationCoordinator {
  private readonly gateway: WorkspaceMutationGateway;
  private readonly editor: WorkspaceMutationEditorPort;
  private readonly applyEditorRuntime: (change: EditorPathRuntimeChange) => boolean;
  private readonly reconciliation: WorkspaceMutationReconciliationPort;
  private active: ActiveMutation | null = null;
  private sequence = 0;
  private disposed = false;

  constructor(
    gateway: WorkspaceMutationGateway,
    editor: WorkspaceMutationEditorPort,
    applyEditorRuntime: (change: EditorPathRuntimeChange) => boolean,
    reconciliation: WorkspaceMutationReconciliationPort,
  ) {
    this.gateway = gateway;
    this.editor = editor;
    this.applyEditorRuntime = applyEditorRuntime;
    this.reconciliation = reconciliation;
  }

  plan(
    identity: WorkspaceMutationIdentity,
    operation: WorkspaceMutationOperation,
    collisionPolicy: WorkspaceCollisionPolicy,
    editorRequest: EditorPathMutationRequest | null = null,
  ): { planId: string; completion: Promise<WorkspaceMutationPlanResult> } {
    if (
      this.disposed ||
      this.active?.phase === "executing" ||
      this.active?.phase === "reconciling" ||
      this.active?.phase === "cancelling"
    ) {
      return { planId: "", completion: Promise.resolve({ status: "busy" }) };
    }
    this.cancel();
    const planId = `workspace-mutation-${Date.now()}-${++this.sequence}`;
    const active: ActiveMutation = {
      identity: { ...identity },
      planId,
      operation,
      phase: "planning",
      editorLease: null,
    };
    this.active = active;
    const completion = this.completePlan(active, collisionPolicy, editorRequest);
    return { planId, completion };
  }

  async execute(
    identity: WorkspaceMutationIdentity,
    planId: string,
    options?: { readonly reconcile?: boolean },
  ): Promise<WorkspaceMutationExecutionResult> {
    const active = this.active;
    if (!active || !sameMutation(active, identity, planId)) return { status: "stale" };
    if (active.phase !== "review") return { status: "busy" };
    const reconcile = options?.reconcile !== false;
    const reconciliationLease = reconcile ? this.reconciliation.begin(identity) : null;
    if (reconcile && !reconciliationLease) {
      this.releaseEditorLease(active);
      this.active = null;
      return { status: "stale" };
    }
    active.phase = "executing";
    try {
      let outcome: WorkspaceMutationOutcome;
      try {
        outcome = await this.gateway.executeWorkspaceMutation(identity.root, planId);
      } catch (error) {
        if (this.active !== active) {
          this.releaseEditorLease(active);
          return { status: "stale" };
        }
        this.releaseEditorLease(active);
        this.active = null;
        return { status: "failure", error };
      }

      if (this.disposed || this.active !== active) {
        this.releaseEditorLease(active);
        if (this.active === active) this.active = null;
        return { status: "stale" };
      }

      const resultIsCurrent = outcome.planId === planId;
      let editorConflict: "stale" | "runtime-conflict" | null = null;
      if (resultIsCurrent && outcome.status === "completed" && active.editorLease) {
        const applied = this.editor.applyPathMigration(
          active.editorLease,
          this.applyEditorRuntime,
        );
        if (applied !== "applied") editorConflict = applied;
        active.editorLease = null;
      } else {
        this.releaseEditorLease(active);
      }

      if (!reconcile) {
        this.active = null;
        if (!resultIsCurrent) {
          return { status: "failure", error: new Error("Workspace mutation result is stale.") };
        }
        if (editorConflict) {
          return { status: "editor-conflict", outcome, reason: editorConflict };
        }
        return { status: "completed", outcome };
      }

      active.phase = "reconciling";
      let reconciliation: WorkspaceMutationReconciliationResult;
      try {
        reconciliation = await this.reconciliation.accept(reconciliationLease!, outcome);
      } catch (error) {
        reconciliation = { status: "failure", error };
      }
      if (this.disposed || this.active !== active) return { status: "stale" };
      this.active = null;
      if (reconciliation.status === "stale") return { status: "stale" };
      if (reconciliation.status === "failure") {
        return {
          status: "reconciliation-required",
          outcome,
          error: reconciliation.error,
        };
      }
      if (!resultIsCurrent) {
        return { status: "failure", error: new Error("Workspace mutation result is stale.") };
      }
      if (editorConflict) {
        return { status: "editor-conflict", outcome, reason: editorConflict };
      }
      return { status: "completed", outcome };
    } finally {
      if (reconciliationLease) this.reconciliation.settle(reconciliationLease);
    }
  }

  async reconcile(
    identity: WorkspaceMutationIdentity,
    outcome: WorkspaceMutationOutcome,
  ): Promise<WorkspaceMutationReconciliationResult> {
    if (this.disposed) return { status: "stale" };
    const reconciliationLease = this.reconciliation.begin(identity);
    if (!reconciliationLease) return { status: "stale" };
    try {
      return await this.reconciliation.accept(reconciliationLease, outcome);
    } catch (error) {
      return { status: "failure", error };
    } finally {
      this.reconciliation.settle(reconciliationLease);
    }
  }

  cancel(): void {
    const active = this.active;
    if (!active) return;
    void this.gateway.cancelWorkspaceMutation(active.identity.root, active.planId).catch(() => undefined);
    if (
      active.phase === "executing" ||
      active.phase === "reconciling" ||
      active.phase === "cancelling"
    ) {
      active.phase = "cancelling";
      return;
    }
    this.releaseEditorLease(active);
    this.active = null;
  }

  listRecoveries(repositoryRoot: string): Promise<WorkspaceMutationRecoverySummary[]> {
    return this.gateway.listWorkspaceMutationRecoveries(repositoryRoot);
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
  }

  private async completePlan(
    active: ActiveMutation,
    collisionPolicy: WorkspaceCollisionPolicy,
    editorRequest: EditorPathMutationRequest | null,
  ): Promise<WorkspaceMutationPlanResult> {
    if (!validEditorRequest(active.operation, editorRequest)) {
      this.active = null;
      return { status: "failure", error: new Error("Workspace mutation editor identity is invalid.") };
    }
    try {
      const preview = await this.gateway.planWorkspaceMutation(
        active.identity.root,
        active.planId,
        active.operation,
        collisionPolicy,
      );
      if (this.active !== active || active.phase !== "planning") return { status: "stale" };
      if (preview.planId !== active.planId || !sameOperation(preview.operation, active.operation)) {
        this.active = null;
        void this.gateway
          .cancelWorkspaceMutation(active.identity.root, active.planId)
          .catch(() => undefined);
        return { status: "failure", error: new Error("Workspace mutation plan is stale.") };
      }
      if (preview.blockers.length > 0) {
        this.active = null;
        return {
          status: "blocked",
          source: "workspace",
          preview,
          reason: preview.blockers[0]!.kind,
        };
      }
      if (editorRequest) {
        const prepared = this.editor.preparePathMigration(active.identity.root, editorRequest);
        if (prepared.status !== "ready") {
          this.active = null;
          void this.gateway
            .cancelWorkspaceMutation(active.identity.root, active.planId)
            .catch(() => undefined);
          return {
            status: "blocked",
            source: "editor",
            preview,
            reason: prepared.status === "blocked" ? prepared.reason : "stale",
          };
        }
        active.editorLease = prepared.lease;
      }
      active.phase = "review";
      return { status: "ready", preview };
    } catch (error) {
      if (this.active !== active) return { status: "stale" };
      this.active = null;
      return { status: "failure", error };
    }
  }

  private releaseEditorLease(active: ActiveMutation): void {
    if (!active.editorLease) return;
    this.editor.releasePathMigration(active.editorLease);
    active.editorLease = null;
  }
}

function sameMutation(
  active: ActiveMutation,
  identity: WorkspaceMutationIdentity,
  planId: string,
): boolean {
  return active.planId === planId &&
    active.identity.root === identity.root &&
    active.identity.generation === identity.generation;
}

function validEditorRequest(
  operation: WorkspaceMutationOperation,
  request: EditorPathMutationRequest | null,
): boolean {
  if (operation.kind === "move") {
    return request?.kind === "move" &&
      request.mapping.sourceWorkspacePath === operation.source &&
      request.mapping.destinationWorkspacePath === operation.destination;
  }
  if (operation.kind === "trash") {
    return request?.kind === "trash" && request.sourceWorkspacePath === operation.source;
  }
  return request === null;
}

function sameOperation(
  left: WorkspaceMutationOperation,
  right: WorkspaceMutationOperation,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "createFile" && right.kind === "createFile") {
    return left.destination === right.destination;
  }
  if (left.kind === "copy" && right.kind === "copy") {
    return left.source === right.source && left.destination === right.destination;
  }
  if (left.kind === "move" && right.kind === "move") {
    return left.source === right.source && left.destination === right.destination;
  }
  return left.kind === "trash" && right.kind === "trash" && left.source === right.source;
}
