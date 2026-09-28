import type { TagMutationCopy } from "../../localization/tag-mutation-copy.ts";
import type { TagMutationDialog } from "./tag-mutation-controller.ts";

export function renderTagMutationDialog(
  dialog: Readonly<TagMutationDialog> | null,
  copy: TagMutationCopy,
): string {
  if (!dialog) return "";
  const error = dialog.error
    ? `<div class="branch-mutation-error" role="alert">${escapeHtml(localError(dialog.error, copy))}</div>`
    : "";
  const heading = `<div class="dialog-heading"><h2 id="tag-mutation-title">${escapeHtml(copy.titles[dialog.kind])}</h2><button class="icon-button" data-tag-mutation-close type="button" aria-label="${escapeHtml(copy.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div>`;
  const source = `<div class="branch-mutation-source"><span><small>${escapeHtml(copy.commit)}</small><strong>${escapeHtml(dialog.target.commitSubject)}</strong></span><code>${escapeHtml(dialog.target.commitOid.slice(0, 12))}</code></div>`;
  const input = dialog.kind === "create"
    ? `<label for="tag-mutation-name">${escapeHtml(copy.tagName)}</label><input id="tag-mutation-name" name="name" type="text" value="${escapeAttribute(dialog.tagName)}" autocomplete="off" spellcheck="false" aria-invalid="${Boolean(dialog.error)}" ${dialog.busy ? "disabled" : ""}/>`
    : `<div class="branch-mutation-review"><ul><li><span>${escapeHtml(copy.tagName)}</span><code>${escapeHtml(dialog.tagName)}</code></li><li><span>${escapeHtml(copy.commit)}</span><code>${escapeHtml(dialog.target.commitOid)}</code></li>${dialog.remote ? `<li><span>${escapeHtml(copy.remote)}</span><code>${escapeHtml(dialog.remote)}</code></li>` : ""}</ul></div>`;
  const action = dialog.kind === "create" ? copy.create
    : dialog.kind === "checkout" ? copy.checkout
      : dialog.kind === "push" ? copy.push : copy.delete;
  const destructive = dialog.kind === "deleteLocal" || dialog.kind === "deleteRemote";
  return `<section class="dialog branch-mutation-dialog tag-mutation-dialog" role="${dialog.kind === "create" ? "dialog" : "alertdialog"}" aria-modal="true" aria-labelledby="tag-mutation-title" aria-describedby="tag-mutation-description">${heading}<p id="tag-mutation-description">${escapeHtml(copy.descriptions[dialog.kind])}</p>${source}${error}<form id="tag-mutation-form" class="branch-mutation-form">${input}<div class="dialog-actions"><button class="secondary-button" data-tag-mutation-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="${destructive ? "danger-button" : "primary-button"}" type="submit" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? copy.working : action)}</button></div></form></section>`;
}

function localError(error: string, copy: TagMutationCopy): string {
  if (error === "tag-name-required") return copy.tagNameRequired;
  if (error === "tag-mutation-failed") return copy.failed;
  return error;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string { return escapeHtml(value); }
