import type { ChangeKind, ProjectFile } from "../../models.ts";
import type { WorkspaceEntryIdentity } from "../../application/workbench-navigation.ts";
import {
  findProjectTreeNode,
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
      selector: "[data-project-node]",
      resolve: (trigger) => {
        const context = current();
        const path = trigger.dataset.projectNode;
        const kind = trigger.dataset.projectKind;
        return path && (kind === "file" || kind === "directory")
          ? resolveProjectFilesContextTarget(
              context.state,
              context.tree,
              context.workspaceGeneration,
              path,
              kind,
            )
          : null;
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
    readOnly: node.status === "ignored" || file?.readOnly === true,
  };
}
