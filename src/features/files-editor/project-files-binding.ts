import type { ChangeKind, ProjectFile } from "../../models.ts";
import type { WorkspaceEntryIdentity } from "../../application/workbench-navigation.ts";
import {
  findProjectTreeNode,
  isProjectWorkspaceRootPath,
  PROJECT_WORKSPACE_ROOT_PATH,
  type ProjectTreeNode,
} from "../../presentation/project-tree.ts";
import type { ProjectFilesState } from "./project-files-controller.ts";
import {
  DelegatedContextBinding,
  type DelegatedContextRequest,
} from "../../shared/context-menu/delegated-context-binding.ts";

export type ProjectFilesContextTarget = WorkspaceEntryIdentity & {
  readonly file: ProjectFile | null;
  readonly status: ChangeKind;
  readonly readOnly: boolean;
  readonly selectedTargets?: readonly ProjectFilesContextTarget[];
};

export class ProjectFilesContextBinding {
  private readonly binding: DelegatedContextBinding<ProjectFilesContextTarget>;

  constructor(
    root: HTMLElement,
    current: () => {
      readonly state: ProjectFilesState;
      readonly tree: readonly ProjectTreeNode[];
      readonly workspaceGeneration: number;
    },
    open: (request: DelegatedContextRequest<ProjectFilesContextTarget>) => boolean,
  ) {
    this.binding = new DelegatedContextBinding(root, {
      selector: "[data-project-node], [data-project-root]",
      // The header opens the workspace-root menu from anywhere on it, except its own controls.
      exclude: "[data-navigator-header-controls]",
      resolve: (trigger) => {
        const context = current();
        if (trigger.hasAttribute("data-project-root")) {
          return resolveProjectFilesContextTarget(
            context.state,
            context.tree,
            context.workspaceGeneration,
            PROJECT_WORKSPACE_ROOT_PATH,
            "directory",
          );
        }
        const path = trigger.dataset.projectNode;
        const kind = trigger.dataset.projectKind;
        if (!path || (kind !== "file" && kind !== "directory")) return null;
        const primary = resolveProjectFilesContextTarget(
          context.state,
          context.tree,
          context.workspaceGeneration,
          path,
          kind,
        );
        if (!primary) return null;
        const selections = context.state.selections ?? [];
        if (selections.some((s) => s.path === path) && selections.length > 1) {
          const selectedTargets = selections
            .map((s) =>
              resolveProjectFilesContextTarget(
                context.state,
                context.tree,
                context.workspaceGeneration,
                s.path,
                s.kind,
              ),
            )
            .filter((t): t is ProjectFilesContextTarget => t !== null);
          return { ...primary, selectedTargets };
        }
        return primary;
      },
      open,
    });
  }

  dispose(): void {
    this.binding.dispose();
  }
}

export function resolveProjectFilesContextTarget(
  state: ProjectFilesState,
  tree: readonly ProjectTreeNode[],
  workspaceGeneration: number,
  workspacePath: string,
  expectedKind?: "file" | "directory",
): ProjectFilesContextTarget | null {
  if (!state.root) return null;
  if (isProjectWorkspaceRootPath(workspacePath)) {
    if (expectedKind === "file") return null;
    return {
      workspaceRoot: state.root,
      workspaceGeneration,
      workspacePath,
      kind: "directory",
      file: null,
      status: "unmodified",
      readOnly: false,
    };
  }
  const node = findProjectTreeNode([...tree], workspacePath);
  if (!node || (expectedKind && node.kind !== expectedKind)) return null;
  const file = node.kind === "file"
    ? state.files.find((candidate) => candidate.workspacePath === workspacePath) ?? null
    : null;
  return {
    workspaceRoot: state.root,
    workspaceGeneration,
    workspacePath,
    kind: node.kind,
    file: file ? { ...file } : null,
    status: node.status,
    readOnly: file?.readOnly === true,
  };
}
