import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { ProjectFilesCopy } from "../../localization/catalog.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import type { ProjectTreeNode } from "../../presentation/project-tree.ts";
import {
  ProjectFilesContextActions,
  type ProjectFilesContextRuntime,
} from "./project-files-context-actions.ts";
import { ProjectFilesContextBinding } from "./project-files-binding.ts";
import type { ProjectFilesState } from "./project-files-controller.ts";

export interface ProjectFilesContextSource {
  readonly state: ProjectFilesState;
  readonly tree: readonly ProjectTreeNode[];
  readonly workspaceGeneration: number;
}

export interface ProjectFilesContextRuntimeOptions {
  readonly root: HTMLElement;
  readonly host: ContextMenuPort;
  readonly clipboard: TextClipboardPort;
  readonly source: () => ProjectFilesContextSource;
  readonly actions: ProjectFilesContextRuntime;
  readonly copy: () => ProjectFilesCopy;
}

/** Owns the Files tree's delegated context-menu boundary and action provider. */
export class ProjectFilesContextSurfaceRuntime {
  private readonly binding: ProjectFilesContextBinding;

  constructor(options: ProjectFilesContextRuntimeOptions) {
    const actions = new ProjectFilesContextActions(
      options.host,
      options.clipboard,
      options.actions,
      options.copy,
    );
    this.binding = new ProjectFilesContextBinding(
      options.root,
      options.source,
      (request) => actions.open(request),
    );
  }

  dispose(): void {
    this.binding.dispose();
  }
}
