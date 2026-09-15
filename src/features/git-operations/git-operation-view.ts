import { icon } from "../../icons.ts";
import { renderSelectControl } from "../../shared/select-control.ts";
import type { GitOperationCopy } from "../../localization/catalog.ts";
import { DEFAULT_LOCALIZATION } from "../../localization/localization.ts";
import type {
  GitOperationKind,
} from "../../models.ts";
import { canReviewGitOperation, type GitOperationState } from "./git-operation-controller.ts";

export function renderGitOperationDialog(state: GitOperationState, copy: GitOperationCopy = DEFAULT_LOCALIZATION.catalog.gitOperations): string {
  if (!state.dialog) return "";
  if (state.dialog === "setup") return renderSetup(state, copy);
  if (state.dialog === "review") return renderReview(state, copy);
  return renderConflict(state, copy);
}

function renderSetup(state: GitOperationState, copy: GitOperationCopy): string {
  const busy = state.loading === "prepare";
  return dialogFrame(
    copy.prepare(copy.names[state.kind]),
    `<form id="git-operation-setup-form" class="git-operation-form">
      <label for="git-operation-kind">${escapeHtml(copy.operation)}</label>
      ${renderSelectControl(`<select id="git-operation-kind" ${busy ? "disabled" : ""}>
        ${operationOption("merge", state.kind, copy.setupOptions.merge)}
        ${operationOption("cherryPick", state.kind, copy.setupOptions.cherryPick)}
        ${operationOption("rebase", state.kind, copy.setupOptions.rebase)}
        ${operationOption("squash", state.kind, copy.setupOptions.squash)}
        ${operationOption("revert", state.kind, copy.setupOptions.revert)}
      </select>`)}
      <label for="git-operation-targets">${escapeHtml(state.kind === "cherryPick" ? copy.targetsForCherryPick : state.kind === "squash" ? copy.targetBeforeSquash : copy.targetRef)}</label>
      <textarea id="git-operation-targets" rows="${state.kind === "cherryPick" ? 5 : 2}" spellcheck="false" placeholder="${escapeAttribute(state.kind === "cherryPick" ? copy.targetLinesPlaceholder : "refs/heads/feature")}" ${busy ? "disabled" : ""}>${escapeHtml(state.targetText)}</textarea>
      ${state.kind === "squash" ? `<label for="git-operation-message">${escapeHtml(copy.newCommitMessage)}</label><textarea id="git-operation-message" rows="5" placeholder="${escapeAttribute(copy.squashMessagePlaceholder)}" ${busy ? "disabled" : ""}>${escapeHtml(state.message)}</textarea>` : ""}
      <p class="git-operation-note">${escapeHtml(copy.exactReviewNote)}</p>
      ${renderError(state.error, copy)}
      <div class="dialog-actions"><button class="secondary-button" type="button" data-git-operation-close ${busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="primary-button" type="submit" ${canReviewGitOperation(state) ? "" : "disabled"}>${escapeHtml(busy ? copy.preparing : copy.review)}</button></div>
    </form>`,
    busy,
    "",
    copy,
  );
}

function renderReview(state: GitOperationState, copy: GitOperationCopy): string {
  const plan = state.plan;
  if (!plan) return dialogFrame(copy.reviewTitle, `<div class="git-operation-loading">${escapeHtml(copy.planUnavailable)}</div>`, false, "", copy);
  const busy = state.loading === "execute";
  const targets = plan.targetRefs.map((target, index) =>
    `<li><span>${escapeHtml(target)}</span><code title="${escapeAttribute(plan.targetOids[index] ?? "")}">${escapeHtml((plan.targetOids[index] ?? "").slice(0, 12))}</code></li>`,
  ).join("");
  const warning = plan.kind === "squash"
    ? copy.squashWarning
    : copy.conflictWarning;
  return dialogFrame(
    copy.confirm(copy.names[plan.kind]),
    `<div class="git-operation-review">
      <div class="git-operation-route"><span><small>${escapeHtml(copy.currentBranch)}</small><code>${escapeHtml(shortRef(plan.startHeadRef))}</code><em>${escapeHtml(plan.startHeadOid.slice(0, 12))}</em></span><b>→</b><span><small>${escapeHtml(copy.reviewedOperation)}</small><strong>${escapeHtml(plan.summary)}</strong></span></div>
      <section><h3>${escapeHtml(copy.exactTargets)}</h3><ul>${targets}</ul></section>
      ${plan.message ? `<section><h3>${escapeHtml(copy.commitMessage)}</h3><pre>${escapeHtml(plan.message)}</pre></section>` : ""}
      <p class="git-operation-warning">${icon("warning", 15)}<span>${escapeHtml(warning)}</span></p>
      ${renderError(state.error, copy)}
      <div class="dialog-actions"><button class="secondary-button" type="button" data-git-operation-back ${busy ? "disabled" : ""}>${escapeHtml(copy.back)}</button><span class="dialog-spacer"></span><button class="secondary-button" type="button" data-git-operation-close ${busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="primary-button" id="git-operation-execute" type="button" ${busy ? "disabled" : ""}>${escapeHtml(busy ? copy.running : copy.names[plan.kind])}</button></div>
    </div>`,
    busy,
    "",
    copy,
  );
}

function renderConflict(state: GitOperationState, copy: GitOperationCopy): string {
  const conflict = state.conflict;
  const loading = state.loading === "conflict";
  const resolving = state.loading === "resolve";
  if (loading || !conflict) {
    return dialogFrame(
      copy.openConflict,
      `<div class="git-operation-loading"><span class="spinner"></span><span>${loading ? escapeHtml(copy.readingConflict) : escapeHtml(state.error ?? copy.conflictUnavailable)}</span></div>`,
      loading,
      "",
      copy,
    );
  }
  const binary = conflict.binary;
  return dialogFrame(
    copy.resolve(conflict.path),
    `<div class="conflict-editor">
      <div class="conflict-sides" aria-label="${escapeAttribute(copy.conflictInputs)}">
        ${conflictSide(copy.base, conflict.base, copy)}
        ${conflictSide(copy.ours, conflict.ours, copy)}
        ${conflictSide(copy.theirs, conflict.theirs, copy)}
      </div>
      <label for="conflict-result">${escapeHtml(copy.resolvedResult)}</label>
      ${binary ? `<div class="git-operation-warning">${escapeHtml(copy.binaryConflict)}</div>` : `<textarea id="conflict-result" spellcheck="false" aria-label="${escapeAttribute(copy.resolvedFileContent)}" ${resolving ? "disabled" : ""}>${escapeHtml(state.conflictResult)}</textarea>`}
      <p class="git-operation-note">${escapeHtml(copy.resolveSafetyNote)}</p>
      ${renderError(state.error, copy)}
      <div class="dialog-actions"><button class="secondary-button" type="button" data-git-operation-close ${resolving ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><span class="dialog-spacer"></span><button class="danger-button" id="git-conflict-delete" type="button" ${resolving ? "disabled" : ""}>${escapeHtml(copy.resolveAsDeleted)}</button><button class="primary-button" id="git-conflict-resolve" type="button" ${resolving || binary ? "disabled" : ""}>${escapeHtml(resolving ? copy.resolving : copy.saveAndStage)}</button></div>
    </div>`,
    resolving,
    "git-conflict-dialog",
    copy,
  );
}

function dialogFrame(title: string, body: string, busy: boolean, extraClass = "", copy: GitOperationCopy = DEFAULT_LOCALIZATION.catalog.gitOperations): string {
  return `<section class="dialog git-operation-dialog ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="git-operation-title"><div class="dialog-heading"><h2 id="git-operation-title">${escapeHtml(title)}</h2><button class="icon-button" type="button" data-git-operation-close aria-label="${escapeAttribute(copy.closeDialog)}" ${busy ? "disabled" : ""}>${icon("close", 18)}</button></div>${body}</section>`;
}

function operationOption(kind: GitOperationKind, selected: GitOperationKind, label: string): string {
  return `<option value="${kind}" ${kind === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function conflictSide(label: string, value: string | null, copy: GitOperationCopy): string {
  return `<section><h3>${escapeHtml(label)}</h3><pre>${value === null ? `<span class="conflict-side-missing">${escapeHtml(copy.notPresent)}</span>` : escapeHtml(value)}</pre></section>`;
}

function renderError(error: string | null, copy: GitOperationCopy): string {
  if (!error) return "";
  const detail = error === copy.operationFailed ? "" : `<span>${escapeHtml(error)}</span>`;
  return `<div class="git-operation-error" role="alert"><strong>${escapeHtml(copy.operationFailed)}</strong>${detail}</div>`;
}

function shortRef(reference: string): string {
  return reference.replace(/^refs\/heads\//, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
