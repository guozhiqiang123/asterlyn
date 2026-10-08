import type { DiffSideLabels } from "../../diff-presentation.ts";
import {
  createDiffReviewPaneHeaders,
  diffReviewPaneLabelParts,
  syncDiffReviewPaneHeaders,
} from "../../shared/diff-review/diff-review-pane-header.ts";

export function createDiffSideLabels(
  labels: DiffSideLabels,
  owner: Document = document,
  afterWritable = false,
): HTMLElement {
  return createDiffReviewPaneHeaders([
    { id: "before", label: labels.before },
    { id: "after", label: labels.after, writable: afterWritable },
  ], { owner, actionGutters: true, className: "diff-side-labels" });
}

export function createDiffUnifiedLabel(
  labels: DiffSideLabels,
  owner: Document = document,
): HTMLElement {
  const header = owner.createElement("header");
  header.className = "diff-unified-label";
  setUnifiedDiffSideLabel(header, labels);
  return header;
}

export function syncDiffSideLabels(
  parent: HTMLElement | null,
  labels: DiffSideLabels,
  afterWritable = false,
): void {
  syncDiffReviewPaneHeaders(parent?.querySelector<HTMLElement>(".diff-side-labels") ?? null, [
    { id: "before", label: labels.before },
    { id: "after", label: labels.after, writable: afterWritable },
  ]);
  const unified = parent?.querySelector<HTMLElement>(".diff-unified-label");
  if (unified) setUnifiedDiffSideLabel(unified, labels);
}

export function createReadOnlyDiffPane(
  parent: HTMLElement,
  label: string,
  side: "old" | "new",
  owner: Document = document,
): HTMLElement {
  const pane = owner.createElement("section");
  pane.className = `diff-pane diff-pane-${side}`;
  pane.setAttribute("aria-label", label);
  const host = owner.createElement("div");
  host.className = "diff-editor-host";
  pane.append(host);
  parent.append(pane);
  return host;
}

export function diffSideLabelParts(label: string): {
  prefix: string;
  revision: string | null;
} {
  return diffReviewPaneLabelParts(label);
}

function setUnifiedDiffSideLabel(target: HTMLElement, labels: DiffSideLabels): void {
  target.replaceChildren();
  appendDiffSideLabel(target, labels.before);
  target.append(target.ownerDocument.createTextNode(" → "));
  appendDiffSideLabel(target, labels.after);
}

function appendDiffSideLabel(target: HTMLElement, label: string): void {
  const parts = diffSideLabelParts(label);
  target.append(target.ownerDocument.createTextNode(parts.prefix));
  if (parts.revision === null) return;
  const revision = target.ownerDocument.createElement("span");
  revision.className = "diff-side-revision";
  revision.textContent = parts.revision;
  target.append(revision);
}
