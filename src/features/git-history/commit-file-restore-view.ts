import type { HistoryCommitFileContextMenuCopy } from "../../localization/catalog.ts";
import type { FileRestoreRecoverySummary } from "../../models.ts";
import type { CommitFileRestoreState } from "./commit-file-restore-controller.ts";

export function renderCommitFileRestoreDialog(
  state: CommitFileRestoreState,
  copy: HistoryCommitFileContextMenuCopy,
): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const busy = dialog.phase === "preparing" || dialog.phase === "executing" || Boolean(dialog.busyRecoveryId);
  const heading = `<div class="dialog-heading"><h2 id="commit-file-restore-title">${escapeHtml(dialog.phase === "recovery" ? copy.recoveryTitle : copy.restoreTitle)}</h2><button class="icon-button" data-commit-file-restore-close type="button" aria-label="${escapeAttribute(copy.close)}" ${busy ? "disabled" : ""}>×</button></div>`;
  const error = dialog.error
    ? `<div class="commit-file-restore-error" role="alert">${escapeHtml(dialog.error === "editor-changed" ? copy.editorChanged : dialog.error)}</div>`
    : "";
  if (dialog.phase === "recovery") {
    return `<section class="dialog commit-file-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="commit-file-restore-title">${heading}<p>${escapeHtml(copy.recoveryDescription)}</p>${renderRecoveries(dialog.recoveries, dialog.busyRecoveryId, copy)}${error}<div class="dialog-actions"><button class="secondary-button" data-commit-file-restore-close type="button" ${busy ? "disabled" : ""}>${escapeHtml(copy.close)}</button></div></section>`;
  }
  if (dialog.phase === "preparing") {
    return `<section class="dialog commit-file-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="commit-file-restore-title">${heading}<div class="commit-file-restore-loading"><span class="spinner"></span><span>${escapeHtml(copy.preparing)}</span></div></section>`;
  }
  const preview = dialog.preview;
  if (!preview) {
    return `<section class="dialog commit-file-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="commit-file-restore-title">${heading}${error}<div class="dialog-actions"><button class="secondary-button" data-commit-file-restore-close type="button">${escapeHtml(copy.close)}</button></div></section>`;
  }
  const outcome = dialog.outcome;
  const applied = dialog.phase === "applied";
  const action = copy.restoreActions[preview.action];
  const body = `<p>${escapeHtml(applied ? copy.appliedDescription : copy.restoreDescription)}</p><div class="commit-file-restore-review"><dl><div><dt>${escapeHtml(copy.target)}</dt><dd><code>${escapeHtml(preview.workspacePath)}</code></dd></div><div><dt>${escapeHtml(copy.source)}</dt><dd><code>${escapeHtml(preview.revisionOid.slice(0, 12))} · ${escapeHtml(preview.sourcePath)}</code></dd></div><div><dt>${escapeHtml(copy.action)}</dt><dd>${escapeHtml(action)}</dd></div><div><dt>${escapeHtml(copy.size)}</dt><dd>${escapeHtml(copy.byteChange(preview.currentByteLength, preview.restoredByteLength))}</dd></div><div><dt>${escapeHtml(copy.mode)}</dt><dd><code>${escapeHtml(preview.fileMode)}</code></dd></div></dl><p>${escapeHtml(copy.workingTreeOnly)}</p></div>`;
  const actions = applied
    ? outcome?.recoveryId
      ? `<button class="secondary-button" data-commit-file-recovery="rollback" data-recovery-id="${escapeAttribute(outcome.recoveryId)}" type="button">${escapeHtml(copy.undo)}</button><button class="primary-button" data-commit-file-recovery="finalize" data-recovery-id="${escapeAttribute(outcome.recoveryId)}" type="button">${escapeHtml(copy.keep)}</button>`
      : `<button class="primary-button" data-commit-file-restore-close type="button">${escapeHtml(copy.close)}</button>`
    : `<button class="secondary-button" data-commit-file-restore-close type="button">${escapeHtml(copy.cancel)}</button><button class="primary-button" id="commit-file-restore-execute" type="button">${escapeHtml(copy.restoreNow)}</button>`;
  return `<section class="dialog commit-file-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="commit-file-restore-title">${heading}${body}${error}${dialog.recoveries.length > 0 && !applied ? renderRecoveries(dialog.recoveries, dialog.busyRecoveryId, copy) : ""}<div class="dialog-actions">${actions}</div></section>`;
}

function renderRecoveries(
  recoveries: readonly FileRestoreRecoverySummary[],
  busyId: string | null,
  copy: HistoryCommitFileContextMenuCopy,
): string {
  if (recoveries.length === 0) return `<p class="muted-copy">${escapeHtml(copy.noRecoveries)}</p>`;
  return `<div class="commit-file-restore-recoveries">${recoveries.map((recovery) => {
    const busy = busyId === recovery.recoveryId;
    return `<article><div><strong>${escapeHtml(recovery.workspacePath)}</strong><span>${escapeHtml(copy.recoveryStates[recovery.fileState])}</span></div><div><button class="secondary-button" data-commit-file-recovery="rollback" data-recovery-id="${escapeAttribute(recovery.recoveryId)}" type="button" ${busyId ? "disabled" : ""}>${escapeHtml(busy ? copy.working : copy.undo)}</button><button class="secondary-button" data-commit-file-recovery="finalize" data-recovery-id="${escapeAttribute(recovery.recoveryId)}" type="button" ${busyId ? "disabled" : ""}>${escapeHtml(copy.keep)}</button></div></article>`;
  }).join("")}</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
