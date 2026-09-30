import type { TextClipboardPort } from "../../application/text-clipboard.ts";
import type { ProjectFilesCopy } from "../../localization/catalog.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import type { ProjectTreeNode } from "../../presentation/project-tree.ts";
import {
  ProjectFilesContextActions,
  type ProjectFilesContextCommandAction,
  type ProjectFilesContextRuntime,
} from "./project-files-context-actions.ts";
import {
  ProjectFilesContextBinding,
  resolveProjectFilesContextTarget,
  type ProjectFilesContextTarget,
} from "./project-files-binding.ts";
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
  private readonly actions: ProjectFilesContextActions;
  private readonly source: () => ProjectFilesContextSource;
  private readonly copy: () => ProjectFilesCopy;

  constructor(options: ProjectFilesContextRuntimeOptions) {
    this.source = options.source;
    this.copy = options.copy;
    this.actions = new ProjectFilesContextActions(
      options.host,
      options.clipboard,
      options.actions,
      options.copy,
    );
    this.binding = new ProjectFilesContextBinding(
      options.root,
      options.source,
      (request) => this.actions.open(request),
    );
  }

  commandAvailability(action: ProjectFilesContextCommandAction): { enabled: boolean; reason?: string } {
    const target = this.commandTarget();
    if (!target) return { enabled: false, reason: this.copy().projectFiles };
    const availability = this.actions.commandAvailability(action, target);
    return availability.kind === "enabled"
      ? { enabled: true }
      : { enabled: false, reason: availability.kind === "busy" ? availability.label : availability.reason };
  }

  async executeCommand(action: ProjectFilesContextCommandAction): Promise<void> {
    const target = this.commandTarget();
    if (target) await this.actions.executeCommand(action, target);
  }

  dispose(): void {
    this.binding.dispose();
  }

  private commandTarget(): ProjectFilesContextTarget | null {
    return resolveProjectFilesCommandTarget(this.source());
  }
}

export function resolveProjectFilesCommandTarget(
  source: ProjectFilesContextSource,
): ProjectFilesContextTarget | null {
  const selection = source.state.selection;
  if (!selection) return null;
  const primary = resolveProjectFilesContextTarget(
    source.state, source.tree, source.workspaceGeneration, selection.path, selection.kind,
  );
  if (!primary || source.state.selections.length <= 1) return primary;
  const selectedTargets = source.state.selections.map((candidate) => resolveProjectFilesContextTarget(
    source.state, source.tree, source.workspaceGeneration, candidate.path, candidate.kind,
  )).filter((target): target is ProjectFilesContextTarget => target !== null);
  return selectedTargets.length > 1 ? { ...primary, selectedTargets } : primary;
}
