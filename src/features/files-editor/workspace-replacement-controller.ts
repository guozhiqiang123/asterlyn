import type {
  ReplacementApplyResult,
  ReplacementRecoverySummary,
  SaveTextFileResult,
  TextFileSnapshot,
  WorkspaceReplacementDiff,
  WorkspaceReplacementFilePreview,
  WorkspaceReplacementPreview,
  WorkspaceTextSearchOptions,
} from "../../models.ts";
import type {
  WorkspaceOperationCompletion,
  WorkspaceOperationIdentity,
  WorkspaceOperationStart,
} from "../../application/workspace-operation-coordinator.ts";
import type { WorkspaceSearchRequest } from "./workspace-search.ts";
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
} from "./workspace-replacement.ts";

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
  readReplacementDiff(
    repositoryRoot: string,
    planId: string,
    workspacePath: string,
    expanded: boolean,
  ): Promise<WorkspaceReplacementDiff>;
  readReplacementFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
  ): Promise<TextFileSnapshot>;
  saveReplacementFile(
    repositoryRoot: string,
    repositoryId: string,
    path: string,
    expectedRevision: string,
    content: string,
    utf8Bom: boolean,
    requestId: string,
  ): Promise<SaveTextFileResult>;
}

export interface WorkspaceReplacementFileSession {
  readonly planId: string;
  readonly repositoryRoot: string;
  readonly repositoryId: string;
  readonly path: string;
  readonly workspacePath: string;
  readonly originalContent: string;
  readonly proposedContent: string;
  readonly content: string;
  readonly persistedContent: string;
  readonly utf8Bom: boolean;
  readonly revision: string;
  readonly status: "ready" | "saving" | "error";
  readonly error: string | null;
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
  private readonly fileSessions = new Map<string, WorkspaceReplacementFileSession>();
  private readonly fileSessionLoads = new Map<string, Promise<WorkspaceReplacementFileSession | null>>();
  private fileLoadGeneration = 0;
  private saveSequence = 0;

  constructor(operations: WorkspaceReplacementOperations) {
    this.operations = operations;
  }

  get state(): WorkspaceReplacementControllerState {
    return this.value;
  }

  reset(): void {
    this.cancelActive();
    this.clearFileSessions();
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
    this.clearFileSessions();
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
    return this.runPreview(identity, search.query, search.options, "preview", describeError);
  }

  async refreshPreview(
    identity: WorkspaceOperationIdentity,
    describeError: (error: unknown) => string,
  ): Promise<boolean> {
    const request = this.value.replacement.request;
    if (!request) return false;
    return this.runPreview(identity, request.query, request.options, this.value.dialog, describeError);
  }

  private async runPreview(
    identity: WorkspaceOperationIdentity,
    query: string,
    options: WorkspaceTextSearchOptions,
    dialog: WorkspaceReplacementDialog,
    describeError: (error: unknown) => string,
  ): Promise<boolean> {
    this.clearFileSessions();
    const preferredSelection = this.value.replacement.preview
      ? new Set(this.value.replacement.selectedPaths)
      : undefined;
    this.cancelActive();
    const operation = this.operations.startReplacementPreview(
      identity,
      query,
      this.value.text,
      options,
    );
    const started = beginReplacementPreview(
      this.value.replacement,
      identity.generation,
      identity.root,
      operation.operationId,
      query,
      this.value.text,
      options,
    );
    this.value = {
      ...this.value,
      replacement: started.state,
      dialog,
    };
    const completion = await operation.completion;
    if (completion.status === "stale") return false;
    const previous = this.value.replacement;
    const replacement = completion.status === "success"
      ? completeReplacementPreview(previous, started.request, completion.value, preferredSelection)
      : failReplacement(previous, started.request, describeError(completion.error));
    if (replacement === previous) return false;
    this.value = { ...this.value, replacement };
    return true;
  }

  hidePreview(): void {
    if (this.value.dialog === "preview" && this.value.replacement.status === "ready") {
      this.value = { ...this.value, dialog: null };
    }
  }

  showPreview(): void {
    if (this.value.replacement.status === "ready" && this.value.replacement.preview) {
      this.value = { ...this.value, dialog: "preview" };
    }
  }

  selectAll(selected: boolean): void {
    const replacement = selectAllReplacementFiles(this.value.replacement, selected);
    if (selected) {
      const selectedPaths = new Set(replacement.selectedPaths);
      for (const path of this.changedSessionPaths()) selectedPaths.delete(path);
      this.value = { ...this.value, replacement: { ...replacement, selectedPaths } };
    } else {
      this.value = { ...this.value, replacement };
    }
  }

  toggleFile(workspacePath: string): void {
    if (this.changedSessionPaths().has(workspacePath)) return;
    this.value = {
      ...this.value,
      replacement: toggleReplacementFile(this.value.replacement, workspacePath),
    };
  }

  closeDialog(): void {
    this.cancelActive();
    this.clearFileSessions();
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
    this.clearFileSessions();
    return { status: "success", request, selectedPaths, result: completion.value };
  }

  fileSession(workspacePath: string): WorkspaceReplacementFileSession | null {
    return this.fileSessions.get(workspacePath) ?? null;
  }

  changedSessionPaths(): ReadonlySet<string> {
    return new Set(Array.from(this.fileSessions.values())
      .filter((session) => session.content !== session.originalContent || session.persistedContent !== session.originalContent)
      .map((session) => session.workspacePath));
  }

  loadFileSession(
    file: WorkspaceReplacementFilePreview,
    describeError: (error: unknown) => string,
  ): Promise<WorkspaceReplacementFileSession | null> {
    const request = this.value.replacement.request;
    const preview = this.value.replacement.preview;
    if (!request || !preview || !preview.files.some((candidate) => candidate.workspacePath === file.workspacePath)) {
      return Promise.resolve(null);
    }
    const existing = this.fileSessions.get(file.workspacePath);
    if (existing?.planId === preview.planId) return Promise.resolve(existing);
    const loadKey = `${preview.planId}\0${file.workspacePath}`;
    const active = this.fileSessionLoads.get(loadKey);
    if (active) return active;
    const generation = this.fileLoadGeneration;
    const load = this.readFileSession(file, request.repositoryRoot, preview.planId, generation, existing, describeError)
      .finally(() => {
        if (this.fileSessionLoads.get(loadKey) === load) this.fileSessionLoads.delete(loadKey);
      });
    this.fileSessionLoads.set(loadKey, load);
    return load;
  }

  private async readFileSession(
    file: WorkspaceReplacementFilePreview,
    repositoryRoot: string,
    planId: string,
    generation: number,
    existing: WorkspaceReplacementFileSession | undefined,
    describeError: (error: unknown) => string,
  ): Promise<WorkspaceReplacementFileSession | null> {
    try {
      const [comparison, snapshot] = await Promise.all([
        this.operations.readReplacementDiff(repositoryRoot, planId, file.workspacePath, false),
        this.operations.readReplacementFile(repositoryRoot, file.repositoryId, file.path),
      ]);
      if (
        generation !== this.fileLoadGeneration ||
        this.value.replacement.preview?.planId !== planId
      ) return null;
      const session: WorkspaceReplacementFileSession = {
        planId,
        repositoryRoot,
        repositoryId: file.repositoryId,
        path: file.path,
        workspacePath: file.workspacePath,
        originalContent: comparison.originalContent,
        proposedContent: comparison.proposedContent,
        content: snapshot.content,
        persistedContent: snapshot.content,
        utf8Bom: snapshot.utf8Bom,
        revision: snapshot.revision,
        status: "ready",
        error: null,
      };
      this.fileSessions.set(file.workspacePath, session);
      return session;
    } catch (error) {
      if (generation !== this.fileLoadGeneration) return null;
      const failed = existing ? { ...existing, status: "error" as const, error: describeError(error) } : null;
      if (failed) this.fileSessions.set(file.workspacePath, failed);
      return failed;
    }
  }

  updateFileContent(workspacePath: string, content: string): WorkspaceReplacementFileSession | null {
    const session = this.fileSessions.get(workspacePath);
    if (!session || session.status === "saving" || session.content === content) return session ?? null;
    const next = { ...session, content, status: "ready" as const, error: null };
    this.fileSessions.set(workspacePath, next);
    if (content !== session.originalContent) {
      const selectedPaths = new Set(this.value.replacement.selectedPaths);
      selectedPaths.delete(workspacePath);
      this.value = { ...this.value, replacement: { ...this.value.replacement, selectedPaths } };
    }
    return next;
  }

  async saveFileSession(
    workspacePath: string,
    describeError: (error: unknown) => string,
  ): Promise<{ status: "saved"; session: WorkspaceReplacementFileSession } | { status: "failure"; error: unknown } | { status: "stale" }> {
    const session = this.fileSessions.get(workspacePath);
    if (!session || session.status === "saving") return { status: "stale" };
    if (session.content === session.persistedContent) return { status: "saved", session };
    const saving = { ...session, status: "saving" as const, error: null };
    this.fileSessions.set(workspacePath, saving);
    const requestId = `replacement-file-save-${Date.now()}-${++this.saveSequence}`;
    try {
      const result = await this.operations.saveReplacementFile(
        session.repositoryRoot,
        session.repositoryId,
        session.path,
        session.revision,
        session.content,
        session.utf8Bom,
        requestId,
      );
      if (this.fileSessions.get(workspacePath) !== saving) return { status: "stale" };
      const saved: WorkspaceReplacementFileSession = {
        ...saving,
        persistedContent: saving.content,
        revision: result.revision,
        status: "ready",
        error: null,
      };
      this.fileSessions.set(workspacePath, saved);
      if (saved.persistedContent !== saved.originalContent) {
        const selectedPaths = new Set(this.value.replacement.selectedPaths);
        selectedPaths.delete(workspacePath);
        this.value = {
          ...this.value,
          replacement: { ...this.value.replacement, selectedPaths },
        };
      }
      return { status: "saved", session: saved };
    } catch (error) {
      if (this.fileSessions.get(workspacePath) === saving) {
        this.fileSessions.set(workspacePath, {
          ...saving,
          status: "error",
          error: describeError(error),
        });
      }
      return { status: "failure", error };
    }
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
    this.clearFileSessions();
  }

  private cancelActive(): void {
    const replacement = this.value.replacement;
    if (
      replacement.request &&
      ["previewing", "ready", "applying"].includes(replacement.status)
    ) this.operations.cancelReplacement();
  }

  private clearFileSessions(): void {
    this.fileLoadGeneration += 1;
    this.fileSessionLoads.clear();
    this.fileSessions.clear();
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
