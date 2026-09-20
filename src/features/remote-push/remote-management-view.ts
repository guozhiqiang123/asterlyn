import type { RemoteManagementCopy } from "../../localization/git-reviewed-copy.ts";
import type { RemoteManagementState } from "./remote-management-controller.ts";

export function renderRemoteManagement(state: RemoteManagementState, copy: RemoteManagementCopy): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const heading = (title: string) => `<div class="dialog-heading"><h2 id="remote-management-title">${escapeHtml(title)}</h2><button class="icon-button" data-remote-close type="button" aria-label="${escapeHtml(copy.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div>`;
  const error = dialog.error ? `<div class="remote-management-error" role="alert">${escapeHtml(localError(dialog.error, copy))}</div>` : "";
  if (dialog.kind === "list") {
    const rows = dialog.remotes.length
      ? dialog.remotes.map((remote) => `<button class="remote-management-row ${remote.name === dialog.selected ? "selected" : ""}" type="button" data-remote-name="${escapeAttribute(remote.name)}"><span>${escapeHtml(remote.name)}</span><span>${escapeHtml(remote.url ?? "—")}</span></button>`).join("")
      : `<p class="remote-management-empty">${escapeHtml(copy.noRemotes)}</p>`;
    return `<section class="dialog remote-management-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-management-title">${heading(copy.title)}<div class="remote-management-tools" role="toolbar"><button type="button" data-remote-add title="${escapeHtml(copy.addRemote)}">＋</button><button type="button" data-remote-delete title="${escapeHtml(copy.deleteRemote)}" ${dialog.selected ? "" : "disabled"}>−</button><button type="button" data-remote-edit title="${escapeHtml(copy.editRemote)}" ${dialog.selected ? "" : "disabled"}>✎</button></div><div class="remote-management-table"><div class="remote-management-columns"><span>${escapeHtml(copy.name)}</span><span>${escapeHtml(copy.url)}</span></div>${rows}</div>${error}<div class="dialog-actions"><button class="primary-button" data-remote-close type="button">${escapeHtml(copy.close)}</button></div></section>`;
  }
  if (dialog.kind === "define") {
    const title = dialog.sourceName ? copy.editTitle : copy.addTitle;
    return `<section class="dialog remote-management-dialog remote-definition-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-management-title">${heading(title)}${error}<form id="remote-definition-form"><label>${escapeHtml(copy.name)}<input id="remote-definition-name" value="${escapeAttribute(dialog.name)}" autocomplete="off" spellcheck="false" ${dialog.busy ? "disabled" : ""}></label><label>${escapeHtml(copy.url)}<input id="remote-definition-url" value="${escapeAttribute(dialog.url)}" autocomplete="off" spellcheck="false" ${dialog.busy ? "disabled" : ""}></label><label class="remote-fetch-option"><input id="remote-definition-fetch" type="checkbox" ${dialog.fetch ? "checked" : ""} ${dialog.busy ? "disabled" : ""}><span>${escapeHtml(copy.fetchRemote)}</span></label><div class="dialog-actions"><button class="secondary-button" data-remote-back type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="primary-button" type="submit" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? copy.working : copy.save)}</button></div></form></section>`;
  }
  return `<section class="dialog remote-management-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remote-management-title" aria-describedby="remote-delete-description">${heading(copy.deleteTitle)}<p id="remote-delete-description">${escapeHtml(copy.deleteDescription(dialog.remote.name))}</p><code class="remote-delete-name">${escapeHtml(dialog.remote.name)}</code>${error}<div class="dialog-actions"><button class="secondary-button" data-remote-back type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="danger-button" data-remote-confirm-delete type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? copy.working : copy.delete)}</button></div></section>`;
}

function localError(error: string, copy: RemoteManagementCopy): string {
  return error === "fields-required" ? copy.fieldsRequired : error === "mutation-failed" ? copy.failed : error;
}
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function escapeAttribute(value: string): string { return escapeHtml(value); }
