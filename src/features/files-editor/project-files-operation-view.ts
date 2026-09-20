import type { ProjectFilesCopy } from "../../localization/catalog.ts";
import type { ProjectFilesOperationState } from "./project-files-operation-controller.ts";

export function renderProjectFilesOperationDialog(
  state: ProjectFilesOperationState,
  copy: ProjectFilesCopy,
): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const labels = copy.contextMenu;
  return `<section class="dialog project-files-dialog" role="dialog" aria-modal="true" aria-labelledby="project-files-dialog-title">
    <div class="dialog-heading"><h2 id="project-files-dialog-title">${escapeHtml(labels.choosePasteName)}</h2><button class="icon-button" data-project-files-dialog-close type="button" aria-label="${escapeAttribute(labels.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div>
    <p>${escapeHtml(labels.pasteNameDetail)}</p>
    <form id="project-files-paste-name-form"><label for="project-files-paste-name">${escapeHtml(labels.nameLabel)}</label><input id="project-files-paste-name" name="name" type="text" value="${escapeAttribute(dialog.value)}" aria-invalid="${Boolean(dialog.error)}" ${dialog.busy ? "disabled" : ""} autocomplete="off" spellcheck="false" />${dialog.error ? `<small class="project-files-dialog-error" role="alert">${escapeHtml(dialog.error)}</small>` : ""}<div class="dialog-actions"><button class="secondary-button" data-project-files-dialog-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(labels.cancel)}</button><button class="primary-button" type="submit" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? labels.working : labels.paste)}</button></div></form>
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
