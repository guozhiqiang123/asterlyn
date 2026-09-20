import type { ChangesCopy } from "../../localization/catalog.ts";
import type { ChangesRestoreReviewState } from "./changes-restore-review-controller.ts";

export type ChangesRestoreReviewCopy = Pick<
  ChangesCopy,
  "restoreChanges" | "restoreConfirm" | "restoreAddedConfirm"
> & { readonly cancel: string };

export function renderChangesRestoreReview(
  state: ChangesRestoreReviewState,
  copy: ChangesRestoreReviewCopy,
): string {
  const change = state.change;
  if (!change) return "";
  const label = change.originalPath ? `${change.originalPath} → ${change.path}` : change.path;
  const detail = change.indexStatus === "added"
    ? copy.restoreAddedConfirm(label)
    : copy.restoreConfirm(label);
  return `<section class="dialog changes-restore-dialog" role="alertdialog" aria-modal="true" aria-labelledby="changes-restore-title" aria-describedby="changes-restore-detail">
    <div class="dialog-heading"><h2 id="changes-restore-title">${escapeHtml(copy.restoreChanges)}</h2><button class="icon-button" data-changes-restore-close type="button" aria-label="${escapeAttribute(copy.cancel)}">×</button></div>
    <p class="changes-restore-detail" id="changes-restore-detail">${escapeHtml(detail)}</p>
    <div class="dialog-actions"><button class="secondary-button" data-changes-restore-close type="button">${escapeHtml(copy.cancel)}</button><button class="danger-button" id="changes-restore-confirm" type="button">${escapeHtml(copy.restoreChanges)}</button></div>
  </section>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#96;");
}
