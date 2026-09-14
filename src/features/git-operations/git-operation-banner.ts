import { icon } from "../../icons.ts";
import type {
  GitOperationAction,
  GitOperationKind,
  GitOperationSnapshot,
} from "../../models.ts";
import type { GitOperationCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";

export function renderGitOperationBanner(operation: GitOperationSnapshot | null, copy: GitOperationCopy = EN_US.gitOperations): string {
  if (!operation) return "";
  const progress = operation.progress.current && operation.progress.total
    ? ` · ${operation.progress.current}/${operation.progress.total}`
    : "";
  const conflicts = operation.conflicts.length;
  const state = conflicts > 0
    ? copy.unresolvedFiles(conflicts)
    : copy.readyToContinue;
  return `<section class="git-operation-banner ${operation.phase}" aria-label="${escapeAttribute(copy.activeOperation)}">
    <div class="git-operation-banner-copy"><span class="git-operation-kind">${icon("branch", 15)}</span><span><strong>${escapeHtml(operationDisplayName(operation.kind, copy))}${escapeHtml(progress)}</strong><small>${escapeHtml(state)}</small></span></div>
    <div class="git-operation-actions">${operation.allowedActions.map((action) => operationActionButton(action, copy)).join("")}</div>
  </section>`;
}

export function operationDisplayName(kind: GitOperationKind, copy: GitOperationCopy = EN_US.gitOperations): string {
  return copy.names[kind];
}

function operationActionButton(action: GitOperationAction, copy: GitOperationCopy): string {
  const primary = action === "continue";
  return `<button class="${primary ? "primary-button" : action === "abort" ? "danger-button" : "secondary-button"}" type="button" data-git-operation-action="${action}" aria-label="${escapeAttribute(copy.actions[action])}">${escapeHtml(copy.actions[action])}</button>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
