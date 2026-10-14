import type {
  SystemFileClipboardEntry,
  SystemFileClipboardImportResult,
  WorkspaceEntryInspection,
  WorkspaceMutationRecoveryAction,
  WorkspaceMutationRecoverySummary,
  WorkspaceMutationOperation,
  WorkspaceMutationOutcome,
} from "../../models.ts";
import type {
  WorkspaceMutationExecutionResult,
  WorkspaceMutationIdentity,
  WorkspaceMutationPlanResult,
  WorkspaceMutationReconciliationResult,
} from "../../application/workspace-mutation-coordinator.ts";
import type { EditorPathMutationRequest } from "../../editor-path-mutation.ts";
import type { NewFileStagePreference } from "../../preferences.ts";
import { isProjectWorkspaceRootPath } from "../../presentation/project-tree.ts";
import type { ProjectFilesContextTarget } from "./project-files-binding.ts";
import {
  baseName,
  completedOutcome,
  destinationDirectory,
  executionFailure,
  isAtOrBelow,
  joinPath,
  parentPath,
  planFailure,
  recoveryPaths,
  targetFromEdit,
  validateWorkspaceEntryName,
} from "./project-files-operation-helpers.ts";
import type { ProjectFilesOperationMessages } from "./project-files-operation-types.ts";
import {
  WorkspaceFileClipboard,
  workspaceFileClipboardMatchesPreview,
  type WorkspaceFileClipboardEntry,
  type WorkspaceFileClipboardMode,
} from "./workspace-file-clipboard.ts";

export { destinationDirectory, validateWorkspaceEntryName } from "./project-files-operation-helpers.ts";
export type { ProjectFilesOperationMessages } from "./project-files-operation-types.ts";

export interface ProjectFilesInlineEdit {
  readonly kind: "create" | "rename";
  readonly anchorPath: string;
  readonly anchorKind: "file" | "directory";
  readonly parentPath: string;
  readonly sourcePath: string | null;
  readonly sourceKind: "file" | "directory" | null;
  value: string;
  error: string | null;
  busy: boolean;
}

export type ProjectFilesOperationDialog =
  | {
      readonly kind: "paste-name";
      readonly target: ProjectFilesContextTarget;
      value: string;
      error: string | null;
      busy: boolean;
    }
  | {
      readonly kind: "stage-created";
      readonly target: ProjectFilesContextTarget;
      readonly destination: string;
      remember: boolean;
      error: string | null;
      busy: boolean;
    }
  | {
      readonly kind: "recovery";
    };

export interface ProjectFilesOperationState {
  readonly inlineEdit: ProjectFilesInlineEdit | null;
  readonly dialog: ProjectFilesOperationDialog | null;
  readonly busyPath: string | null;
  readonly recoveryIdentity: WorkspaceMutationIdentity | null;
  readonly recoveries: readonly WorkspaceMutationRecoverySummary[];
  readonly recoveryBusy: { readonly id: string; readonly action: WorkspaceMutationRecoveryAction } | null;
  readonly recoveryError: string | null;
}

export interface ProjectFilesOperationGateway {
  inspectWorkspaceEntry(root: string, path: string): Promise<WorkspaceEntryInspection>;
  copyWorkspaceEntryToSystemClipboard?(
    root: string,
    path: string,
    kind: "file" | "directory",
  ): Promise<SystemFileClipboardEntry>;
  readSystemFileClipboardEntry?(): Promise<SystemFileClipboardEntry | null>;
  importSystemFileClipboardEntry?(
    root: string,
    clipboardToken: string,
    destination: string,
  ): Promise<SystemFileClipboardImportResult>;
}

export interface ProjectFilesMutationPort {
  plan(
    identity: WorkspaceMutationIdentity,
    operation: WorkspaceMutationOperation,
    collisionPolicy: "cancel",
    editorRequest?: EditorPathMutationRequest | null,
  ): { planId: string; completion: Promise<WorkspaceMutationPlanResult> };
  execute(
    identity: WorkspaceMutationIdentity,
    planId: string,
  ): Promise<WorkspaceMutationExecutionResult>;
  cancel(): void;
  listRecoveries(repositoryRoot: string): Promise<WorkspaceMutationRecoverySummary[]>;
  rollbackRecovery(repositoryRoot: string, recoveryId: string): Promise<void>;
  finalizeRecovery(repositoryRoot: string, recoveryId: string): Promise<void>;
  acknowledgeRecovery(repositoryRoot: string, recoveryId: string): Promise<void>;
}

export interface ProjectFilesTrashPort {
  busy(): boolean;
  request(target: ProjectFilesContextTarget): Promise<void>;
}

export interface ProjectFilesOperationRuntime {
  currentIdentity(): WorkspaceMutationIdentity | null;
  isTargetCurrent(target: ProjectFilesContextTarget): boolean;
  repositoryLocation(workspacePath: string): { repositoryId: string; path: string } | null;
  canStageCreatedFile(workspacePath: string): boolean;
  newFileStageBehavior(): NewFileStagePreference;
  rememberNewFileStageBehavior(behavior: NewFileStagePreference): void;
  stageCreatedFile(workspacePath: string): Promise<void>;
  completed(
    action: "create" | "rename" | "paste",
    target: ProjectFilesContextTarget,
    destination: string | null,
    outcome: WorkspaceMutationOutcome,
  ): void;
  recoveryBlocked(paths: readonly string[], action: WorkspaceMutationRecoveryAction): boolean;
  reconcileRecovery(
    identity: WorkspaceMutationIdentity,
    recovery: WorkspaceMutationRecoverySummary,
    action: WorkspaceMutationRecoveryAction,
  ): Promise<void>;
  reconcileImportedMutation(
    identity: WorkspaceMutationIdentity,
    outcome: WorkspaceMutationOutcome,
  ): Promise<WorkspaceMutationReconciliationResult>;
  status(message: string): void;
  error(error: unknown): void;
}

type Listener = () => void;

export class ProjectFilesOperationController {
  readonly clipboard = new WorkspaceFileClipboard();
  private value: ProjectFilesOperationState = {
    inlineEdit: null,
    dialog: null,
    busyPath: null,
    recoveryIdentity: null,
    recoveries: [],
    recoveryBusy: null,
    recoveryError: null,
  };
  private readonly listeners = new Set<Listener>();
  private disposed = false;
  private readonly gateway: ProjectFilesOperationGateway;
  private readonly mutations: ProjectFilesMutationPort;
  private readonly runtime: ProjectFilesOperationRuntime;
  private readonly messages: () => ProjectFilesOperationMessages;
  private readonly trash: ProjectFilesTrashPort;

  constructor(
    gateway: ProjectFilesOperationGateway,
    mutations: ProjectFilesMutationPort,
    runtime: ProjectFilesOperationRuntime,
    messages: () => ProjectFilesOperationMessages,
    trash: ProjectFilesTrashPort,
  ) {
    this.gateway = gateway;
    this.mutations = mutations;
    this.runtime = runtime;
    this.messages = messages;
    this.trash = trash;
  }

  get state(): ProjectFilesOperationState {
    return this.value;
  }

  get busy(): boolean {
    return this.value.busyPath !== null || this.value.inlineEdit !== null ||
      this.value.dialog !== null || this.trash.busy();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  beginCreate(target: ProjectFilesContextTarget): boolean {
    if (!this.canStart(target)) return false;
    this.cancelPending();
    this.value = {
      ...this.value,
      inlineEdit: {
        kind: "create",
        anchorPath: target.workspacePath,
        anchorKind: target.kind,
        parentPath: destinationDirectory(target),
        sourcePath: null,
        sourceKind: null,
        value: "",
        error: null,
        busy: false,
      },
    };
    this.emit();
    return true;
  }

  beginRename(target: ProjectFilesContextTarget): boolean {
    // The workspace root owns no parent directory to rename inside.
    if (isProjectWorkspaceRootPath(target.workspacePath)) return false;
    if (!this.canStart(target)) return false;
    this.cancelPending();
    this.value = {
      ...this.value,
      inlineEdit: {
        kind: "rename",
        anchorPath: target.workspacePath,
        anchorKind: target.kind,
        parentPath: parentPath(target.workspacePath),
        sourcePath: target.workspacePath,
        sourceKind: target.kind,
        value: baseName(target.workspacePath),
        error: null,
        busy: false,
      },
    };
    this.emit();
    return true;
  }

  updateInlineValue(value: string): void {
    if (!this.value.inlineEdit || this.value.inlineEdit.busy) return;
    this.value.inlineEdit.value = value;
    this.value.inlineEdit.error = null;
  }

  cancelInline(): void {
    if (!this.value.inlineEdit || this.value.inlineEdit.busy) return;
    this.value = { ...this.value, inlineEdit: null };
    this.emit();
  }

  async blurInline(value: string): Promise<void> {
    const edit = this.value.inlineEdit;
    if (!edit || edit.busy) return;
    this.updateInlineValue(value);
    if (edit.kind === "create" && !value.trim()) {
      this.cancelInline();
      return;
    }
    await this.submitInline();
  }

  async submitInline(): Promise<void> {
    const edit = this.value.inlineEdit;
    const identity = this.runtime.currentIdentity();
    if (!edit || edit.busy || !identity) return;
    const name = validateWorkspaceEntryName(edit.value);
    if (!name) {
      edit.error = this.messages().invalidName;
      this.emit();
      return;
    }
    const destination = joinPath(edit.parentPath, name);
    const operation: WorkspaceMutationOperation = edit.kind === "create"
      ? { kind: "createFile", destination }
      : { kind: "move", source: edit.sourcePath!, destination };
    const editorRequest = edit.kind === "rename"
      ? this.editorMoveRequest(edit.sourcePath!, destination)
      : null;
    if (edit.kind === "rename" && !editorRequest) {
      edit.error = this.messages().operationFailed;
      this.emit();
      return;
    }
    edit.busy = true;
    edit.error = null;
    this.emit();
    const planned = this.mutations.plan(identity, operation, "cancel", editorRequest);
    const result = await planned.completion;
    if (!this.sameIdentity(identity) || this.value.inlineEdit !== edit) {
      this.mutations.cancel();
      if (this.value.inlineEdit === edit) {
        this.value = { ...this.value, inlineEdit: null };
        this.emit();
      }
      return;
    }
    if (result.status !== "ready") {
      edit.busy = false;
      edit.error = planFailure(result, this.messages());
      this.emit();
      return;
    }
    const execution = await this.mutations.execute(identity, planned.planId);
    if (this.value.inlineEdit !== edit) return;
    const outcome = completedOutcome(execution);
    if (!outcome) {
      if ("outcome" in execution && execution.outcome.recoveryId) {
        this.value = { ...this.value, inlineEdit: null };
        this.emit();
        await this.loadRecoveries(identity, true);
        this.runtime.error(new Error(executionFailure(execution, this.messages())));
      } else {
        edit.busy = false;
        edit.error = executionFailure(execution, this.messages());
        this.emit();
      }
      return;
    }
    this.value = { ...this.value, inlineEdit: null };
    this.emit();
    this.runtime.completed(edit.kind, targetFromEdit(identity, edit), destination, outcome);
    this.runtime.status(edit.kind === "create" ? this.messages().created : this.messages().renamed);
    if (edit.kind === "create") {
      await this.handleCreatedFileStaging(targetFromEdit(identity, edit), destination);
    }
  }

  async capture(mode: WorkspaceFileClipboardMode, target: ProjectFilesContextTarget): Promise<void> {
    if (!this.canStart(target)) return;
    this.value = { ...this.value, busyPath: target.workspacePath };
    this.emit();
    try {
      const inspection = await this.gateway.inspectWorkspaceEntry(
        target.workspaceRoot,
        target.workspacePath,
      );
      if (!this.runtime.isTargetCurrent(target) || inspection.source.kind !== target.kind ||
        inspection.source.workspacePath !== target.workspacePath) return;
      const location = this.runtime.repositoryLocation(target.workspacePath);
      const systemEntry = this.gateway.copyWorkspaceEntryToSystemClipboard
        ? await this.gateway.copyWorkspaceEntryToSystemClipboard(
            target.workspaceRoot,
            target.workspacePath,
            target.kind,
          )
        : null;
      if (!location || !this.clipboard.capture(
        mode,
        target.workspaceRoot,
        target.workspaceGeneration,
        location.repositoryId,
        location.path,
        inspection,
        systemEntry?.token ?? null,
      )) {
        this.runtime.error(new Error(this.messages().unsafeSource));
        return;
      }
      this.runtime.status(mode === "cut" ? this.messages().cut : this.messages().copied);
    } catch (error) {
      this.runtime.error(error);
    } finally {
      if (this.value.busyPath === target.workspacePath) {
        this.value = { ...this.value, busyPath: null };
        this.emit();
      }
    }
  }

  async paste(target: ProjectFilesContextTarget, requestedName?: string): Promise<void> {
    const identity = this.runtime.currentIdentity();
    const internalSource = identity && this.clipboard.current(identity.root, identity.generation);
    const dialog = this.value.dialog;
    const pasteDialogActive = dialog?.kind === "paste-name" && !dialog.busy;
    if (
      !identity ||
      !this.runtime.isTargetCurrent(target) ||
      this.value.busyPath !== null ||
      this.value.inlineEdit !== null ||
      (this.value.dialog !== null && !pasteDialogActive)
    ) return;
    let systemSource: SystemFileClipboardEntry | null | undefined;
    if (this.gateway.readSystemFileClipboardEntry) {
      try {
        systemSource = await this.gateway.readSystemFileClipboardEntry();
      } catch (error) {
        if (!internalSource) {
          this.runtime.error(error);
          return;
        }
      }
    }
    if (!this.runtime.isTargetCurrent(target) || !this.sameIdentity(identity)) return;
    const source = internalSource && (
      systemSource === undefined ||
      (internalSource.systemClipboardToken === null && systemSource === null) ||
      internalSource.systemClipboardToken === systemSource?.token
    ) ? internalSource : null;
    if (!source) {
      if (systemSource && this.gateway.importSystemFileClipboardEntry) {
        await this.pasteExternal(identity, target, systemSource, requestedName);
      } else {
        this.closeDialogWithoutCancel();
        this.runtime.error(new Error(this.messages().clipboardEmpty));
      }
      return;
    }
    const name = requestedName === undefined ? baseName(source.workspacePath) : validateWorkspaceEntryName(requestedName);
    if (!name) {
      this.openPasteName(target, requestedName ?? baseName(source.workspacePath), this.messages().invalidName);
      return;
    }
    const destination = joinPath(destinationDirectory(target), name);
    const operation: WorkspaceMutationOperation = source.mode === "cut"
      ? { kind: "move", source: source.workspacePath, destination }
      : { kind: "copy", source: source.workspacePath, destination };
    const editorRequest = source.mode === "cut" ? this.clipboardMoveRequest(source, destination) : null;
    if (source.mode === "cut" && !editorRequest) {
      this.runtime.error(new Error(this.messages().operationFailed));
      return;
    }
    this.value = { ...this.value, busyPath: target.workspacePath };
    if (this.value.dialog?.kind === "paste-name") this.value.dialog.busy = true;
    this.emit();
    const planned = this.mutations.plan(identity, operation, "cancel", editorRequest);
    const result = await planned.completion;
    if (!this.sameIdentity(identity)) {
      this.mutations.cancel();
      this.value = { ...this.value, busyPath: null, dialog: null };
      this.emit();
      return;
    }
    if (result.status !== "ready") {
      this.value = { ...this.value, busyPath: null };
      if (result.status === "blocked" && result.reason === "destinationExists") {
        this.openPasteName(target, name, this.messages().destinationExists);
      } else {
        this.closeDialogWithoutCancel();
        this.runtime.error(new Error(planFailure(result, this.messages())));
      }
      return;
    }
    if (!workspaceFileClipboardMatchesPreview(source, result.preview)) {
      this.mutations.cancel();
      this.clipboard.clear();
      this.value = { ...this.value, busyPath: null, dialog: null };
      this.emit();
      this.runtime.error(new Error(this.messages().sourceChanged));
      return;
    }
    const execution = await this.mutations.execute(identity, planned.planId);
    const outcome = completedOutcome(execution);
    this.value = { ...this.value, busyPath: null, dialog: null };
    this.emit();
    if (!outcome) {
      if ("outcome" in execution && execution.outcome.recoveryId) {
        await this.loadRecoveries(identity, true);
      }
      this.runtime.error(new Error(executionFailure(execution, this.messages())));
      return;
    }
    if (source.mode === "cut") {
      this.clipboard.consume(source);
    } else {
      const current = this.runtime.currentIdentity();
      if (current) this.clipboard.advanceGeneration(source, current.root, current.generation);
    }
    this.runtime.completed("paste", target, destination, outcome);
    this.runtime.status(this.messages().pasted);
  }

  private async pasteExternal(
    identity: WorkspaceMutationIdentity,
    target: ProjectFilesContextTarget,
    source: SystemFileClipboardEntry,
    requestedName?: string,
  ): Promise<void> {
    const name = requestedName === undefined
      ? validateWorkspaceEntryName(source.name)
      : validateWorkspaceEntryName(requestedName);
    if (!name) {
      this.openPasteName(target, requestedName ?? source.name, this.messages().invalidName);
      return;
    }
    const destination = joinPath(destinationDirectory(target), name);
    this.value = { ...this.value, busyPath: target.workspacePath };
    if (this.value.dialog?.kind === "paste-name") this.value.dialog.busy = true;
    this.emit();
    let result: SystemFileClipboardImportResult;
    try {
      result = await this.gateway.importSystemFileClipboardEntry!(
        identity.root,
        source.token,
        destination,
      );
    } catch (error) {
      this.value = { ...this.value, busyPath: null, dialog: null };
      this.emit();
      this.runtime.error(error);
      return;
    }
    if (!this.sameIdentity(identity)) {
      this.value = { ...this.value, busyPath: null, dialog: null };
      this.emit();
      return;
    }
    if (result.status === "destinationExists") {
      this.value = { ...this.value, busyPath: null };
      this.openPasteName(target, name, this.messages().destinationExists);
      return;
    }
    const reconciliation = await this.runtime.reconcileImportedMutation(identity, result.outcome);
    this.value = { ...this.value, busyPath: null, dialog: null };
    this.emit();
    if (reconciliation.status === "failure") {
      this.runtime.error(reconciliation.error);
      return;
    }
    if (reconciliation.status === "stale") return;
    this.runtime.completed("paste", target, result.destination, result.outcome);
    this.runtime.status(this.messages().pasted);
  }

  async requestTrash(target: ProjectFilesContextTarget): Promise<void> {
    // Never move the authorized workspace root itself into the system trash.
    if (isProjectWorkspaceRootPath(target.workspacePath)) return;
    if (!this.canStart(target)) return;
    await this.trash.request(target);
  }

  clearClipboardAtOrBelow(workspacePath: string): void {
    const entry = this.clipboard.entry;
    if (entry && isAtOrBelow(entry.workspacePath, workspacePath)) this.clipboard.clear();
  }

  updateDialogValue(value: string): void {
    const dialog = this.value.dialog;
    if (!dialog || dialog.kind !== "paste-name" || dialog.busy) return;
    dialog.value = value;
    dialog.error = null;
  }

  updateStageCreatedRemember(remember: boolean): void {
    const dialog = this.value.dialog;
    if (!dialog || dialog.kind !== "stage-created" || dialog.busy) return;
    dialog.remember = remember;
  }

  async resolveCreatedFileStaging(stage: boolean): Promise<void> {
    const dialog = this.value.dialog;
    if (!dialog || dialog.kind !== "stage-created" || dialog.busy) return;
    if (!stage) {
      if (dialog.remember) this.runtime.rememberNewFileStageBehavior("leaveUntracked");
      this.value = { ...this.value, dialog: null };
      this.emit();
      this.runtime.status(this.messages().leftCreatedUntracked);
      return;
    }
    dialog.busy = true;
    dialog.error = null;
    this.emit();
    try {
      await this.runtime.stageCreatedFile(dialog.destination);
      if (dialog.remember) this.runtime.rememberNewFileStageBehavior("stage");
      if (this.value.dialog === dialog) {
        this.value = { ...this.value, dialog: null };
        this.emit();
      }
      this.runtime.status(this.messages().stagedCreated);
    } catch {
      if (this.value.dialog !== dialog) return;
      dialog.busy = false;
      dialog.error = this.messages().stageCreatedFailed;
      this.emit();
    }
  }

  async loadRecoveries(identity: WorkspaceMutationIdentity, open: boolean): Promise<void> {
    if (this.disposed || !this.sameIdentity(identity)) return;
    try {
      const recoveries = await this.mutations.listRecoveries(identity.root);
      if (!this.sameIdentity(identity)) return;
      this.value = {
        ...this.value,
        recoveryIdentity: { ...identity },
        recoveries,
        recoveryError: null,
        dialog: open && recoveries.length > 0 ? { kind: "recovery" } : this.value.dialog,
      };
      if (recoveries.length === 0 && this.value.dialog?.kind === "recovery") {
        this.value = { ...this.value, dialog: null };
      }
      this.emit();
    } catch (error) {
      if (!this.sameIdentity(identity)) return;
      this.value = { ...this.value, recoveryError: this.messages().recoveryFailed };
      this.emit();
      this.runtime.error(error);
    }
  }

  openRecoveryDialog(): void {
    const identity = this.value.recoveryIdentity;
    if (!identity || !this.sameIdentity(identity) || this.value.recoveries.length === 0) return;
    this.value = { ...this.value, dialog: { kind: "recovery" }, recoveryError: null };
    this.emit();
  }

  async resolveRecovery(
    recoveryId: string,
    action: WorkspaceMutationRecoveryAction,
  ): Promise<void> {
    const identity = this.value.recoveryIdentity;
    const recovery = this.value.recoveries.find((item) => item.recoveryId === recoveryId);
    if (
      !identity || !recovery || !this.sameIdentity(identity) || this.value.recoveryBusy ||
      !recovery.supportedActions.includes(action)
    ) return;
    const paths = recoveryPaths(recovery);
    if (this.runtime.recoveryBlocked(paths, action)) {
      this.value = { ...this.value, recoveryError: this.messages().recoveryDirty };
      this.emit();
      return;
    }
    const busy = { id: recoveryId, action } as const;
    this.value = { ...this.value, recoveryBusy: busy, recoveryError: null };
    this.emit();
    try {
      if (action === "rollback") {
        await this.mutations.rollbackRecovery(identity.root, recoveryId);
      } else if (action === "finalize") {
        await this.mutations.finalizeRecovery(identity.root, recoveryId);
      } else {
        await this.mutations.acknowledgeRecovery(identity.root, recoveryId);
      }
      if (!this.sameIdentity(identity) || this.value.recoveryBusy !== busy) return;
      await this.runtime.reconcileRecovery(identity, recovery, action);
      if (!this.sameIdentity(identity) || this.value.recoveryBusy !== busy) return;
      const recoveries = await this.mutations.listRecoveries(identity.root);
      if (!this.sameIdentity(identity) || this.value.recoveryBusy !== busy) return;
      this.value = {
        ...this.value,
        recoveries,
        recoveryBusy: null,
        recoveryError: null,
        dialog: recoveries.length > 0 ? { kind: "recovery" } : null,
      };
      this.emit();
      this.runtime.status(this.messages().recoveryResolved);
    } catch (error) {
      if (!this.sameIdentity(identity) || this.value.recoveryBusy !== busy) return;
      this.value = {
        ...this.value,
        recoveryBusy: null,
        recoveryError: this.messages().recoveryFailed,
      };
      this.emit();
      this.runtime.error(error);
    }
  }

  closeDialog(): void {
    if (!this.value.dialog || ("busy" in this.value.dialog && this.value.dialog.busy)) return;
    this.value = { ...this.value, dialog: null, busyPath: null };
    this.emit();
  }

  reset(): void {
    if (this.disposed) return;
    this.mutations.cancel();
    this.clipboard.clear();
    this.value = {
      inlineEdit: null,
      dialog: null,
      busyPath: null,
      recoveryIdentity: null,
      recoveries: [],
      recoveryBusy: null,
      recoveryError: null,
    };
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mutations.cancel();
    this.clipboard.clear();
    this.listeners.clear();
  }

  private canStart(target: ProjectFilesContextTarget): boolean {
    return !this.disposed && !this.busy && !target.readOnly && this.runtime.isTargetCurrent(target);
  }

  private cancelPending(): void {
    this.value = { ...this.value, inlineEdit: null, dialog: null };
  }

  private openPasteName(target: ProjectFilesContextTarget, value: string, error: string | null): void {
    this.value = {
      ...this.value,
      busyPath: null,
      dialog: { kind: "paste-name", target, value, error, busy: false },
    };
    this.emit();
  }

  private async handleCreatedFileStaging(
    target: ProjectFilesContextTarget,
    destination: string,
  ): Promise<void> {
    if (!this.runtime.canStageCreatedFile(destination)) return;
    const behavior = this.runtime.newFileStageBehavior();
    if (behavior === "leaveUntracked") return;
    if (behavior === "ask") {
      this.value = {
        ...this.value,
        dialog: {
          kind: "stage-created",
          target,
          destination,
          remember: false,
          error: null,
          busy: false,
        },
      };
      this.emit();
      return;
    }
    this.value = { ...this.value, busyPath: destination };
    this.emit();
    try {
      await this.runtime.stageCreatedFile(destination);
      this.runtime.status(this.messages().stagedCreated);
    } catch (error) {
      this.runtime.error(error);
    } finally {
      if (this.value.busyPath === destination) {
        this.value = { ...this.value, busyPath: null };
        this.emit();
      }
    }
  }

  private closeDialogWithoutCancel(): void {
    this.value = { ...this.value, dialog: null, busyPath: null };
    this.emit();
  }

  private editorMoveRequest(source: string, destination: string): EditorPathMutationRequest | null {
    const from = this.runtime.repositoryLocation(source);
    const to = this.runtime.repositoryLocation(destination);
    return from && to ? {
      kind: "move",
      mapping: {
        sourceWorkspacePath: source,
        destinationWorkspacePath: destination,
        sourceRepositoryId: from.repositoryId,
        destinationRepositoryId: to.repositoryId,
        sourcePath: from.path,
        destinationPath: to.path,
      },
    } : null;
  }

  private clipboardMoveRequest(
    source: WorkspaceFileClipboardEntry,
    destination: string,
  ): EditorPathMutationRequest | null {
    const to = this.runtime.repositoryLocation(destination);
    return to ? {
      kind: "move",
      mapping: {
        sourceWorkspacePath: source.workspacePath,
        destinationWorkspacePath: destination,
        sourceRepositoryId: source.repositoryId,
        destinationRepositoryId: to.repositoryId,
        sourcePath: source.repositoryPath,
        destinationPath: to.path,
      },
    } : null;
  }

  private sameIdentity(identity: WorkspaceMutationIdentity): boolean {
    const current = this.runtime.currentIdentity();
    return Boolean(current && current.root === identity.root && current.generation === identity.generation);
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}
