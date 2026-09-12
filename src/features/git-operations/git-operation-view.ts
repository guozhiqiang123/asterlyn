import { icon } from "../../icons.ts";
import type {
  GitOperationKind,
} from "../../models.ts";
import type { GitOperationState } from "./git-operation-controller.ts";
import { operationDisplayName } from "./git-operation-banner.ts";

export function renderGitOperationDialog(state: GitOperationState): string {
  if (!state.dialog) return "";
  if (state.dialog === "setup") return renderSetup(state);
  if (state.dialog === "review") return renderReview(state);
  return renderConflict(state);
}

function renderSetup(state: GitOperationState): string {
  const busy = state.loading === "prepare";
  const targetCount = state.targetText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).length;
  const invalid = targetCount === 0 || (state.kind !== "cherryPick" && targetCount !== 1);
  return dialogFrame(
    `Prepare ${operationDisplayName(state.kind)}`,
    `<form id="git-operation-setup-form" class="git-operation-form">
      <label for="git-operation-kind">Operation</label>
      <select id="git-operation-kind" ${busy ? "disabled" : ""}>
        ${operationOption("merge", state.kind, "Merge into current branch")}
        ${operationOption("cherryPick", state.kind, "Cherry-pick commit(s)")}
        ${operationOption("rebase", state.kind, "Rebase current branch")}
        ${operationOption("squash", state.kind, "Squash current-branch commits")}
      </select>
      <label for="git-operation-targets">${state.kind === "cherryPick" ? "Commits, in application order" : state.kind === "squash" ? "Parent commit before the range" : "Target branch, tag, or commit"}</label>
      <textarea id="git-operation-targets" rows="${state.kind === "cherryPick" ? 5 : 2}" spellcheck="false" placeholder="${state.kind === "cherryPick" ? "One full ref or commit per line" : "refs/heads/feature"}" ${busy ? "disabled" : ""}>${escapeHtml(state.targetText)}</textarea>
      ${state.kind === "squash" ? `<label for="git-operation-message">New commit message</label><textarea id="git-operation-message" rows="5" placeholder="Describe the squashed change" ${busy ? "disabled" : ""}>${escapeHtml(state.message)}</textarea>` : ""}
      <p class="git-operation-note">Asterlyn resolves every target to an exact object and binds the review to the current branch, HEAD, clean index, and worktree. Changes after review make the plan stale.</p>
      ${renderError(state.error)}
      <div class="dialog-actions"><button class="secondary-button" type="button" data-git-operation-close ${busy ? "disabled" : ""}>Cancel</button><button class="primary-button" type="submit" ${busy || invalid || (state.kind === "squash" && !state.message.trim()) ? "disabled" : ""}>${busy ? "Preparing…" : "Review"}</button></div>
    </form>`,
    busy,
  );
}

function renderReview(state: GitOperationState): string {
  const plan = state.plan;
  if (!plan) return dialogFrame("Git operation review", '<div class="git-operation-loading">The reviewed plan is unavailable.</div>', false);
  const busy = state.loading === "execute";
  const targets = plan.targetRefs.map((target, index) =>
    `<li><span>${escapeHtml(target)}</span><code title="${escapeAttribute(plan.targetOids[index] ?? "")}">${escapeHtml((plan.targetOids[index] ?? "").slice(0, 12))}</code></li>`,
  ).join("");
  const warning = plan.kind === "squash"
    ? "Squash rewrites the checked-out branch. Push it later only with an explicitly reviewed force-with-lease."
    : "Conflicts pause successfully and remain recoverable after restarting Asterlyn.";
  return dialogFrame(
    `Confirm ${operationDisplayName(plan.kind)}`,
    `<div class="git-operation-review">
      <div class="git-operation-route"><span><small>Current branch</small><code>${escapeHtml(shortRef(plan.startHeadRef))}</code><em>${escapeHtml(plan.startHeadOid.slice(0, 12))}</em></span><b>→</b><span><small>Reviewed operation</small><strong>${escapeHtml(plan.summary)}</strong></span></div>
      <section><h3>Exact targets</h3><ul>${targets}</ul></section>
      ${plan.message ? `<section><h3>Commit message</h3><pre>${escapeHtml(plan.message)}</pre></section>` : ""}
      <p class="git-operation-warning">${icon("warning", 15)}<span>${escapeHtml(warning)}</span></p>
      ${renderError(state.error)}
      <div class="dialog-actions"><button class="secondary-button" type="button" data-git-operation-back ${busy ? "disabled" : ""}>Back</button><span class="dialog-spacer"></span><button class="secondary-button" type="button" data-git-operation-close ${busy ? "disabled" : ""}>Cancel</button><button class="primary-button" id="git-operation-execute" type="button" ${busy ? "disabled" : ""}>${busy ? "Running…" : operationDisplayName(plan.kind)}</button></div>
    </div>`,
    busy,
  );
}

function renderConflict(state: GitOperationState): string {
  const conflict = state.conflict;
  const loading = state.loading === "conflict";
  const resolving = state.loading === "resolve";
  if (loading || !conflict) {
    return dialogFrame(
      "Open conflict",
      `<div class="git-operation-loading"><span class="spinner"></span><span>${loading ? "Reading base, ours, theirs, and worktree content…" : escapeHtml(state.error ?? "The conflict is unavailable.")}</span></div>`,
      loading,
    );
  }
  const binary = conflict.binary;
  return dialogFrame(
    `Resolve ${conflict.path}`,
    `<div class="conflict-editor">
      <div class="conflict-sides" aria-label="Conflict inputs">
        ${conflictSide("Base", conflict.base)}
        ${conflictSide("Ours", conflict.ours)}
        ${conflictSide("Theirs", conflict.theirs)}
      </div>
      <label for="conflict-result">Resolved result</label>
      ${binary ? '<div class="git-operation-warning">Binary conflicts cannot be edited as text. Resolve them in an external tool or choose deletion.</div>' : `<textarea id="conflict-result" spellcheck="false" aria-label="Resolved file content" ${resolving ? "disabled" : ""}>${escapeHtml(state.conflictResult)}</textarea>`}
      <p class="git-operation-note">Saving verifies the exact index stages and worktree revision opened above, writes the result, stages it, and confirms the staged blob.</p>
      ${renderError(state.error)}
      <div class="dialog-actions"><button class="secondary-button" type="button" data-git-operation-close ${resolving ? "disabled" : ""}>Cancel</button><span class="dialog-spacer"></span><button class="danger-button" id="git-conflict-delete" type="button" ${resolving ? "disabled" : ""}>Resolve as Deleted</button><button class="primary-button" id="git-conflict-resolve" type="button" ${resolving || binary ? "disabled" : ""}>${resolving ? "Resolving…" : "Save and Stage"}</button></div>
    </div>`,
    resolving,
    "git-conflict-dialog",
  );
}

function dialogFrame(title: string, body: string, busy: boolean, extraClass = ""): string {
  return `<section class="dialog git-operation-dialog ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="git-operation-title"><div class="dialog-heading"><h2 id="git-operation-title">${escapeHtml(title)}</h2><button class="icon-button" type="button" data-git-operation-close aria-label="Close Git operation dialog" ${busy ? "disabled" : ""}>${icon("close", 18)}</button></div>${body}</section>`;
}

function operationOption(kind: GitOperationKind, selected: GitOperationKind, label: string): string {
  return `<option value="${kind}" ${kind === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function conflictSide(label: string, value: string | null): string {
  return `<section><h3>${escapeHtml(label)}</h3><pre>${value === null ? '<span class="conflict-side-missing">Not present</span>' : escapeHtml(value)}</pre></section>`;
}

function renderError(error: string | null): string {
  return error ? `<div class="git-operation-error" role="alert">${escapeHtml(error)}</div>` : "";
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
