import type { WorkspaceTrashTarget } from "../../application/workspace-trash-controller.ts";
import type { LocaleCatalog } from "../../localization/catalog.ts";

interface TrashPresentationTarget extends WorkspaceTrashTarget {
  readonly repositoryRevision?: number;
  readonly repositoryId?: string;
  readonly path?: string;
  readonly group?: string;
}

/** Shared Files/Changes Trash copy and focus routing stay with the dialog feature. */
export function workspaceTrashPresentation(root: HTMLElement, catalog: () => LocaleCatalog) {
  return {
    messages: () => {
      const labels = catalog().projectFiles.contextMenu;
      return {
        targetChanged: labels.sourceChanged,
        blocked: labels.trashBlocked,
        operationFailed: labels.operationFailed,
        trashed: labels.trashedEntry,
        saveBeforeTrash: catalog().changes.saveBeforeTrashUnversioned,
      };
    },
    copy: () => {
      const labels = catalog().projectFiles.contextMenu;
      return {
        title: labels.confirmTrashTitle,
        cancel: labels.cancel,
        confirm: labels.confirmTrash,
        working: labels.working,
        fileDetail: labels.trashFileDetail,
        folderDetail: labels.trashFolderDetail,
        multipleDetail: labels.trashMultipleDetail,
      };
    },
    focusTarget: (target: TrashPresentationTarget): HTMLElement | null => {
      const changes = "repositoryRevision" in target;
      return Array.from(root.querySelectorAll<HTMLElement>(
        changes ? "[data-change-path], [data-change-directory]" : "[data-project-node]",
      )).find((element) => changes
        ? (target.kind === "directory"
            ? element.dataset.changeDirectory === target.path && element.dataset.changeGroup === target.group
            : element.dataset.changePath === target.path) &&
          (element.dataset.changeRepositoryId ?? ".") === target.repositoryId
        : element.dataset.projectNode === target.workspacePath,
      ) ?? null;
    },
  };
}
