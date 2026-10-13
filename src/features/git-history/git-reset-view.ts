import type { GitResetCopy } from "../../localization/git-reviewed-copy.ts";
import type { GitResetMode } from "../../models.ts";
import type { GitResetController } from "./git-reset-controller.ts";

const MODES: readonly GitResetMode[] = ["soft", "mixed", "hard", "keep"];

export function renderGitResetDialog(state: GitResetController["state"], copy: GitResetCopy): string {
  const dialog = state.dialog;
  if (!dialog) return "";
  const branch = dialog.plan?.startHeadRef.replace(/^refs\/heads\//u, "") ?? "…";
  const headAction = dialog.intent === "reset" ? null : copy.headCommit[dialog.intent];
  const description = (headAction?.description ?? copy.description)(branch, dialog.target.shortOid, dialog.target.subject)
    .split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  const options = MODES.map((mode) => `<label class="git-reset-option ${mode === dialog.mode ? "selected" : ""}"><input type="radio" name="git-reset-mode" value="${mode}" ${mode === dialog.mode ? "checked" : ""} ${dialog.busy ? "disabled" : ""}><span><strong>${escapeHtml(copy.modes[mode])}</strong><small>${escapeHtml(copy.details[mode])}${mode === "hard" ? `<em>${escapeHtml(copy.hardWarning)}</em>` : ""}</small></span></label>`).join("");
  const error = dialog.error ? `<div class="git-reset-error" role="alert">${escapeHtml(dialog.error === "reset-failed" ? headAction?.failed ?? copy.failed : dialog.error)}</div>` : "";
  const title = headAction?.title ?? copy.title;
  const review = headAction
    ? `<div class="git-reset-head-detail"><p>${escapeHtml(headAction.detail)}</p>${headAction.warning ? `<em>${escapeHtml(headAction.warning)}</em>` : ""}</div>`
    : `<fieldset aria-label="${escapeHtml(copy.title)}">${options}</fieldset>`;
  const preparing = headAction?.preparing ?? copy.preparing;
  const working = headAction?.working ?? copy.working;
  const action = headAction?.action ?? copy.reset;
  const danger = dialog.intent === "dropCommit" || (dialog.intent === "reset" && dialog.mode === "hard");
  return `<section class="dialog git-reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="git-reset-title"><div class="dialog-heading"><h2 id="git-reset-title">${escapeHtml(title)}</h2><button class="icon-button" data-git-reset-close type="button" aria-label="${escapeHtml(copy.cancel)}" ${dialog.busy ? "disabled" : ""}>×</button></div><div class="git-reset-description">${description}</div>${dialog.plan ? review : `<p>${escapeHtml(preparing)}</p>`}${error}<div class="dialog-actions"><button class="secondary-button" data-git-reset-close type="button" ${dialog.busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="${danger ? "danger-button" : "primary-button"}" data-git-reset-execute type="button" ${!dialog.plan || dialog.busy ? "disabled" : ""}>${escapeHtml(dialog.busy && dialog.plan ? working : action)}</button></div></section>`;
}

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
