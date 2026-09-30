import type { WorktreeCreationCopy } from "../../localization/worktree-creation-copy.ts";
import { renderSelectControl } from "../../shared/select-control.ts";
import {
  worktreeDestination,
  type WorktreeCreationState,
} from "./worktree-creation-controller.ts";

export function renderWorktreeCreationDialog(
  state: WorktreeCreationState,
  copy: WorktreeCreationCopy,
): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const destination = worktreeDestination(dialog.parentDirectory, dialog.projectName);
  const error = dialog.error
    ? `<div class="branch-mutation-error" role="alert">${escapeHtml(localError(dialog.error, copy))}</div>`
    : "";
  const options = dialog.branches.map((branch) =>
    `<option value="${escapeAttribute(branch.fullName)}" ${branch.fullName === dialog.sourceFullName ? "selected" : ""}>${escapeHtml(branch.name)}</option>`
  ).join("");
  return `<section class="dialog worktree-creation-dialog" role="dialog" aria-modal="true" aria-labelledby="worktree-creation-title" aria-describedby="worktree-creation-description">
    <div class="dialog-heading"><h2 id="worktree-creation-title">${escapeHtml(copy.title)}</h2><button class="icon-button" data-worktree-creation-close type="button" aria-label="${escapeHtml(copy.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div>
    <p id="worktree-creation-description">${escapeHtml(copy.description)}</p>
    <form id="worktree-creation-form" class="worktree-creation-form">
      <label for="worktree-source">${escapeHtml(copy.fromBranch)}</label>${renderSelectControl(`<select id="worktree-source" ${dialog.busy ? "disabled" : ""}>${options}</select>`)}
      <label class="worktree-creation-check"><input id="worktree-new-branch-enabled" type="checkbox" ${dialog.newBranchEnabled ? "checked" : ""} ${dialog.busy ? "disabled" : ""}/><span>${escapeHtml(copy.newBranch)}</span></label>
      <label class="worktree-creation-new-branch ${dialog.newBranchEnabled ? "" : "hidden"}" for="worktree-new-branch">${escapeHtml(copy.newBranchName)}</label>
      <input class="worktree-creation-new-branch ${dialog.newBranchEnabled ? "" : "hidden"}" id="worktree-new-branch" type="text" value="${escapeAttribute(dialog.newBranch)}" autocomplete="off" spellcheck="false" ${dialog.busy ? "disabled" : ""}/>
      <label for="worktree-project-name">${escapeHtml(copy.projectName)}</label><input id="worktree-project-name" type="text" value="${escapeAttribute(dialog.projectName)}" autocomplete="off" spellcheck="false" ${dialog.busy ? "disabled" : ""}/>
      <label for="worktree-location">${escapeHtml(copy.location)}</label><div class="worktree-location-row"><input id="worktree-location" type="text" value="${escapeAttribute(dialog.parentDirectory)}" readonly/><button class="secondary-button worktree-location-button" id="worktree-location-choose" type="button" title="${escapeAttribute(copy.browse)}" aria-label="${escapeAttribute(copy.browse)}" ${dialog.busy ? "disabled" : ""}>…</button></div>
      <div class="worktree-destination"><small>${escapeHtml(copy.createdIn)}</small><code id="worktree-destination-path">${escapeHtml(destination)}</code></div>
      ${error}
      <div class="dialog-actions"><button class="secondary-button" data-worktree-creation-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="primary-button" type="submit" ${dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy ? copy.creating : copy.create)}</button></div>
    </form>
  </section>`;
}

function localError(error: string, copy: WorktreeCreationCopy): string {
  return ({
    "source-required": copy.sourceRequired,
    "project-name-required": copy.projectNameRequired,
    "branch-name-required": copy.branchNameRequired,
    "location-required": copy.locationRequired,
    "chooser-unavailable": copy.chooserUnavailable,
    "creation-failed": copy.failed,
  } as Record<string, string>)[error] ?? error;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string { return escapeHtml(value); }
