import type { GitOperationKind } from "../../models.ts";
import type { GitOperationCopy, RecoveryCopy } from "../../localization/catalog.ts";
import {
  GitOperationController,
  type GitOperationChange,
  type GitOperationGateway,
} from "./git-operation-controller.ts";
import {
  GitOperationDialogBinding,
  type GitOperationDialogActions,
} from "./git-operation-dialog-binding.ts";
import type {
  GitWorktreeRecoveryActions,
  GitWorktreeRecoveryDialog,
} from "./git-worktree-recovery-dialog.ts";
import { ConflictEditorRuntime, type ConflictEditorRuntimeOptions } from "./conflict-editor-runtime.ts";
import type { EditorDocument } from "../../editor-document.ts";

export interface GitOperationRuntimeOptions {
  readonly root: HTMLElement;
  readonly gateway: GitOperationGateway;
  readonly initialCopy: GitOperationCopy;
  readonly copy: () => GitOperationCopy;
  readonly actions: GitOperationDialogActions;
  readonly changed: (change: GitOperationChange) => void;
  readonly conflictEditor?: Omit<ConflictEditorRuntimeOptions, "controller">;
  readonly recovery?: {
    readonly actions: GitWorktreeRecoveryActions;
    readonly copy: () => RecoveryCopy;
  };
}

/** Owns the reviewed Git-operation controller, lazy dialog boundary, and lifecycle. */
export class GitOperationRuntime {
  readonly controller: GitOperationController;

  private readonly binding: GitOperationDialogBinding;
  private readonly release: () => void;
  private readonly recovery: GitOperationRuntimeOptions["recovery"];
  private readonly conflictEditor: ConflictEditorRuntime | null;
  private recoveryDialog: GitWorktreeRecoveryDialog | null = null;
  private disposed = false;

  constructor(options: GitOperationRuntimeOptions) {
    this.controller = new GitOperationController(options.gateway, options.initialCopy);
    this.conflictEditor = options.conflictEditor
      ? new ConflictEditorRuntime({ ...options.conflictEditor, controller: this.controller })
      : null;
    this.recovery = options.recovery;
    this.binding = new GitOperationDialogBinding(
      options.root,
      this.controller,
      options.actions,
      options.copy,
    );
    this.release = this.controller.subscribe((change) => {
      if (change.dialogChanged) this.binding.render();
      this.conflictEditor?.handleChange(change);
      options.changed(change);
    });
  }

  openSetup(kind: GitOperationKind, targets: string[], message = ""): void {
    this.binding.openSetup(kind, targets, message);
  }

  openConflict(path: string): void {
    if (this.conflictEditor) void this.conflictEditor.open(path);
    else void this.controller.openConflict(path);
  }

  renderConflict(document: EditorDocument): boolean {
    return this.conflictEditor?.render(document) ?? false;
  }

  captureConflict(): void {
    this.conflictEditor?.capture();
  }

  close(): boolean {
    return this.binding.close();
  }

  render(): void {
    this.binding.render();
  }

  setMessages(messages: GitOperationCopy): void {
    this.controller.setMessages(messages);
  }

  async openRecoveries(root: string): Promise<void> {
    const recovery = this.recovery;
    if (this.disposed || !recovery) return;
    const { GitWorktreeRecoveryDialog } = await import("./git-worktree-recovery-dialog.ts");
    if (this.disposed) return;
    this.recoveryDialog ??= new GitWorktreeRecoveryDialog(recovery.actions, recovery.copy);
    await this.recoveryDialog.open(root);
  }

  refreshCopy(): void {
    if (this.controller.state.dialog) this.binding.render();
    this.recoveryDialog?.refreshCopy();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.binding.dispose();
    this.recoveryDialog?.dispose();
    this.recoveryDialog = null;
    this.controller.dispose();
  }
}
