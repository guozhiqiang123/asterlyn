import type {
  WorkspaceEntryInspection,
  WorkspaceMutationOperation,
  WorkspaceMutationOutcome,
} from "../../models.ts";
import type {
  WorkspaceMutationExecutionResult,
  WorkspaceMutationIdentity,
  WorkspaceMutationPlanResult,
} from "../../application/workspace-mutation-coordinator.ts";
import type { EditorPathMutationRequest } from "../../editor-path-mutation.ts";
import type { ProjectFilesContextTarget } from "./project-files-binding.ts";
import {
  WorkspaceFileClipboard,
  workspaceFileClipboardMatchesPreview,
  type WorkspaceFileClipboardEntry,
  type WorkspaceFileClipboardMode,
} from "./workspace-file-clipboard.ts";

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
    };

export interface ProjectFilesOperationState {
  readonly inlineEdit: ProjectFilesInlineEdit | null;
  readonly dialog: ProjectFilesOperationDialog | null;
  readonly busyPath: string | null;
}

export interface ProjectFilesOperationMessages {
  readonly invalidName: string;
  readonly unsafeSource: string;
  readonly sourceChanged: string;
  readonly destinationExists: string;
  readonly operationFailed: string;
  readonly copied: string;
  readonly cut: string;
  readonly created: string;
  readonly renamed: string;
  readonly pasted: string;
}

export interface ProjectFilesOperationGateway {
  inspectWorkspaceEntry(root: string, path: string): Promise<WorkspaceEntryInspection>;
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
}

export interface ProjectFilesTrashPort {
  busy(): boolean;
  request(target: ProjectFilesContextTarget): Promise<void>;
}

export interface ProjectFilesOperationRuntime {
  currentIdentity(): WorkspaceMutationIdentity | null;
  isTargetCurrent(target: ProjectFilesContextTarget): boolean;
  repositoryLocation(workspacePath: string): { repositoryId: string; path: string } | null;
  completed(
    action: "create" | "rename" | "paste",
    target: ProjectFilesContextTarget,
    destination: string | null,
    outcome: WorkspaceMutationOutcome,
  ): void;
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
      edit.busy = false;
      edit.error = executionFailure(execution, this.messages());
      this.emit();
      return;
    }
    this.value = { ...this.value, inlineEdit: null };
    this.emit();
    this.runtime.completed(edit.kind, targetFromEdit(identity, edit), destination, outcome);
    this.runtime.status(edit.kind === "create" ? this.messages().created : this.messages().renamed);
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
      if (!location || !this.clipboard.capture(
        mode,
        target.workspaceRoot,
        target.workspaceGeneration,
        location.repositoryId,
        location.path,
        inspection,
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
    const source = identity && this.clipboard.current(identity.root, identity.generation);
    const dialog = this.value.dialog;
    const pasteDialogActive = dialog?.kind === "paste-name" && !dialog.busy;
    if (
      !identity ||
      !source ||
      !this.runtime.isTargetCurrent(target) ||
      this.value.busyPath !== null ||
      this.value.inlineEdit !== null ||
      (this.value.dialog !== null && !pasteDialogActive)
    ) return;
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

  async requestTrash(target: ProjectFilesContextTarget): Promise<void> {
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

  closeDialog(): void {
    if (!this.value.dialog || this.value.dialog.busy) return;
    this.value = { ...this.value, dialog: null, busyPath: null };
    this.emit();
  }

  reset(): void {
    if (this.disposed) return;
    this.mutations.cancel();
    this.clipboard.clear();
    this.value = { inlineEdit: null, dialog: null, busyPath: null };
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

export function validateWorkspaceEntryName(value: string): string | null {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return null;
  }
  return value;
}

export function destinationDirectory(target: ProjectFilesContextTarget): string {
  return target.kind === "directory" ? target.workspacePath : parentPath(target.workspacePath);
}

function parentPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const offset = normalized.lastIndexOf("/");
  return offset < 0 ? "" : normalized.slice(0, offset);
}

function baseName(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function completedOutcome(result: WorkspaceMutationExecutionResult): WorkspaceMutationOutcome | null {
  return result.status === "completed" &&
      (result.outcome.status === "completed" || result.outcome.status === "noOp")
    ? result.outcome
    : null;
}

function planFailure(result: WorkspaceMutationPlanResult, messages: ProjectFilesOperationMessages): string {
  if (result.status === "blocked" && result.reason === "destinationExists") return messages.destinationExists;
  if (result.status === "failure" && result.error instanceof Error) return result.error.message;
  return messages.operationFailed;
}

function executionFailure(
  result: WorkspaceMutationExecutionResult,
  messages: ProjectFilesOperationMessages,
): string {
  if ("outcome" in result && result.outcome.error) return result.outcome.error;
  if (result.status === "failure" && result.error instanceof Error) return result.error.message;
  return messages.operationFailed;
}

function targetFromEdit(
  identity: WorkspaceMutationIdentity,
  edit: ProjectFilesInlineEdit,
): ProjectFilesContextTarget {
  return {
    workspaceRoot: identity.root,
    workspaceGeneration: identity.generation,
    workspacePath: edit.sourcePath ?? edit.anchorPath,
    kind: edit.sourceKind ?? "file",
    file: null,
    status: "unmodified",
    readOnly: false,
  };
}

function isAtOrBelow(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}
