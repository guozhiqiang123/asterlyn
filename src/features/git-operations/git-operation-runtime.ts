import type { GitOperationKind } from "../../models.ts";
import type { GitOperationCopy } from "../../localization/catalog.ts";
import {
  GitOperationController,
  type GitOperationChange,
  type GitOperationGateway,
} from "./git-operation-controller.ts";
import {
  GitOperationDialogBinding,
  type GitOperationDialogActions,
} from "./git-operation-dialog-binding.ts";

export interface GitOperationRuntimeOptions {
  readonly root: HTMLElement;
  readonly gateway: GitOperationGateway;
  readonly initialCopy: GitOperationCopy;
  readonly copy: () => GitOperationCopy;
  readonly actions: GitOperationDialogActions;
  readonly changed: (change: GitOperationChange) => void;
}

/** Owns the reviewed Git-operation controller, lazy dialog boundary, and lifecycle. */
export class GitOperationRuntime {
  readonly controller: GitOperationController;

  private readonly binding: GitOperationDialogBinding;
  private readonly release: () => void;
  private disposed = false;

  constructor(options: GitOperationRuntimeOptions) {
    this.controller = new GitOperationController(options.gateway, options.initialCopy);
    this.binding = new GitOperationDialogBinding(
      options.root,
      this.controller,
      options.actions,
      options.copy,
    );
    this.release = this.controller.subscribe((change) => {
      if (change.dialogChanged) this.binding.render();
      options.changed(change);
    });
  }

  openSetup(kind: GitOperationKind, targets: string[], message = ""): void {
    this.binding.openSetup(kind, targets, message);
  }

  openConflict(path: string): void {
    this.binding.openConflict(path);
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.binding.dispose();
    this.controller.dispose();
  }
}
