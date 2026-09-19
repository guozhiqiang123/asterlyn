import type {
  ReplacementApplyResult,
  ReplacementRecoverySummary,
  WorkspaceReplacementPreview,
  WorkspaceTextSearchOptions,
} from "../../models.ts";
import type {
  WorkspaceOperationCompletion,
  WorkspaceOperationIdentity,
  WorkspaceOperationStart,
} from "../../application/workspace-operation-coordinator.ts";
import type { WorkspaceSearchRequest } from "../../workbench/workspace-search.ts";
import {
  beginReplacementApply,
  beginReplacementPreview,
  closeReplacementPreview,
  completeReplacementApply,
  completeReplacementPreview,
  createWorkspaceReplacementState,
  failReplacement,
  selectAllReplacementFiles,
  setReplacementRecoveries,
  toggleReplacementFile,
  type WorkspaceReplacementRequest,
  type WorkspaceReplacementState,
} from "../../workbench/workspace-replacement.ts";

export type WorkspaceReplacementDialog = "preview" | "recovery" | null;
export type WorkspaceReplacementRecoveryAction = "keep" | "rollback";

export interface WorkspaceReplacementOperations {
  startReplacementPreview(
    identity: WorkspaceOperationIdentity,
    query: string,
    replacement: string,
    options: WorkspaceTextSearchOptions,
  ): WorkspaceOperationStart<WorkspaceReplacementPreview>;
  applyReplacement(
    identity: WorkspaceOperationIdentity,
    operationId: string,
    selectedPaths: string[],
  ): Promise<WorkspaceOperationCompletion<ReplacementApplyResult>>;
  cancelReplacement(): void;
  listRecoveries(repositoryRoot: string): Promise<ReplacementRecoverySummary[]>;
  rollback(repositoryRoot: string, recoveryId: string): Promise<ReplacementApplyResult>;
  finalize(repositoryRoot: string, recoveryId: string): Promise<void>;
}

export interface WorkspaceReplacementControllerState {
  readonly replacement: WorkspaceReplacementState;
  readonly text: string;
  readonly dialog: WorkspaceReplacementDialog;
  readonly recoveryBusy: {
    id: string;
    action: WorkspaceReplacementRecoveryAction;
  } | null;
}

export type WorkspaceReplacementApplyOutcome =
  | {
      status: "success";
      request: WorkspaceReplacementRequest;
      selectedPaths: string[];
      result: ReplacementApplyResult;
    }
  | { status: "failure"; error: unknown }
  | { status: "stale" };

export type WorkspaceReplacementRecoveryOutcome =
  | {
      status: "success";
      paths: string[];
      result: ReplacementApplyResult | null;
    }
  | { status: "failure"; error: unknown }
  | { status: "stale" };

export class WorkspaceReplacementController {
  private readonly operations: WorkspaceReplacementOperations;
  private value: WorkspaceReplacementControllerState = initialState();

  constructor(operations: WorkspaceReplacementOperations) {
    this.operations = operations;
  }

  get state(): WorkspaceReplacementControllerState {
    return this.value;
  }

  reset(): void {
    this.cancelActive();
    this.value = {
      replacement: createWorkspaceReplacementState(),
      text: this.value.text,
      dialog: null,
      recoveryBusy: null,
    };
  }

  setText(text: string): void {
    this.value = { ...this.value, text };
  }

  openRecoveries(): void {
    this.value = { ...this.value, dialog: "recovery" };
  }

  invalidatePreview(): boolean {
    if (this.value.replacement.status === "applying") return false;
    this.cancelActive();
    this.value = {
      ...this.value,
      replacement: closeReplacementPreview(this.value.replacement),
      dialog: this.value.dialog === "preview" ? null : this.value.dialog,
    };
    return true;
  }

  async preview(
    identity: WorkspaceOperationIdentity,
    search: WorkspaceSearchRequest,
    describeError: (error: unknown) => string,
  ): Promise<boolean> {
    this.cancelActive();
    const operation = this.operations.startReplacementPreview(
      identity,
      search.query,
      this.value.text,
      search.options,
    );
    const started = beginReplacementPreview(
      this.value.replacement,
      identity.generation,
      identity.root,
      operation.operationId,
      search.query,
      this.value.text,
      search.options,
    );
    this.value = {
      ...this.value,
      replacement: started.state,
      dialog: "preview",
    };
    const completion = await operation.completion;
    if (completion.status === "stale") return false;
    const previous = this.value.replacement;
    const replacement = completion.status === "success"
      ? completeReplacementPreview(previous, started.request, completion.value)
      : failReplacement(previous, started.request, describeError(completion.error));
    if (replacement === previous) return false;
    this.value = { ...this.value, replacement };
    return true;
  }

  selectAll(selected: boolean): void {
    this.value = {
      ...this.value,
      replacement: selectAllReplacementFiles(this.value.replacement, selected),
    };
  }

  toggleFile(workspacePath: string): void {
    this.value = {
      ...this.value,
      replacement: toggleReplacementFile(this.value.replacement, workspacePath),
    };
  }

  closeDialog(): void {
    this.cancelActive();
    this.value = {
      ...this.value,
      replacement: closeReplacementPreview(this.value.replacement),
      dialog: null,
    };
  }

  requestCancellation(message: string): "closed" | "requested" | "ignored" {
    if (this.value.replacement.status === "previewing") {
      this.closeDialog();
      return "closed";
    }
    if (this.value.replacement.status !== "applying") return "ignored";
    this.cancelActive();
    this.value = {
      ...this.value,
      replacement: { ...this.value.replacement, error: message },
    };
    return "requested";
  }

  setError(message: string): void {
    this.value = {
      ...this.value,
      replacement: { ...this.value.replacement, error: message },
    };
  }

  async apply(
    repositoryRoot: string,
    describeError: (error: unknown) => string,
  ): Promise<WorkspaceReplacementApplyOutcome> {
    const request = this.value.replacement.request;
    const preview = this.value.replacement.preview;
    if (!request || !preview || this.value.replacement.status !== "ready") {
      return { status: "stale" };
    }
    const selectedPaths = [...this.value.replacement.selectedPaths];
    const replacement = beginReplacementApply(this.value.replacement);
    if (replacement === this.value.replacement) return { status: "stale" };
    this.value = { ...this.value, replacement };
    const completion = await this.operations.applyReplacement(
      { root: repositoryRoot, generation: request.repositoryGeneration },
      preview.planId,
      selectedPaths,
    );
    if (completion.status === "stale") return { status: "stale" };
    if (completion.status === "failure") {
      this.value = {
        ...this.value,
        replacement: failReplacement(
          this.value.replacement,
          request,
          describeError(completion.error),
        ),
      };
      return { status: "failure", error: completion.error };
    }
    this.value = {
      ...this.value,
      replacement: completeReplacementApply(
        this.value.replacement,
        request,
        completion.value,
      ),
      dialog: completion.value.status === "rolledBack" ? null : "recovery",
    };
    return { status: "success", request, selectedPaths, result: completion.value };
  }

  async loadRecoveries(
    repositoryRoot: string,
    isCurrent: () => boolean,
  ): Promise<
    | { status: "success"; recoveries: ReplacementRecoverySummary[] }
    | { status: "failure"; error: unknown }
    | { status: "stale" }
  > {
    this.value = {
      ...this.value,
      replacement: { ...this.value.replacement, recoveriesLoading: true },
    };
    try {
      const recoveries = await this.operations.listRecoveries(repositoryRoot);
      if (!isCurrent()) return { status: "stale" };
      this.value = {
        ...this.value,
        replacement: setReplacementRecoveries(this.value.replacement, recoveries),
      };
      return { status: "success", recoveries };
    } catch (error) {
      if (!isCurrent()) return { status: "stale" };
      this.value = {
        ...this.value,
        replacement: { ...this.value.replacement, recoveriesLoading: false },
      };
      return { status: "failure", error };
    }
  }

  async resolveRecovery(
    repositoryRoot: string,
    recoveryId: string,
    action: WorkspaceReplacementRecoveryAction,
  ): Promise<WorkspaceReplacementRecoveryOutcome> {
    const recovery = this.value.replacement.recoveries.find(
      (candidate) => candidate.recoveryId === recoveryId,
    );
    if (!recovery || this.value.recoveryBusy) return { status: "stale" };
    const busy = { id: recoveryId, action } as const;
    const paths = recovery.files.map((file) => file.workspacePath);
    this.value = { ...this.value, recoveryBusy: busy };
    try {
      const result = action === "keep"
        ? await this.operations.finalize(repositoryRoot, recoveryId).then(() => null)
        : await this.operations.rollback(repositoryRoot, recoveryId);
      if (this.value.recoveryBusy !== busy) return { status: "stale" };
      this.value = { ...this.value, recoveryBusy: null };
      return { status: "success", paths, result };
    } catch (error) {
      if (this.value.recoveryBusy === busy) {
        this.value = { ...this.value, recoveryBusy: null };
      }
      return { status: "failure", error };
    }
  }

  reconcileRecoveryDialog(): number {
    const unresolved = this.value.replacement.recoveries.length;
    this.value = { ...this.value, dialog: unresolved > 0 ? "recovery" : null };
    return unresolved;
  }

  openRecoveryAfterFailure(): void {
    if (this.value.replacement.recoveries.length > 0) {
      this.value = { ...this.value, dialog: "recovery" };
    }
  }

  dispose(): void {
    this.cancelActive();
  }

  private cancelActive(): void {
    const replacement = this.value.replacement;
    if (
      replacement.request &&
      ["previewing", "ready", "applying"].includes(replacement.status)
    ) this.operations.cancelReplacement();
  }
}

function initialState(): WorkspaceReplacementControllerState {
  return {
    replacement: createWorkspaceReplacementState(),
    text: "",
    dialog: null,
    recoveryBusy: null,
  };
}
