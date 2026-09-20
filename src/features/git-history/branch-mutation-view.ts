import type { BranchMutationCopy } from "../../localization/catalog.ts";
import type { BranchMutationState } from "./branch-mutation-controller.ts";
import { mutationNeedsName } from "./branch-mutation-controller.ts";

export function renderBranchMutationDialog(
  state: BranchMutationState,
  copy: BranchMutationCopy,
): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const kind = dialog.request.kind;
  const error = dialog.error
    ? `<div class="branch-mutation-error" role="alert">${escapeHtml(localError(dialog.error, copy))}</div>`
    : "";
  const heading = `<div class="dialog-heading"><h2 id="branch-mutation-dialog-title">${escapeHtml(copy.titles[kind])}</h2><button class="icon-button" data-branch-mutation-close type="button" aria-label="${escapeHtml(copy.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div>`;
  if (!dialog.plan) {
    const name = mutationNeedsName(kind)
      ? `<label for="branch-mutation-name">${escapeHtml(copy.branchName)}</label><input id="branch-mutation-name" name="name" type="text" value="${escapeAttribute(dialog.value)}" autocomplete="off" spellcheck="false" aria-invalid="${Boolean(dialog.error)}" ${dialog.busy ? "disabled" : ""}/>`
      : "";
    return `<section class="dialog branch-mutation-dialog" role="dialog" aria-modal="true" aria-labelledby="branch-mutation-dialog-title" aria-describedby="branch-mutation-description">${heading}<p id="branch-mutation-description">${escapeHtml(copy.descriptions[kind])}</p><div class="branch-mutation-source"><span><small>${escapeHtml(copy.source)}</small><strong>${escapeHtml(dialog.source.fullName)}</strong></span><code>${escapeHtml(dialog.source.oid.slice(0, 12))}</code></div>${error}<form id="branch-mutation-form" class="branch-mutation-form">${name}<div class="dialog-actions"><button class="secondary-button" data-branch-mutation-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="primary-button" type="submit" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? copy.working : copy.actions[kind])}</button></div></form></section>`;
  }
  const plan = dialog.plan;
  const destination = plan.targetFullName
    ? `<li><span>${escapeHtml(copy.destination)}</span><code>${escapeHtml(plan.targetFullName)}</code></li>`
    : "";
  const upstream = plan.kind === "checkoutRemote" || plan.upstream
    ? `<li><span>${escapeHtml(copy.upstream)}</span><code>${escapeHtml(plan.kind === "checkoutRemote" ? plan.sourceFullName : plan.upstream ?? copy.noUpstream)}</code></li>`
    : "";
  const merged = plan.mergedIntoCurrent
    ? `<p class="branch-mutation-confirmed">✓ ${escapeHtml(copy.mergedIntoCurrent)}</p>`
    : "";
  const remote = plan.remoteDeletion
    ? `<li><span>${escapeHtml(copy.remoteBranch)}</span><code>${escapeHtml(plan.remoteDeletion.remote)}:${escapeHtml(plan.remoteDeletion.branchFullName)} · ${escapeHtml(plan.remoteDeletion.oid.slice(0, 12))}</code></li>`
    : "";
  const remoteOption = `<label class="branch-mutation-remote-option"><input id="branch-mutation-delete-remote" type="checkbox" ${dialog.request.deleteRemote ? "checked" : ""} ${dialog.busy || !plan.upstream ? "disabled" : ""}/><span>${escapeHtml(copy.deleteRemote)}</span></label>${plan.upstream ? "" : `<small class="branch-mutation-option-detail">${escapeHtml(copy.deleteRemoteUnavailable)}</small>`}`;
  const consequence = plan.remoteDeletion ? copy.localAndRemote : copy.localOnly;
  const action = plan.remoteDeletion ? copy.deleteLocalAndRemote : copy.actions[kind];
  return `<section class="dialog branch-mutation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="branch-mutation-dialog-title" aria-describedby="branch-mutation-description">${heading}<p id="branch-mutation-description">${escapeHtml(copy.descriptions[kind])}</p><div class="branch-mutation-review"><ul><li><span>${escapeHtml(copy.source)}</span><code>${escapeHtml(plan.sourceFullName)}</code></li><li><span>${escapeHtml(copy.object)}</span><code>${escapeHtml(plan.sourceOid)}</code></li>${destination}<li><span>${escapeHtml(copy.currentHead)}</span><code>${escapeHtml(plan.startHeadRef)} · ${escapeHtml(plan.startHeadOid.slice(0, 12))}</code></li>${upstream}${remote}</ul>${merged}${remoteOption}<p>${escapeHtml(consequence)}</p></div>${error}<div class="dialog-actions"><button class="secondary-button" id="branch-mutation-cancel" data-branch-mutation-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="danger-button" id="branch-mutation-execute" type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? copy.working : action)}</button></div></section>`;
}

function localError(error: string, copy: BranchMutationCopy): string {
  if (error === "branch-name-required") return copy.branchNameRequired;
  if (error === "branch-mutation-failed") return copy.failed;
  return error;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
