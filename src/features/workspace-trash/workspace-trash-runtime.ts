import {
  WorkspaceTrashController,
  type WorkspaceTrashMessages,
  type WorkspaceTrashMutationPort,
  type WorkspaceTrashRuntime as WorkspaceTrashControllerRuntime,
  type WorkspaceTrashTarget,
} from "../../application/workspace-trash-controller.ts";
import { WorkspaceTrashDialogBinding } from "./workspace-trash-dialog-binding.ts";
import type { WorkspaceTrashDialogCopy } from "./workspace-trash-dialog-view.ts";

export interface WorkspaceTrashRuntimeOptions<TTarget extends WorkspaceTrashTarget> {
  readonly root: HTMLElement;
  readonly mutations: WorkspaceTrashMutationPort;
  readonly runtime: WorkspaceTrashControllerRuntime<TTarget>;
  readonly messages: () => WorkspaceTrashMessages;
  readonly copy: () => WorkspaceTrashDialogCopy;
  readonly focusTarget: (target: TTarget) => HTMLElement | null;
  readonly changed: () => void;
}

/** Owns the shared Trash workflow, dialog binding, subscription, and disposal. */
export class WorkspaceTrashRuntime<TTarget extends WorkspaceTrashTarget> {
  readonly controller: WorkspaceTrashController<TTarget>;

  private readonly binding: WorkspaceTrashDialogBinding<TTarget>;
  private readonly release: () => void;
  private disposed = false;

  constructor(options: WorkspaceTrashRuntimeOptions<TTarget>) {
    this.controller = new WorkspaceTrashController(
      options.mutations,
      options.runtime,
      options.messages,
    );
    this.binding = new WorkspaceTrashDialogBinding(
      options.root,
      this.controller,
      options.copy,
      options.focusTarget,
    );
    this.release = this.controller.subscribe(() => {
      options.changed();
      this.binding.render();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.binding.dispose();
    this.release();
    this.controller.dispose();
  }
}
