import { icon } from "../../icons.ts";
import type {
  GitOperationAction,
  GitOperationKind,
  GitOperationSnapshot,
} from "../../models.ts";

export function renderGitOperationBanner(operation: GitOperationSnapshot | null): string {
  if (!operation) return "";
  const progress = operation.progress.current && operation.progress.total
    ? ` · ${operation.progress.current}/${operation.progress.total}`
    : "";
  const conflicts = operation.conflicts.length;
  const state = conflicts > 0
    ? `${conflicts} unresolved ${conflicts === 1 ? "file" : "files"}`
    : "Ready to continue";
  return `<section class="git-operation-banner ${operation.phase}" aria-label="Active Git operation">
    <div class="git-operation-banner-copy"><span class="git-operation-kind">${icon("branch", 15)}</span><span><strong>${escapeHtml(operationDisplayName(operation.kind))}${escapeHtml(progress)}</strong><small>${escapeHtml(state)}</small></span></div>
    <div class="git-operation-actions">${operation.allowedActions.map((action) => operationActionButton(action)).join("")}</div>
  </section>`;
}

export function operationDisplayName(kind: GitOperationKind): string {
  const labels: Record<GitOperationKind, string> = {
    merge: "Merge",
    cherryPick: "Cherry-pick",
    rebase: "Rebase",
    squash: "Squash",
    revert: "Revert",
    bisect: "Bisect",
  };
  return labels[kind];
}

function operationActionButton(action: GitOperationAction): string {
  const primary = action === "continue";
  return `<button class="${primary ? "primary-button" : action === "abort" ? "danger-button" : "secondary-button"}" type="button" data-git-operation-action="${action}" aria-label="${escapeAttribute(operationActionLabel(action))}">${escapeHtml(operationActionLabel(action))}</button>`;
}

function operationActionLabel(action: GitOperationAction): string {
  return action === "continue" ? "Continue" : action === "skip" ? "Skip" : "Abort";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
