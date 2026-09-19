import type { ProjectFilesCopy } from "../../localization/catalog.ts";
import { ProjectFilesOperationBinding } from "./project-files-operation-binding.ts";
import {
  ProjectFilesOperationController,
  type ProjectFilesMutationPort,
  type ProjectFilesOperationGateway,
  type ProjectFilesOperationMessages,
  type ProjectFilesOperationRuntime as ProjectFilesOperationControllerRuntime,
  type ProjectFilesTrashPort,
} from "./project-files-operation-controller.ts";

export interface ProjectFilesOperationRuntimeOptions {
  readonly root: HTMLElement;
  readonly gateway: ProjectFilesOperationGateway;
  readonly mutations: ProjectFilesMutationPort;
  readonly runtime: ProjectFilesOperationControllerRuntime;
  readonly messages: () => ProjectFilesOperationMessages;
  readonly trash: ProjectFilesTrashPort;
  readonly copy: () => ProjectFilesCopy;
  readonly changed: () => void;
  readonly clipboardChanged: () => void;
}

/** Owns Files mutations, its window-local clipboard, DOM binding, and subscriptions. */
export class ProjectFilesOperationRuntime {
  readonly controller: ProjectFilesOperationController;

  private readonly binding: ProjectFilesOperationBinding;
  private readonly releases: readonly (() => void)[];
  private disposed = false;

  constructor(options: ProjectFilesOperationRuntimeOptions) {
    this.controller = new ProjectFilesOperationController(
      options.gateway,
      options.mutations,
      options.runtime,
      options.messages,
      options.trash,
    );
    this.binding = new ProjectFilesOperationBinding(
      options.root,
      this.controller,
      options.copy,
    );
    this.releases = [
      this.controller.subscribe(() => {
        options.changed();
        this.binding.renderDialog();
      }),
      this.controller.clipboard.subscribe(() => options.clipboardChanged()),
    ];
  }

  bindInline(): void {
    this.binding.bindInline();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.binding.dispose();
    for (const release of this.releases) release();
    this.controller.dispose();
  }
}
