import type { GitResetCopy } from "../../localization/git-reviewed-copy.ts";
import type { GitResetMode } from "../../models.ts";
import type { GitResetController } from "./git-reset-controller.ts";

const MODES: readonly GitResetMode[] = ["soft", "mixed", "hard", "keep"];

export function renderGitResetDialog(state: GitResetController["state"], copy: GitResetCopy): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const branch = dialog.plan?.startHeadRef.replace(/^refs\/heads\//u, "") ?? "…";
  const description = copy.description(branch, dialog.target.shortOid, dialog.target.subject)
    .split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  const options = MODES.map((mode) => `<label class="git-reset-option ${mode === dialog.mode ? "selected" : ""}"><input type="radio" name="git-reset-mode" value="${mode}" ${mode === dialog.mode ? "checked" : ""} ${dialog.busy ? "disabled" : ""}><span><strong>${escapeHtml(copy.modes[mode])}</strong><small>${escapeHtml(copy.details[mode])}${mode === "hard" ? `<em>${escapeHtml(copy.hardWarning)}</em>` : ""}</small></span></label>`).join("");
  const error = dialog.error ? `<div class="git-reset-error" role="alert">${escapeHtml(dialog.error === "reset-failed" ? copy.failed : dialog.error)}</div>` : "";
  return `<section class="dialog git-reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="git-reset-title"><div class="dialog-heading"><h2 id="git-reset-title">${escapeHtml(copy.title)}</h2><button class="icon-button" data-git-reset-close type="button" aria-label="${escapeHtml(copy.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div><div class="git-reset-description">${description}</div>${dialog.plan ? `<fieldset aria-label="${escapeHtml(copy.title)}">${options}</fieldset>` : `<p>${escapeHtml(copy.preparing)}</p>`}${error}<div class="dialog-actions"><button class="secondary-button" data-git-reset-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="${dialog.mode === "hard" ? "danger-button" : "primary-button"}" data-git-reset-execute type="button" ${!dialog.plan || dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy && dialog.plan ? copy.working : copy.reset)}</button></div></section>`;
}

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
