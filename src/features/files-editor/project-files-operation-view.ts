import type { ProjectFilesCopy } from "../../localization/catalog.ts";
import type { ProjectFilesOperationState } from "./project-files-operation-controller.ts";

export function renderProjectFilesOperationDialog(
  state: ProjectFilesOperationState,
  copy: ProjectFilesCopy,
): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const labels = copy.contextMenu;
  if (dialog.kind === "recovery") {
    const cards = state.recoveries.map((recovery) => {
      const busy = state.recoveryBusy?.id === recovery.recoveryId;
      const paths = [
        ...recovery.sourceStates.map((source) =>
          `<li><span>${escapeHtml(source.path)}</span><span class="recovery-state ${source.state}">${escapeHtml(labels.recoveryState[source.state])}</span></li>`
        ),
        ...(recovery.destination && recovery.destinationState
          ? [`<li><span>${escapeHtml(recovery.destination)}</span><span class="recovery-state ${recovery.destinationState}">${escapeHtml(labels.recoveryState[recovery.destinationState])}</span></li>`]
          : []),
      ].join("");
      const actions = recovery.supportedActions.map((action) => {
        const label = action === "rollback"
          ? labels.recoveryRollback
          : action === "finalize"
          ? labels.recoveryFinalize
          : labels.recoveryAcknowledge;
        const primary = action === "finalize" ? "primary-button" : "secondary-button";
        return `<button class="${primary}" data-workspace-mutation-recovery-action="${action}" data-workspace-mutation-recovery-id="${escapeAttribute(recovery.recoveryId)}" type="button" ${busy ? "disabled" : ""}>${escapeHtml(busy && state.recoveryBusy?.action === action ? labels.recoveryWorking : label)}</button>`;
      }).join("");
      return `<article class="recovery-card">
        <div class="recovery-card-heading"><div><strong>${escapeHtml(recovery.operation.kind)}</strong><small>${escapeHtml(labels.recoveryPhase(recovery.phase))}</small></div></div>
        <ul>${paths}</ul>
        <div class="recovery-actions">${actions}</div>
      </article>`;
    }).join("");
    return `<section class="dialog project-files-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-mutation-recovery-title">
      <div class="dialog-heading"><h2 id="workspace-mutation-recovery-title">${escapeHtml(labels.recoveryTitle)}</h2>${state.recoveryBusy ? "" : `<button class="icon-button" data-project-files-dialog-close type="button" aria-label="${escapeAttribute(labels.recoveryClose)}">×</button>`}</div>
      <p>${escapeHtml(labels.recoveryDetail)}</p>
      ${state.recoveryError ? `<small class="project-files-dialog-error" role="alert">${escapeHtml(state.recoveryError)}</small>` : ""}
      <div class="recovery-list">${cards}</div>
      <div class="dialog-actions"><button class="secondary-button" data-project-files-dialog-close type="button" ${state.recoveryBusy ? "disabled" : ""}>${escapeHtml(labels.recoveryClose)}</button></div>
    </section>`;
  }
  if (dialog.kind === "stage-created") {
    return `<section class="dialog project-files-dialog" role="dialog" aria-modal="true" aria-labelledby="project-files-dialog-title" aria-describedby="project-files-stage-detail">
    <div class="dialog-heading"><h2 id="project-files-dialog-title">${escapeHtml(labels.stageCreatedTitle)}</h2><button class="icon-button" data-project-files-dialog-close type="button" aria-label="${escapeAttribute(labels.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div>
    <p id="project-files-stage-detail">${escapeHtml(labels.stageCreatedDetail(dialog.destination))}</p>
    <label class="project-files-dialog-choice"><input data-project-files-stage-remember type="checkbox" ${dialog.remember ? "checked" : ""} ${dialog.busy ? "disabled" : ""} /><span>${escapeHtml(labels.stageCreatedRemember)}</span></label>
    ${dialog.error ? `<small class="project-files-dialog-error" role="alert">${escapeHtml(dialog.error)}</small>` : ""}
    <div class="dialog-actions"><button class="secondary-button" data-project-files-stage-choice="leave" type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(labels.leaveUntracked)}</button><button class="primary-button" data-project-files-stage-choice="stage" type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? labels.working : labels.stageCreated)}</button></div>
  </section>`;
  }
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
