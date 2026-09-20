import type {
  WorkspaceTrashState,
  WorkspaceTrashTarget,
} from "../../application/workspace-trash-controller.ts";

export interface WorkspaceTrashDialogCopy {
  readonly title: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly working: string;
  fileDetail(path: string): string;
  folderDetail(entryCount: number, totalBytes: number, hiddenEntryCount: number): string;
}

export function renderWorkspaceTrashDialog<TTarget extends WorkspaceTrashTarget>(
  state: WorkspaceTrashState<TTarget>,
  copy: WorkspaceTrashDialogCopy,
): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const detail = dialog.target.kind === "directory"
    ? copy.folderDetail(
        dialog.preview.entryCount,
        dialog.preview.totalBytes,
        dialog.preview.hiddenEntryCount,
      )
    : copy.fileDetail(dialog.target.workspacePath);
  return `<section class="dialog project-files-dialog" role="alertdialog" aria-modal="true" aria-labelledby="workspace-trash-dialog-title" aria-describedby="workspace-trash-dialog-detail">
    <div class="dialog-heading"><h2 id="workspace-trash-dialog-title">${escapeHtml(copy.title)}</h2><button class="icon-button" data-workspace-trash-close type="button" aria-label="${escapeAttribute(copy.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div>
    <strong class="project-files-dialog-path">${escapeHtml(dialog.target.workspacePath)}</strong><p id="workspace-trash-dialog-detail">${escapeHtml(detail)}</p>
    <div class="dialog-actions"><button class="secondary-button" data-workspace-trash-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="danger-button" id="workspace-trash-confirm" type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? copy.working : copy.confirm)}</button></div>
  </section>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#96;");
}
